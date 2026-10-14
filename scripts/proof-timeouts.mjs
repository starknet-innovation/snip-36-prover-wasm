// Shared stage budgets keep the outer campaign from killing valid verifier controls.
export const PROOF_TIMEOUT_MS = 20 * 60 * 1000;
export const VERIFIER_TIMEOUT_MS = 120000;
export const VERIFIER_CONTROL_COUNT = 3;
export const ATTEMPT_OVERHEAD_MS = 5 * 60 * 1000;
export const ATTEMPT_TIMEOUT_MS = PROOF_TIMEOUT_MS + VERIFIER_CONTROL_COUNT * VERIFIER_TIMEOUT_MS + ATTEMPT_OVERHEAD_MS;
