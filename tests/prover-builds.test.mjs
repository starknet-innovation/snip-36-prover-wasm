import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROVER_BUILDS, recommendedBuild, runtimeBuildIdentity } from "../web/prover-builds.mjs";

test("only the compatible V2 build is recommended regardless of device RAM", () => {
  assert.equal(recommendedBuild({ deviceMemory: 32 }), "standard");
  assert.equal(recommendedBuild({ deviceMemory: 16 }), "standard");
  assert.equal(recommendedBuild({ deviceMemory: 8 }), "standard");
  assert.equal(recommendedBuild({}), "standard");
  assert.equal(recommendedBuild(undefined), "standard");
  assert.deepEqual(Object.keys(PROVER_BUILDS), ["standard", "memory"]);
});

test("build identities match the release manifest", () => {
  const assets = JSON.parse(readFileSync("assets.json", "utf8")).assets;
  for (const b of Object.values(PROVER_BUILDS).filter((build) => build.available)) {
    const asset = assets.find((a) => "./" + a.path.slice(4) === b.url);
    assert.ok(asset, b.url);
    assert.equal(b.sha256, asset.sha256);
    assert.equal(b.bytes, asset.bytes);
  }
});

test("legacy memory module is blocked before any fetch", async () => {
  assert.equal(PROVER_BUILDS.memory.available, false);
  await assert.rejects(() => runtimeBuildIdentity("memory", () => assert.fail("must not fetch V1")), /not available/);
});
test("runtime module identity follows the source-built platform manifest", async () => {
  const { BACKEND_RELEASE, PROVING_REVISION } = await import("../web/prover-profile.mjs");
  const identity = { bytes: 123, sha256: "a".repeat(64) };
  const manifest = { backend_release: BACKEND_RELEASE, proving_revision: PROVING_REVISION, builds: { standard: identity } };
  assert.deepEqual(await runtimeBuildIdentity("standard", async () => new Response(JSON.stringify(manifest))), identity);
  for (const bad of [{ ...manifest, proving_revision: "V1" }, { ...manifest, builds: {} }])
    await assert.rejects(() => runtimeBuildIdentity("standard", async () => new Response(JSON.stringify(bad))), /does not match/);
});
