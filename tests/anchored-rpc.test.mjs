import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AnchoredRpc,
  RpcError,
  SEPOLIA_RPC_ENDPOINT,
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

test("transport only selects the exact reviewed Sepolia URL", async () => {
  for (const endpoint of [
    "https://example.com",
    "http://127.0.0.1",
    "https://127.0.0.1",
    "https://api.zan.top.attacker.example/public/starknet-sepolia/rpc/v0_10",
    SEPOLIA_RPC_ENDPOINT + "/../admin",
    SEPOLIA_RPC_ENDPOINT + "?redirect=https://example.com",
    SEPOLIA_RPC_ENDPOINT + "#fragment",
    SEPOLIA_RPC_ENDPOINT.replace("https://", "https://user:password@"),
    SEPOLIA_RPC_ENDPOINT.replace("sepolia", "mainnet"),
  ])
    assert.throws(() => liveTransport(endpoint), /supported public Sepolia/);
  const send = liveTransport(SEPOLIA_RPC_ENDPOINT, {
    fetchImpl: async (url, options) => {
      assert.equal(url, SEPOLIA_RPC_ENDPOINT);
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      const { id } = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }),
      );
    },
  });
  assert.deepEqual(await send("starknet_chainId", []), { result: "0x1" });
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
