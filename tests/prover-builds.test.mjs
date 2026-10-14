import test from "node:test";
import assert from "node:assert/strict";
import { PROVER_BUILDS, recommendedBuild } from "../web/prover-builds.mjs";

test("standard build is recommended only when the device reports 16+ GB", () => {
  assert.equal(recommendedBuild({ deviceMemory: 32 }), "standard");
  assert.equal(recommendedBuild({ deviceMemory: 16 }), "standard");
  assert.equal(recommendedBuild({ deviceMemory: 8 }), "memory");
  assert.equal(recommendedBuild({}), "memory");
  assert.equal(recommendedBuild(undefined), "memory");
  assert.deepEqual(Object.keys(PROVER_BUILDS), ["standard", "memory"]);
});
