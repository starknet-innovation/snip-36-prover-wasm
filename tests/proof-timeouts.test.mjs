import test from "node:test";
import assert from "node:assert/strict";
import { PROOF_TIMEOUT_MS, VERIFIER_TIMEOUT_MS, VERIFIER_CONTROL_COUNT, ATTEMPT_OVERHEAD_MS, ATTEMPT_TIMEOUT_MS } from "../scripts/proof-timeouts.mjs";
test("outer attempt permits proof and every verifier control to exhaust their budgets", () => {
  assert.equal(VERIFIER_CONTROL_COUNT, 3);
  assert.ok(ATTEMPT_TIMEOUT_MS > PROOF_TIMEOUT_MS + 3 * VERIFIER_TIMEOUT_MS);
  assert.equal(ATTEMPT_TIMEOUT_MS - PROOF_TIMEOUT_MS - 3 * VERIFIER_TIMEOUT_MS, ATTEMPT_OVERHEAD_MS);
});
