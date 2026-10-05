import test from "node:test";
import assert from "node:assert/strict";
import { fetchRpc } from "../web/rpc-retry.mjs";
const options = (method) => ({
  method: "POST",
  body: JSON.stringify({ method }),
});
test("rate-limited reads back off and recover", async () => {
  let n = 0;
  const delays = [];
  const r = await fetchRpc(
    "https://example.test",
    options("starknet_getNonce"),
    {
      fetchImpl: async () => new Response("", { status: ++n < 3 ? 429 : 200 }),
      sleep: async (ms) => delays.push(ms),
    },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(delays, [1000, 2000]);
});
test("read retry count and Retry-After are bounded", async () => {
  let n = 0;
  const delays = [];
  const r = await fetchRpc("https://example.test", options("starknet_call"), {
    fetchImpl: async () => {
      n++;
      return new Response("", {
        status: 503,
        headers: { "retry-after": "999" },
      });
    },
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(r.status, 503);
  assert.equal(n, 5);
  assert.deepEqual(delays, [20000, 20000, 20000, 20000]);
});
test("broadcast and unknown methods are never retried", async () => {
  for (const method of [
    "starknet_addInvokeTransaction",
    "starknet_addDeclareTransaction",
    "unknown",
  ]) {
    let n = 0;
    await fetchRpc("https://example.test", options(method), {
      fetchImpl: async () => {
        n++;
        return new Response("", { status: 429 });
      },
      sleep: async () => assert.fail(),
    });
    assert.equal(n, 1);
  }
});
test("aborted request is not retried", async () => {
  const controller = new AbortController();
  await assert.rejects(
    fetchRpc(
      "https://example.test",
      { ...options("starknet_getNonce"), signal: controller.signal },
      {
        fetchImpl: async () => {
          controller.abort();
          return new Response("", { status: 429 });
        },
        sleep: async () => {},
      },
    ),
    { name: "AbortError" },
  );
});
