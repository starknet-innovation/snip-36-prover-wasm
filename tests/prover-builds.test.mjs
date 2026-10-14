import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROVER_BUILDS, recommendedBuild } from "../web/prover-builds.mjs";

test("standard build is recommended only when the device reports 32+ GB", () => {
  assert.equal(recommendedBuild({ deviceMemory: 32 }), "standard");
  assert.equal(recommendedBuild({ deviceMemory: 16 }), "memory");
  assert.equal(recommendedBuild({ deviceMemory: 8 }), "memory");
  assert.equal(recommendedBuild({}), "memory");
  assert.equal(recommendedBuild(undefined), "memory");
  assert.deepEqual(Object.keys(PROVER_BUILDS), ["standard", "memory"]);
});

test("build identities match the release manifest", () => {
  const assets = JSON.parse(readFileSync("assets.json", "utf8")).assets;
  for (const b of Object.values(PROVER_BUILDS)) {
    const asset = assets.find((a) => "./" + a.path.slice(4) === b.url);
    assert.ok(asset, b.url);
    assert.equal(b.sha256, asset.sha256);
    assert.equal(b.bytes, asset.bytes);
  }
});
