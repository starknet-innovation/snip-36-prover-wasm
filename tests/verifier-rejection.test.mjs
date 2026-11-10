import test from "node:test";
import assert from "node:assert/strict";
import { isOrdinaryVerifierRejection } from "../scripts/offline-fixtures.mjs";

test("verifier negatives require an ordinary error, never a panic, crash or timeout", () => {
  assert.equal(isOrdinaryVerifierRejection({ code: 1, stderr: 'INFO Call the verifier\nError: "Verification failed"\n' }), true);
  assert.equal(isOrdinaryVerifierRejection({ code: 2, stderr: Buffer.from('Error: "Verification failed"') }), true);
  assert.equal(isOrdinaryVerifierRejection({ code: 1, stderr: "Error: Decode" }, /Error: Decode/), true);
  for (const error of [
    { code: 0 }, { code: 101 }, { code: -1 },
    { code: 1, stderr: "thread 'main' panicked at verify.rs:4" },
    { code: 1, stderr: Buffer.from("panicked at") },
    { code: null, signal: "SIGABRT" }, { code: 1, signal: "SIGTERM" },
    { code: 1, killed: true }, { code: "ENOENT" }, null,
    { code: 1, stderr: "Error: Os { code: 13, kind: PermissionDenied }" },
    { code: 1, stderr: 'Error: "Verification failed"\nError: Io' },
  ]) assert.equal(isOrdinaryVerifierRejection(error), false, JSON.stringify(error));
});
