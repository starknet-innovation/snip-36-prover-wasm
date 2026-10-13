import test from "node:test";
import assert from "node:assert/strict";
import { isOrdinaryVerifierRejection } from "../scripts/offline-fixtures.mjs";

test("verifier negatives require an ordinary error, never a panic, crash or timeout", () => {
  assert.equal(isOrdinaryVerifierRejection({ code: 1, stderr: "invalid proof" }), true);
  assert.equal(isOrdinaryVerifierRejection({ code: 2, stderr: Buffer.from("invalid statement") }), true);
  for (const error of [
    { code: 0 }, { code: 101 }, { code: -1 },
    { code: 1, stderr: "thread 'main' panicked at verify.rs:4" },
    { code: 1, stderr: Buffer.from("panicked at") },
    { code: null, signal: "SIGABRT" }, { code: 1, signal: "SIGTERM" },
    { code: 1, killed: true }, { code: "ENOENT" }, null,
  ]) assert.equal(isOrdinaryVerifierRejection(error), false, JSON.stringify(error));
});
