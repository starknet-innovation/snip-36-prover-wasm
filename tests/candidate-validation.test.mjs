import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkedRange, loadMemory64 } from "../web/sequencer-memory64.mjs";
import { expectedPreimage, sameFelts, checkExecution, sha256 } from "../scripts/offline-fixtures.mjs";

test("memory64 checks BigInt ranges without truncation at 4 GiB or safe-integer boundaries", () => {
  assert.deepEqual(checkedRange(2n ** 32n, 16n, 2 ** 33), [2 ** 32, 16]);
  assert.deepEqual(checkedRange(8n, 0n, 8), [8, 0]);
  for (const [ptr, len, size] of [[0, 1n, 8], [-1n, 1n, 8], [0n, -1n, 8],
    [2n ** 53n, 0n, 2 ** 54], [0n, 2n ** 32n, 2 ** 33], [7n, 2n, 8]])
    assert.throws(() => checkedRange(ptr, len, size), /pointer\/length/);
});

test("loaded bytes must match expected WASM before instantiation", async (t) => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  t.mock.method(globalThis, "fetch", async () => new Response(bytes));
  const instantiate = t.mock.method(WebAssembly, "instantiate", async () => ({ instance: { exports: {} } }));
  for (const identity of [{ bytes: 8, sha256: "0".repeat(64) }, { bytes: 9, sha256: sha256(bytes) }])
    await assert.rejects(() => loadMemory64("local", () => {}, () => {}, identity), /identity mismatch/);
  assert.equal(instantiate.mock.callCount(), 0);
  const api = await loadMemory64("local", () => {}, () => {}, { bytes: 8, sha256: sha256(bytes) });
  assert.deepEqual(api.identity, { wasm_bytes: 8, wasm_sha256: sha256(bytes) });
  assert.deepEqual(new Uint8Array(instantiate.mock.calls[0].arguments[0]), bytes);
});

test("trusted expected bootloader output agrees with retained independently verified CoinFlip evidence", async () => {
  const fixture = JSON.parse(await readFile("fixtures/coinflip/heads.json"));
  const evidence = JSON.parse(await readFile("evidence/coinflip-browser-proof.json"));
  const pins = JSON.parse(await readFile("pins.json"));
  assert.ok(sameFelts(expectedPreimage(fixture, pins.program_hash), evidence.output_preimage));
  assert.ok(!sameFelts(["0x1"], ["0x2"]));
  assert.throws(() => checkExecution({ report: { pie_sha256: sha256(Buffer.from("pie")) }, output: ["0x1"] },
    { output: ["0x2"] }, Buffer.from("pie")), /differs/);
  assert.throws(() => checkExecution({ report: { pie_sha256: sha256(Buffer.from("pie")) }, output: ["0x1"] },
    { output: ["0x1"] }, Buffer.from("tampered")), /differs/);
});
