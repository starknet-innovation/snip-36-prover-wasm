import test from "node:test";
import assert from "node:assert/strict";
import { preparePublicInvocation } from "../web/public-pipeline.mjs";
const request = {
  captured_chain_id: "0x1",
  transaction: { sender_address: "0x2" },
};
const decode = (b) => JSON.parse(new TextDecoder().decode(b));
function fixture(overrides = {}) {
  const calls = [];
  const rpc = {
    anchor: { chain_id: "0x1", header: { block_hash: "0x3", new_root: "0x4" } },
    async read(q) {
      calls.push(q);
      return { value: q.kind === "class_hash" ? "0x5" : "0x0" };
    },
    async getClass(h) {
      calls.push({ class: h });
      return { sierra_program: [] };
    },
    async getStorageProof(q) {
      calls.push({ query: q });
      return {
        proof: {
          contracts_proof: {
            contract_leaves_data: q.contract_addresses.map(() => ({
              class_hash: "0x5",
              nonce: "0x0",
            })),
          },
        },
      };
    },
    async capture() {
      return { records: calls };
    },
    ...overrides,
  };
  return { rpc, calls };
}
const miss = (read) => {
  throw Error("State read failed BROWSER_STATE_MISS:" + JSON.stringify(read));
};
test("demand reads are fed back into authenticated preparation, including explicit zero", async () => {
  const { rpc, calls } = fixture();
  let attempts = 0;
  const r = await preparePublicInvocation(
    (p, c, t) => {
      const proof = decode(p);
      assert.equal(proof.block_hash, "0x3");
      assert.deepEqual(decode(t), request);
      assert.equal(decode(c)[0].class_hash, "0x5");
      if (!attempts++)
        return miss({ kind: "storage", address: "0x2", key: "0x6" });
      assert.deepEqual(proof.storage_reads, [
        { address: "0x2", key: "0x6", value: "0x0" },
      ]);
      return '{"hints":{}}';
    },
    rpc,
    request,
  );
  assert.equal(attempts, 2);
  assert.equal(r.requests.length, 1);
  assert.equal(calls.filter((c) => c.kind === "storage").length, 1);
});
test("repeated missing reads fail without an unbounded retry loop", async () => {
  const { rpc } = fixture();
  await assert.rejects(
    () =>
      preparePublicInvocation(
        () => miss({ kind: "nonce", address: "0x2" }),
        rpc,
        request,
      ),
    /no progress/,
  );
});
test("read limits and invalid limit settings reject", async () => {
  const { rpc, calls } = fixture();
  for (const maxRequests of [0, -1, 1.1, 257, NaN])
    await assert.rejects(
      () => preparePublicInvocation(() => "", rpc, request, { maxRequests }),
      /integer/,
    );
  assert.equal(calls.length, 0);
  let key = 0;
  await assert.rejects(
    () =>
      preparePublicInvocation(
        () =>
          miss({
            kind: "storage",
            address: "0x2",
            key: "0x" + (++key).toString(16),
          }),
        rpc,
        request,
        { maxRequests: 1 },
      ),
    /limit exceeded/,
  );
});
test("chain mismatch and inconsistent provisional reads reject before execution", async () => {
  const { rpc } = fixture();
  await assert.rejects(
    () =>
      preparePublicInvocation(() => assert.fail(), rpc, {
        ...request,
        captured_chain_id: "0x9",
      }),
    /chain differs/,
  );
  rpc.getStorageProof = async () => ({
    proof: {
      contracts_proof: {
        contract_leaves_data: [{ class_hash: "0x5", nonce: "0x1" }],
      },
    },
  });
  await assert.rejects(
    () => preparePublicInvocation(() => assert.fail(), rpc, request),
    /disagrees/,
  );
});
test("execution errors and provider failures propagate without treating them as cache misses", async () => {
  const { rpc } = fixture();
  await assert.rejects(
    () =>
      preparePublicInvocation(
        () => {
          throw Error("Invalid signature");
        },
        rpc,
        request,
      ),
    /Invalid signature/,
  );
  rpc.getClass = async () => {
    throw Error("Provider unavailable");
  };
  await assert.rejects(
    () => preparePublicInvocation(() => assert.fail(), rpc, request),
    /Provider unavailable/,
  );
});
test("cancellation rejects replies arriving after a class request", async () => {
  const ac = new AbortController();
  let release;
  const { rpc } = fixture({
    getClass: () => new Promise((r) => (release = r)),
  });
  const pending = preparePublicInvocation(() => assert.fail(), rpc, request, {
    signal: ac.signal,
  });
  while (!release) await new Promise((r) => setImmediate(r));
  ac.abort();
  release({ sierra_program: [] });
  await assert.rejects(
    () => pending,
    (e) => e.name === "AbortError",
  );
});
test("cancellation during final capture cannot publish stale success", async () => {
  const ac = new AbortController();
  const { rpc } = fixture({
    capture: async () => {
      ac.abort();
      return {};
    },
  });
  await assert.rejects(
    () =>
      preparePublicInvocation(() => "{}", rpc, request, { signal: ac.signal }),
    (e) => e.name === "AbortError",
  );
});
test("unsupported missing-read kind rejects", async () => {
  const { rpc } = fixture();
  await assert.rejects(
    () =>
      preparePublicInvocation(() => miss({ kind: "unknown" }), rpc, request),
    /Unsupported/,
  );
});
