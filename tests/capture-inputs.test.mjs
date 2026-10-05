import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateCaptureForExecution } from "../scripts/verify-capture-inputs.mjs";
const receipt = JSON.parse(
  await readFile(
    new URL("../fixtures/captured-execution.json", import.meta.url),
  ),
);
test("real Sepolia capture reproduces inputs", async () =>
  assert.equal(
    (await validateCaptureForExecution(receipt)).execution_inputs_match_capture,
    true,
  ));
for (const [name, edit] of [
  ["class", (r) => (r.class_input[0].class.abi = "[]")],
  ["storage", (r) => (r.proof_input.storage_reads[0].value = "0x123")],
  ["header", (r) => (r.proof_input.header.event_commitment = "0x1")],
  ["chain", (r) => (r.request.captured_chain_id = "0x1")],
  ["capture", (r) => (r.capture.sha256 = "bad")],
])
  test("reject altered " + name, async () => {
    const bad = structuredClone(receipt);
    edit(bad);
    await assert.rejects(() => validateCaptureForExecution(bad));
  });
