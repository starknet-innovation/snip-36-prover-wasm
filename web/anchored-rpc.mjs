import { fetchRpc } from "./rpc-retry.mjs";
// Read-only transport and replay. RPC values stay provisional until verified against proofs.
// Exact endpoint allowlist per network, in preference order: the Starknet
// Foundation node first, ZAN's public node as fallback (the SNF node has no SLA).
export const SEPOLIA_RPC_ENDPOINT =
  "https://sepolia.nodes.starknet.org/rpc/v0_10";
export const SEPOLIA_FALLBACK_RPC_ENDPOINT =
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
export const MAINNET_RPC_ENDPOINT =
  "https://mainnet.nodes.starknet.org/rpc/v0_10";
export const MAINNET_FALLBACK_RPC_ENDPOINT =
  "https://api.zan.top/public/starknet-mainnet/rpc/v0_10";
export const RPC_NETWORKS = Object.freeze({
  sepolia: Object.freeze({
    chainId: "0x534e5f5345504f4c4941",
    endpoints: Object.freeze([
      SEPOLIA_RPC_ENDPOINT,
      SEPOLIA_FALLBACK_RPC_ENDPOINT,
    ]),
  }),
  mainnet: Object.freeze({
    chainId: "0x534e5f4d41494e",
    endpoints: Object.freeze([
      MAINNET_RPC_ENDPOINT,
      MAINNET_FALLBACK_RPC_ENDPOINT,
    ]),
  }),
});
// SNF node limits per client IP: about 10 req/s, burst 60, 3,060 per 5 min.
// Pace below that so one proving run does not trip HTTP 429 / -32005.
const PACED = new Map(
  [SEPOLIA_RPC_ENDPOINT, MAINNET_RPC_ENDPOINT].map((e) => [
    e,
    { rate: 9, burst: 50 },
  ]),
);
const RATE_LIMITED = -32005;
const PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const METHODS = new Set([
  "starknet_chainId",
  "starknet_specVersion",
  "starknet_getBlockWithTxHashes",
  "starknet_getNonce",
  "starknet_getStorageAt",
  "starknet_getClassHashAt",
  "starknet_getClass",
  "starknet_getCompiledCasm",
  "starknet_getStorageProof",
]);
export function felt(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
    throw Error("Invalid felt encoding");
  const n = BigInt(value);
  if (n >= PRIME) throw Error("Felt outside Stark field");
  return `0x${n.toString(16)}`;
}
function key(value) {
  const v = felt(value);
  if (BigInt(v) >= 1n << 251n) throw Error("Trie key exceeds 251 bits");
  return v;
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  if (value === undefined) throw Error("Undefined capture field");
  return JSON.stringify(value);
}
export async function digest(value) {
  const data = new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function cancelled(signal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}
export class RpcError extends Error {
  constructor(error) {
    super(`RPC ${error.code}: ${error.message}`);
    this.code = error.code;
    this.data = error.data;
  }
}
const buckets = new Map();
function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Cancelled", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(t);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}
// Token bucket shared by every transport in this realm (one per Worker).
async function pace(endpoint, { now, sleep, signal }) {
  const limit = PACED.get(endpoint);
  if (!limit) return;
  let b = buckets.get(endpoint);
  if (!b) buckets.set(endpoint, (b = { tokens: limit.burst, at: now() }));
  for (;;) {
    const t = now();
    b.tokens = Math.min(
      limit.burst,
      b.tokens + ((t - b.at) * limit.rate) / 1000,
    );
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    await sleep(Math.ceil(((1 - b.tokens) * 1000) / limit.rate), signal);
  }
}
export function resetRpcPacing() {
  buckets.clear();
}
function networkOf(endpoint) {
  for (const [name, net] of Object.entries(RPC_NETWORKS))
    if (net.endpoints.includes(endpoint)) return { name, ...net };
}
// Failures that say nothing about chain state: the next endpoint may answer.
class Unavailable extends Error {}
class RateLimited extends Unavailable {
  constructor(message, retryAfter) {
    super(message);
    this.retryAfter = retryAfter;
  }
}
// Same retryable statuses and Retry-After cap as rpc-retry.mjs.
const RETRY_STATUS = new Set([429, 502, 503, 504]);
export function liveTransport(
  endpoint,
  {
    fetchImpl = fetch,
    signal,
    maxBytes = 64 * 1024 * 1024,
    now = () => performance.now(),
    sleep = abortableSleep,
  } = {},
) {
  // Select a reviewed endpoint, including its path. HTTPS alone does not stop
  // a pasted request from targeting another service on the user's network.
  const network = networkOf(endpoint);
  if (!network) throw Error("Use a supported public Starknet RPC endpoint");
  // The requested endpoint first, then the network's other reviewed endpoints.
  // Failover is sticky so one run reads from one node unless that node fails.
  const order = [endpoint, ...network.endpoints.filter((e) => e !== endpoint)];
  const verified = new Map();
  let active = 0,
    id = 0;
  // Pace every underlying fetch, retries included.
  const pacedFetch = async (url, options) => {
    await pace(url, { now, sleep, signal });
    return fetchImpl(url, options);
  };
  const once = async (url, request) => {
    let response;
    try {
      response = await fetchRpc(
        url,
        {
          method: "POST",
          // content-type is the only header the SNF node's CORS policy allows.
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal,
          credentials: "omit",
          redirect: "error",
        },
        // One fetch per call: `attempt` owns the shared retry budget.
        { fetchImpl: pacedFetch, attempts: 1 },
      );
    } catch (error) {
      // Any abort reason (timeout, custom error) is a cancellation, not an outage.
      cancelled(signal);
      if (error?.name === "AbortError") throw error;
      throw new Unavailable(
        `RPC transport failure: ${error?.message ?? error}`,
      );
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers?.get("retry-after"));
      await response.body?.cancel().catch(() => {});
      if (RETRY_STATUS.has(response.status))
        throw new RateLimited(`RPC HTTP ${response.status}`, retryAfter);
      throw new Unavailable(`RPC HTTP ${response.status}`);
    }
    if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          // A connection reset mid-body is an outage; limits and parsing are not.
          cancelled(signal);
          if (error?.name === "AbortError") throw error;
          throw new Unavailable(
            `RPC response read failure: ${error?.message ?? error}`,
          );
        }
        const { done, value } = chunk;
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw Error("RPC response exceeds byte limit");
        chunks.push(value);
        cancelled(signal);
      }
    } catch (error) {
      // Best-effort cleanup must not replace the original classification.
      await reader.cancel().catch(() => {});
      throw error;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    cancelled(signal);
    const envelope = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      envelope.jsonrpc !== "2.0" ||
      envelope.id !== request.id ||
      Object.hasOwn(envelope, "result") === Object.hasOwn(envelope, "error")
    )
      throw Error("Invalid RPC response envelope");
    if (Object.hasOwn(envelope, "error")) {
      const e = envelope.error;
      if (
        !e ||
        typeof e !== "object" ||
        !Number.isInteger(e.code) ||
        typeof e.message !== "string"
      )
        throw Error("Invalid RPC error object");
      if (e.code === RATE_LIMITED) throw new RateLimited("RPC rate limited");
      return { error: envelope.error };
    }
    return { result: envelope.result };
  };
  // One budget per endpoint per request, shared by HTTP 429/502/503/504 and
  // JSON-RPC -32005: a rate-limited primary gets one backoff retry before
  // failover, the last endpoint five attempts in all. Retry-After is honoured.
  const attempt = async (url, request, last) => {
    const budget = last ? 5 : 2;
    for (let n = 0; ; n++) {
      try {
        return await once(url, request);
      } catch (error) {
        if (!(error instanceof RateLimited) || n >= budget - 1) throw error;
        const ra = error.retryAfter;
        await sleep(
          Number.isFinite(ra) && ra > 0
            ? Math.min(ra * 1000, 20000)
            : 1000 * 2 ** n,
          signal,
        );
      }
    }
  };
  // Every reviewed endpoint must report this network before any of its other
  // answers is used, including an endpoint first reached through failover.
  const checkChain = (response) => {
    if (
      !Object.hasOwn(response, "result") ||
      felt(response.result) !== network.chainId
    )
      throw Error("RPC endpoint reports another chain");
    return response;
  };
  const send = async (url, request, last) => {
    if (request.method === "starknet_chainId") {
      const response = checkChain(await attempt(url, request, last));
      verified.set(url, Promise.resolve());
      return response;
    }
    if (!verified.has(url)) {
      const check = attempt(
        url,
        { jsonrpc: "2.0", id: ++id, method: "starknet_chainId", params: [] },
        last,
      ).then(checkChain);
      verified.set(url, check);
      // A transient failure may be retried; a wrong chain fails again anyway.
      check.catch(() => verified.get(url) === check && verified.delete(url));
    }
    await verified.get(url);
    return attempt(url, request, last);
  };
  return async (method, params) => {
    if (!METHODS.has(method))
      throw Error("Only supported read-only methods are allowed");
    cancelled(signal);
    const request = { jsonrpc: "2.0", id: ++id, method, params };
    // Advance from the index this request tried, so concurrent failures all
    // land on the same next endpoint instead of skipping past it.
    for (let i = active; ;) {
      const last = i === order.length - 1;
      try {
        return await send(order[i], request, last);
      } catch (error) {
        if (!(error instanceof Unavailable)) throw error;
        if (last) throw Error(error.message);
        i++;
        active = Math.max(active, i);
      }
    }
  };
}
function normalizedQuery(query) {
  const unique = (values) => {
    if (new Set(values).size !== values.length)
      throw Error("Duplicate proof query key");
    return values;
  };
  const q = {
    class_hashes: unique((query.class_hashes ?? []).map(felt)),
    contract_addresses: unique((query.contract_addresses ?? []).map(key)),
    contracts_storage_keys: (query.contracts_storage_keys ?? []).map((x) => ({
      contract_address: key(x.contract_address),
      storage_keys: unique(x.storage_keys.map(key)),
    })),
  };
  unique(q.contracts_storage_keys.map((x) => x.contract_address));
  for (const item of q.contracts_storage_keys)
    if (!q.contract_addresses.includes(item.contract_address))
      throw Error("Storage proof requires its contract leaf query");
  return q;
}
export function splitProofQuery(query, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw Error("Invalid proof chunk limit");
  const q = normalizedQuery(query),
    items = [
      ...q.class_hashes.map((value) => ({ type: "class", value })),
      ...q.contract_addresses.map((value) => ({ type: "contract", value })),
      ...q.contracts_storage_keys.flatMap((x) =>
        x.storage_keys.map((value) => ({
          type: "storage",
          address: x.contract_address,
          value,
        })),
      ),
    ];
  if (!items.length)
    return [
      { class_hashes: [], contract_addresses: [], contracts_storage_keys: [] },
    ];
  const chunks = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = {
      class_hashes: [],
      contract_addresses: [],
      contracts_storage_keys: [],
    };
    for (const item of items.slice(i, i + limit)) {
      if (item.type === "class") chunk.class_hashes.push(item.value);
      else if (item.type === "contract")
        chunk.contract_addresses.push(item.value);
      else {
        let entry = chunk.contracts_storage_keys.find(
          (x) => x.contract_address === item.address,
        );
        if (!entry) {
          entry = { contract_address: item.address, storage_keys: [] };
          chunk.contracts_storage_keys.push(entry);
        }
        entry.storage_keys.push(item.value);
      }
    }
    chunks.push(chunk);
  }
  return chunks;
}
function nodesInto(map, nodes) {
  if (!Array.isArray(nodes)) throw Error("Expected RPC proof node array");
  for (const item of nodes) {
    const hash = felt(item.node_hash),
      raw = item.node;
    let node;
    if (
      raw &&
      Object.hasOwn(raw, "left") &&
      Object.hasOwn(raw, "right") &&
      Object.keys(raw).length === 2
    )
      node = { left: felt(raw.left), right: felt(raw.right) };
    else if (
      raw &&
      Object.keys(raw).length === 3 &&
      Number.isInteger(raw.length) &&
      raw.length > 0 &&
      raw.length <= 251
    ) {
      node = {
        child: felt(raw.child),
        path: felt(raw.path),
        length: raw.length,
      };
      if (BigInt(node.path) >= 1n << BigInt(node.length))
        throw Error("Invalid edge path");
    } else throw Error("Invalid RPC proof node");
    if (map.has(hash) && canonical(map.get(hash)) !== canonical(node))
      throw Error("Conflicting proof nodes");
    map.set(hash, node);
  }
}
export function mergeProofChunks(query, chunks, proofs, blockHash) {
  const q = normalizedQuery(query);
  if (chunks.length !== proofs.length || !proofs.length)
    throw Error("Proof chunk count mismatch");
  const classes = new Map(),
    contracts = new Map(),
    leaves = new Map(),
    storage = new Map();
  let roots;
  for (let i = 0; i < proofs.length; i++) {
    const p = proofs[i],
      c = chunks[i];
    const currentRoots = {
      block_hash: felt(p.global_roots.block_hash),
      classes_tree_root: felt(p.global_roots.classes_tree_root),
      contracts_tree_root: felt(p.global_roots.contracts_tree_root),
    };
    if (currentRoots.block_hash !== felt(blockHash))
      throw Error("Mixed-block storage proof");
    if (roots && canonical(roots) !== canonical(currentRoots))
      throw Error("Conflicting proof roots");
    roots = currentRoots;
    if (
      p.contracts_proof.contract_leaves_data.length !==
        c.contract_addresses.length ||
      p.contracts_storage_proofs.length !== c.contracts_storage_keys.length
    )
      throw Error("Proof positional response length mismatch");
    nodesInto(classes, p.classes_proof);
    nodesInto(contracts, p.contracts_proof.nodes);
    c.contract_addresses.forEach((address, j) => {
      const leaf = p.contracts_proof.contract_leaves_data[j];
      leaves.set(address, {
        class_hash: felt(leaf.class_hash),
        nonce: felt(leaf.nonce),
        storage_root:
          leaf.storage_root === null ? null : felt(leaf.storage_root),
      });
    });
    c.contracts_storage_keys.forEach((entry, j) => {
      if (!storage.has(entry.contract_address))
        storage.set(entry.contract_address, new Map());
      nodesInto(
        storage.get(entry.contract_address),
        p.contracts_storage_proofs[j],
      );
    });
  }
  const list = (map) =>
    [...map].map(([node_hash, node]) => ({ node_hash, node }));
  return {
    classes_proof: list(classes),
    contracts_proof: {
      nodes: list(contracts),
      contract_leaves_data: q.contract_addresses.map((a) => {
        if (!leaves.has(a)) throw Error("Missing contract leaf response");
        return leaves.get(a);
      }),
    },
    contracts_storage_proofs: q.contracts_storage_keys.map((x) =>
      list(storage.get(x.contract_address) ?? new Map()),
    ),
    global_roots: roots,
  };
}
export class AnchoredRpc {
  #transport;
  #signal;
  #records = [];
  #anchor;
  #resolving = false;
  #expectedAnchor;
  #reads = new Map();
  constructor(
    transport,
    { signal, endpoint = "offline replay", expectedAnchor } = {},
  ) {
    this.#expectedAnchor = expectedAnchor && structuredClone(expectedAnchor);
    this.#transport = transport;
    this.#signal = signal;
    this.endpoint = endpoint;
  }
  async #call(method, params) {
    cancelled(this.#signal);
    if (!METHODS.has(method)) throw Error("Unsupported read-only method");
    const response = await this.#transport(method, structuredClone(params));
    cancelled(this.#signal);
    this.#records.push({
      method,
      params: structuredClone(params),
      response: structuredClone(response),
    });
    if (Object.hasOwn(response, "error")) throw new RpcError(response.error);
    if (!Object.hasOwn(response, "result")) throw Error("Missing RPC result");
    return structuredClone(response.result);
  }
  async resolve(blockId = "latest") {
    if (this.#anchor)
      throw Error(
        "Provider already anchored; create another provider for another block",
      );
    if (this.#resolving)
      throw Error("Provider anchor resolution already in progress");
    this.#resolving = true;
    try {
      const chain_id = felt(await this.#call("starknet_chainId", []));
      const rpc_version = await this.#call("starknet_specVersion", []);
      const header = await this.#call("starknet_getBlockWithTxHashes", {
        block_id: blockId,
      });
      if (
        !["ACCEPTED_ON_L1", "ACCEPTED_ON_L2"].includes(header.status) ||
        !Number.isSafeInteger(header.block_number) ||
        header.block_number < 0
      )
        throw Error("Expected a confirmed block header");
      header.block_hash = felt(header.block_hash);
      felt(header.parent_hash);
      felt(header.new_root);
      if (
        typeof blockId === "object" &&
        ((blockId.block_hash !== undefined &&
          felt(blockId.block_hash) !== header.block_hash) ||
          (blockId.block_number !== undefined &&
            blockId.block_number !== header.block_number))
      )
        throw Error("Resolved block identity mismatch");
      const anchor = { chain_id, rpc_version, header };
      if (
        this.#expectedAnchor &&
        canonical(anchor) !== canonical(this.#expectedAnchor)
      )
        throw Error(
          "Capture anchor disagrees with recorded discovery responses",
        );
      this.#anchor = anchor;
      return this.anchor;
    } finally {
      this.#resolving = false;
    }
  }
  get anchor() {
    if (!this.#anchor) throw Error("Provider is not anchored");
    return structuredClone(this.#anchor);
  }
  get blockId() {
    return { block_hash: this.anchor.header.block_hash };
  }
  async read(request) {
    const address = key(request.address),
      cacheKey = canonical(request);
    if (this.#reads.has(cacheKey))
      return structuredClone(this.#reads.get(cacheKey));
    let method,
      params = { block_id: this.blockId, contract_address: address };
    switch (request.kind) {
      case "nonce":
        method = "starknet_getNonce";
        break;
      case "class_hash":
        method = "starknet_getClassHashAt";
        break;
      case "storage":
        method = "starknet_getStorageAt";
        params.key = key(request.key);
        break;
      default:
        throw Error("Unsupported state read kind");
    }
    let value,
      absentContract = false;
    try {
      value = felt(await this.#call(method, params));
    } catch (e) {
      if (!(e instanceof RpcError) || e.code !== 20) throw e;
      value = "0x0";
      absentContract = true;
    }
    cancelled(this.#signal);
    const result = {
      value,
      authenticated: false,
      source: "block-anchored RPC; proof verification pending",
      absent_contract_reported: absentContract,
    };
    this.#reads.set(cacheKey, result);
    return structuredClone(result);
  }
  async getClass(classHash) {
    return this.#call("starknet_getClass", {
      block_id: this.blockId,
      class_hash: felt(classHash),
    });
  }
  async getCompiledCasm(classHash) {
    return this.#call("starknet_getCompiledCasm", {
      block_id: this.blockId,
      class_hash: felt(classHash),
    });
  }
  async getStorageProof(query, limit = 100) {
    const q = normalizedQuery(query),
      chunks = splitProofQuery(q, limit),
      proofs = [];
    for (const chunk of chunks)
      proofs.push(
        await this.#call("starknet_getStorageProof", {
          block_id: this.blockId,
          ...chunk,
        }),
      );
    return {
      query: q,
      proof: mergeProofChunks(q, chunks, proofs, this.blockId.block_hash),
      authenticated: false,
      scope:
        "Transport, block identity and chunk consistency checked; cryptographic path/header verification still required",
    };
  }
  async capture() {
    const body = {
      format: "snip36-public-rpc-capture-v1",
      endpoint: this.endpoint,
      anchor: this.anchor,
      records: structuredClone(this.#records),
    };
    return { ...body, sha256: await digest(body) };
  }
}
export async function replayProvider(capture, options = {}) {
  const { sha256, ...body } = capture;
  if (
    body.format !== "snip36-public-rpc-capture-v1" ||
    (await digest(body)) !== sha256
  )
    throw Error("Capture digest/format mismatch");
  const records = new Map();
  for (const record of body.records) {
    if (!METHODS.has(record.method))
      throw Error("Capture contains a non-read-only method");
    if (
      ![
        "starknet_chainId",
        "starknet_specVersion",
        "starknet_getBlockWithTxHashes",
      ].includes(record.method) &&
      canonical(record.params.block_id) !==
        canonical({ block_hash: body.anchor.header.block_hash })
    )
      throw Error("Capture contains a state read from another block");
    const k = canonical([record.method, record.params]);
    if (
      records.has(k) &&
      canonical(records.get(k)) !== canonical(record.response)
    )
      throw Error("Conflicting captured responses");
    records.set(k, record.response);
  }
  return new AnchoredRpc(
    async (method, params) => {
      const k = canonical([method, params]);
      if (!records.has(k)) throw Error("Read missing from capture");
      return structuredClone(records.get(k));
    },
    { ...options, endpoint: body.endpoint, expectedAnchor: body.anchor },
  );
}
