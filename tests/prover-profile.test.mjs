import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BACKEND_RELEASE, SEQUENCER_REVISION, PROVING_REVISION, PROGRAM, PROOF_VERSION, PROOF_HEADER,
  supportsProverProfile, assertProofProfile,
} from "../web/prover-profile.mjs";
import { proofFacts } from "../scripts/transaction.mjs";

test("browser and submission profiles match the source pins", async () => {
  const pins = JSON.parse(await readFile(new URL("../pins.json", import.meta.url)));
  assert.equal(BACKEND_RELEASE, pins.backend_release);
  assert.equal(SEQUENCER_REVISION, pins.sequencer);
  assert.equal(PROVING_REVISION, pins.transaction_service_proving);
  assert.equal(PROGRAM, pins.program_hash);
  assert.equal(PROOF_VERSION, pins.proof_version);
  assert.equal(proofFacts(["0x1", "0x2", PROGRAM])[0], PROOF_VERSION);
});

test("legacy and mixed bank profiles cannot enable V2 deposits", () => {
  const current = { proof_version: PROOF_VERSION, program_hash: PROGRAM };
  assert.equal(supportsProverProfile(current), true);
  for (const profile of [null, {}, { ...current, proof_version: "0x50524f4f4631" },
    { ...current, program_hash: "0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1" }])
    assert.equal(supportsProverProfile(profile), false);
});

test("the V2 proof header rejects legacy versions and another circuit root", () => {
  const proof = Uint8Array.from([...PROOF_HEADER, 0x28, 0xb5, 0x2f, 0xfd]);
  assert.doesNotThrow(() => assertProofProfile(proof));
  for (const index of [0, 1, 2, 3, 34]) {
    const mutated = proof.slice();
    mutated[index] ^= 1;
    assert.throws(() => assertProofProfile(mutated), /pinned V2 circuit/);
  }
  for (const truncated of [[], PROOF_HEADER.slice(0, 3), PROOF_HEADER])
    assert.throws(() => assertProofProfile(truncated), /pinned V2 circuit/);
});
