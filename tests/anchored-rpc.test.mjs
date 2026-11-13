import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AnchoredRpc,
  RpcError,
  SEPOLIA_RPC_ENDPOINT,
  SEPOLIA_FALLBACK_RPC_ENDPOINT,
  MAINNET_RPC_ENDPOINT,
  MAINNET_FALLBACK_RPC_ENDPOINT,
  RPC_NETWORKS,
  resetRpcPacing,
  canonical,
  digest,
  felt,
  liveTransport,
  mergeProofChunks,
  replayProvider,
  splitProofQuery,
} from "../web/anchored-rpc.mjs";
const probe = JSON.parse(
  await readFile(
    new URL("../fixtures/storage-proof-probe.json", import.meta.url),
  ),
);
const header = probe.records[0].response.result;
const proofRecord = probe.records.at(-1),
  proof = proofRecord.response.result;
const { block_id: ignored, ...query } = proofRecord.request.params;
const address = query.contract_addresses[0];
function transport(extra = {}) {
  const calls = [];
  return {
    calls,
    send: async (method, params) => {
      calls.push({ method, params });
      if (method in extra) return extra[method](params);
      switch (method) {
        case "starknet_chainId":
          return { result: "0x534e5f5345504f4c4941" };
        case "starknet_specVersion":
          return { result: "0.10.3-rc.0" };
        case "starknet_getBlockWithTxHashes":
          return { result: structuredClone(header) };
        case "starknet_getNonce":
          return { result: "0x0" };
        case "starknet_getClassHashAt":
          return { result: query.class_hashes[0] };
        case "starknet_getStorageAt":
          return { result: "0x0" };
        case "starknet_getStorageProof":
          return { result: structuredClone(proof) };
        default:
          throw Error("Unexpected method");
      }
    },
  };
}
test("all reads/proofs are anchored; explicit zero remains provisional; missing replay reads fail", async () => {
  const t = transport(),
    rpc = new AnchoredRpc(t.send);
  await rpc.resolve();
  const zero = await rpc.read({ kind: "nonce", address });
  assert.equal(zero.value, "0x0");
  assert.equal(zero.authenticated, false);
  const r = await rpc.getStorageProof(query);
  assert.deepEqual(r.proof, proof);
  assert.equal(r.authenticated, false);
  for (const call of t.calls.slice(3))
    assert.deepEqual(call.params.block_id, { block_hash: header.block_hash });
  await assert.rejects(() => rpc.resolve(), /already anchored/);
  const snapshot = await rpc.capture(),
    replay = await replayProvider(snapshot);
  assert.deepEqual(await replay.resolve(), rpc.anchor);
  assert.deepEqual(await replay.read({ kind: "nonce", address }), zero);
  await assert.rejects(
    () => replay.read({ kind: "storage", address, key: "0x1" }),
    /missing from capture/,
  );
  const edited = structuredClone(snapshot);
  edited.anchor.chain_id = "0x1";
  await assert.rejects(() => replayProvider(edited), /digest/);
});
test("mixed block, inconsistent roots, contradictory nodes and truncated positional proofs reject", () => {
  const altered = structuredClone(proof);
  altered.global_roots.block_hash = "0x1";
  assert.throws(
    () => mergeProofChunks(query, [query], [altered], header.block_hash),
    /Mixed-block/,
  );
  const missing = structuredClone(proof);
  missing.contracts_proof.contract_leaves_data = [];
  assert.throws(
    () => mergeProofChunks(query, [query], [missing], header.block_hash),
    /length mismatch/,
  );
  const conflict = structuredClone(proof);
  conflict.classes_proof.push({
    ...conflict.classes_proof[0],
    node: { left: "0x1", right: "0x2" },
  });
  assert.throws(
    () => mergeProofChunks(query, [query], [conflict], header.block_hash),
    /Conflicting proof nodes/,
  );
  const other = structuredClone(proof);
  other.global_roots.classes_tree_root = "0x1";
  assert.throws(
    () =>
      mergeProofChunks(
        query,
        [query, query],
        [proof, other],
        header.block_hash,
      ),
    /Conflicting proof roots/,
  );
});
test("only explicit contract-not-found may yield provisional zero; provider failures propagate", async () => {
  for (const code of [20, 24, 28, -32603]) {
    const t = transport({
        starknet_getNonce: async () => ({
          error: { code, message: "fixture error" },
        }),
      }),
      rpc = new AnchoredRpc(t.send);
    await rpc.resolve();
    if (code === 20) {
      const result = await rpc.read({ kind: "nonce", address });
      assert.equal(result.absent_contract_reported, true);
      assert.equal(result.authenticated, false);
    } else
      await assert.rejects(
        () => rpc.read({ kind: "nonce", address }),
        (e) => e instanceof RpcError && e.code === code,
      );
  }
});
test("cancellation rejects late replies and does not cache/export them", async () => {
  const ac = new AbortController();
  let release;
  const t = transport({
      starknet_getNonce: () => new Promise((resolve) => (release = resolve)),
    }),
    rpc = new AnchoredRpc(t.send, { signal: ac.signal });
  await rpc.resolve();
  const pending = rpc.read({ kind: "nonce", address });
  ac.abort();
  release({ result: "0x0" });
  await assert.rejects(
    () => pending,
    (e) => e.name === "AbortError",
  );
  assert.equal((await rpc.capture()).records.length, 3);
});
test("reject pending/mismatched block identity and out-of-field state", async () => {
  const t = transport(),
    rpc = new AnchoredRpc(t.send);
  await assert.rejects(
    () => rpc.resolve({ block_hash: "0x1" }),
    /identity mismatch/,
  );
  const p = transport({
    starknet_getBlockWithTxHashes: () => ({
      result: { ...header, status: "PRE_CONFIRMED" },
    }),
  });
  await assert.rejects(() => new AnchoredRpc(p.send).resolve(), /confirmed/);
  assert.throws(
    () => felt("0x" + (2n ** 251n + 17n * 2n ** 192n + 1n).toString(16)),
    /outside/,
  );
});
test("chunking preserves query order and counts each key at most 100 per request", () => {
  const q = {
    class_hashes: ["0x1"],
    contract_addresses: [address],
    contracts_storage_keys: [
      {
        contract_address: address,
        storage_keys: Array.from(
          { length: 250 },
          (_, i) => "0x" + i.toString(16),
        ),
      },
    ],
  };
  const chunks = splitProofQuery(q);
  assert.equal(chunks.length, 3);
  for (const c of chunks)
    assert.ok(
      c.class_hashes.length +
        c.contract_addresses.length +
        c.contracts_storage_keys.reduce(
          (n, x) => n + x.storage_keys.length,
          0,
        ) <=
        100,
    );
  assert.deepEqual(
    chunks.flatMap((c) =>
      c.contracts_storage_keys.flatMap((x) => x.storage_keys),
    ),
    q.contracts_storage_keys[0].storage_keys,
  );
  assert.throws(() => splitProofQuery(q, 0), /limit/);
});
test("transport forbids writes and rejects wrong response ids and oversized payloads", async () => {
  const fake = async (_url, options) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 99, result: "0x0" }));
  const send = liveTransport(SEPOLIA_RPC_ENDPOINT, { fetchImpl: fake });
  await assert.rejects(
    () => send("starknet_addInvokeTransaction", {}),
    /read-only/,
  );
  await assert.rejects(() => send("starknet_chainId", []), /envelope/);
  const large = liveTransport(SEPOLIA_RPC_ENDPOINT, {
    fetchImpl: async () => new Response("x".repeat(100)),
    maxBytes: 10,
  });
  await assert.rejects(() => large("starknet_chainId", []), /byte limit/);
});

const SEPOLIA_CHAIN = "0x534e5f5345504f4c4941";
const reply = (options, body) =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(options.body).id,
      ...body,
    }),
  );
const noWait = { sleep: async () => {}, now: () => 0 };

test("transport only selects the exact reviewed endpoints", async () => {
  assert.deepEqual(RPC_NETWORKS.sepolia.endpoints, [
    "https://sepolia.nodes.starknet.org/rpc/v0_10",
    "https://api.zan.top/public/starknet-sepolia/rpc/v0_10",
  ]);
  assert.deepEqual(RPC_NETWORKS.mainnet.endpoints, [
    "https://mainnet.nodes.starknet.org/rpc/v0_10",
    "https://api.zan.top/public/starknet-mainnet/rpc/v0_10",
  ]);
  for (const base of [SEPOLIA_RPC_ENDPOINT, SEPOLIA_FALLBACK_RPC_ENDPOINT])
    for (const endpoint of [
      "https://example.com",
      "http://127.0.0.1",
      "https://127.0.0.1",
      base.replace("https://", "http://"),
      base.replace(/^https:\/\/([^/]+)/, "https://$1.attacker.example"),
      base + "/",
      base + "/../admin",
      base + "?redirect=https://example.com",
      base + "#fragment",
      base.replace("https://", "https://user:password@"),
      base.replace("v0_10", "v0_9"),
      base.toUpperCase(),
    ])
      assert.throws(() => liveTransport(endpoint), /supported public Starknet/);
  for (const endpoint of [
    SEPOLIA_RPC_ENDPOINT,
    SEPOLIA_FALLBACK_RPC_ENDPOINT,
    MAINNET_RPC_ENDPOINT,
    MAINNET_FALLBACK_RPC_ENDPOINT,
  ]) {
    resetRpcPacing();
    const send = liveTransport(endpoint, {
      ...noWait,
      fetchImpl: async (url, options) => {
        assert.equal(url, endpoint);
        assert.equal(options.redirect, "error");
        assert.equal(options.credentials, "omit");
        // The SNF node's CORS policy allows content-type only.
        assert.deepEqual(Object.keys(options.headers), ["Content-Type"]);
        return reply(options, { result: "0x1" });
      },
    });
    assert.deepEqual(await send("starknet_getNonce", {}), { result: "0x1" });
  }
});

test("transport rejects an endpoint that reports another chain", async () => {
  resetRpcPacing();
  const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
    ...noWait,
    fetchImpl: async (_u, o) => reply(o, { result: "0x534e5f4d41494e" }),
  });
  await assert.rejects(() => send("starknet_chainId", []), /another chain/);
  const ok = liveTransport(MAINNET_RPC_ENDPOINT, {
    ...noWait,
    fetchImpl: async (_u, o) => reply(o, { result: "0x534e5f4d41494e" }),
  });
  assert.deepEqual(await ok("starknet_chainId", []), {
    result: "0x534e5f4d41494e",
  });
});

for (const [name, primary] of [
  ["network failure", async () => Promise.reject(new TypeError("CORS"))],
  ["HTTP 429", async () => new Response("", { status: 429 })],
  ["HTTP 500", async () => new Response("", { status: 500 })],
  ["HTTP 503", async () => new Response("", { status: 503 })],
  [
    "JSON-RPC -32005",
    async (_u, o) =>
      reply(o, { error: { code: -32005, message: "Limit exceeded" } }),
  ],
])
  test(`primary ${name} fails over to ZAN and stays there`, async () => {
    resetRpcPacing();
    const urls = [];
    const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
      ...noWait,
      fetchImpl: async (url, o) => {
        urls.push(url);
        return url === SEPOLIA_RPC_ENDPOINT
          ? primary(url, o)
          : reply(o, { result: SEPOLIA_CHAIN });
      },
    });
    assert.deepEqual(await send("starknet_chainId", []), {
      result: SEPOLIA_CHAIN,
    });
    assert.deepEqual(await send("starknet_chainId", []), {
      result: SEPOLIA_CHAIN,
    });
    assert.equal(urls.at(-1), SEPOLIA_FALLBACK_RPC_ENDPOINT);
    assert.equal(urls.at(-2), SEPOLIA_FALLBACK_RPC_ENDPOINT);
    assert.ok(urls.filter((u) => u === SEPOLIA_RPC_ENDPOINT).length <= 2);
  });

test("semantic errors and bad responses never fail over", async () => {
  for (const primary of [
    (o) => reply(o, { error: { code: 24, message: "Block not found" } }),
    (o) => reply(o, { error: { code: 20, message: "Contract not found" } }),
    () => new Response("", { status: 400 }),
    () => new Response("not json"),
    (o) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 999, result: "0x0" })),
    (o) => reply(o, { result: "0x534e5f4d41494e" }),
  ]) {
    resetRpcPacing();
    const urls = [];
    const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
      ...noWait,
      fetchImpl: async (url, o) => {
        urls.push(url);
        return primary(o);
      },
    });
    try {
      const r = await send("starknet_chainId", []);
      assert.ok(Object.hasOwn(r, "error"));
    } catch {}
    assert.deepEqual(urls, [SEPOLIA_RPC_ENDPOINT]);
  }
});

test("failover keeps block identity: a fallback missing the anchor block fails the run", async () => {
  resetRpcPacing();
  let primaryUp = true;
  const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
    ...noWait,
    fetchImpl: async (url, o) => {
      const { method } = JSON.parse(o.body);
      if (url === SEPOLIA_RPC_ENDPOINT) {
        if (!primaryUp) return new Response("", { status: 503 });
        if (method === "starknet_chainId")
          return reply(o, { result: SEPOLIA_CHAIN });
        if (method === "starknet_specVersion")
          return reply(o, { result: "0.10.3" });
        return reply(o, { result: header });
      }
      return reply(o, { error: { code: 24, message: "Block not found" } });
    },
  });
  const rpc = new AnchoredRpc(send);
  await rpc.resolve();
  primaryUp = false;
  await assert.rejects(
    () => rpc.read({ kind: "nonce", address: "0x1" }),
    (e) => e instanceof RpcError && e.code === 24,
  );
});

test("both endpoints unavailable fails after bounded retries", async () => {
  resetRpcPacing();
  const urls = [];
  const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
    ...noWait,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response("", { status: 429 });
    },
  });
  await assert.rejects(() => send("starknet_getNonce", {}), /RPC HTTP 429/);
  assert.equal(urls.filter((u) => u === SEPOLIA_RPC_ENDPOINT).length, 2);
  assert.equal(
    urls.filter((u) => u === SEPOLIA_FALLBACK_RPC_ENDPOINT).length,
    5,
  );
});

test("abort is not treated as an outage", async () => {
  resetRpcPacing();
  const controller = new AbortController(),
    urls = [];
  const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
    ...noWait,
    signal: controller.signal,
    fetchImpl: async (url) => {
      urls.push(url);
      controller.abort();
      throw new DOMException("Cancelled", "AbortError");
    },
  });
  await assert.rejects(() => send("starknet_getNonce", {}), {
    name: "AbortError",
  });
  assert.deepEqual(urls, [SEPOLIA_RPC_ENDPOINT]);
});

test("SNF requests are paced under the node's per-IP limit", async () => {
  resetRpcPacing();
  let clock = 0;
  const sent = [];
  const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
    now: () => clock,
    sleep: async (ms) => (clock += ms),
    fetchImpl: async (_u, o) => {
      sent.push(clock);
      return reply(o, { result: "0x1" });
    },
  });
  for (let i = 0; i < 140; i++) await send("starknet_getNonce", {});
  // Burst 50, then about 9 per second; never more than 60 in any second
  // and never above 10 per second sustained.
  for (let i = 0; i < sent.length; i++) {
    const inWindow = sent.filter((t) => t >= sent[i] && t < sent[i] + 1000);
    assert.ok(inWindow.length <= 60);
  }
  assert.ok(clock >= ((140 - 50) / 9) * 1000 - 1);
  assert.ok((140 - 50) / (clock / 1000) <= 10);
  // ZAN is not paced by this limiter.
  resetRpcPacing();
  clock = 0;
  const zan = liveTransport(SEPOLIA_FALLBACK_RPC_ENDPOINT, {
    now: () => clock,
    sleep: async (ms) => (clock += ms),
    fetchImpl: async (_u, o) => reply(o, { result: "0x1" }),
  });
  for (let i = 0; i < 100; i++) await zan("starknet_getNonce", {});
  assert.equal(clock, 0);
});

test("concurrent resolution cannot replace the selected block", async () => {
  let release;
  const t = transport({
    starknet_chainId: () => new Promise((resolve) => (release = resolve)),
  });
  const rpc = new AnchoredRpc(t.send),
    first = rpc.resolve();
  await assert.rejects(() => rpc.resolve({ block_hash: "0x1" }), /in progress/);
  release({ result: "0x534e5f5345504f4c4941" });
  await first;
  assert.equal(rpc.anchor.header.block_hash, header.block_hash);
  assert.equal(t.calls.length, 3);
});
test("recomputed capture digest cannot conceal inconsistent anchor or mixed-block records", async () => {
  const rpc = new AnchoredRpc(transport().send);
  await rpc.resolve();
  await rpc.read({ kind: "nonce", address });
  const original = await rpc.capture();
  const resign = async (capture) => {
    const { sha256, ...body } = capture;
    return { ...body, sha256: await digest(body) };
  };
  const changed = structuredClone(original);
  changed.anchor.chain_id = "0x1";
  const replay = await replayProvider(await resign(changed));
  await assert.rejects(() => replay.resolve(), /anchor disagrees/);
  assert.throws(() => replay.anchor, /not anchored/);
  const mixed = structuredClone(original);
  mixed.records.at(-1).params.block_id = { block_hash: "0x1" };
  await assert.rejects(
    async () => replayProvider(await resign(mixed)),
    /another block/,
  );
});
