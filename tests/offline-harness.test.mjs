import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("offline prover fails closed on replaced bytes and journals failure before launching Chromium", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "snip-offline-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, "attempt");
  const result = spawnSync(process.execPath, ["scripts/offline-proof.mjs", "prove", dir, "pins.json", "0".repeat(64), "absent-verifier", out],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /identity mismatch before browser launch/);
  const attempt = JSON.parse(await readFile(path.join(out, "attempt.json")));
  assert.equal(attempt.status, "failed");
  assert.equal(attempt.attempts.length, 3);
  assert.ok(attempt.attempts.every((a) => a.status === "not_started"));
  const again = spawnSync(process.execPath, ["scripts/offline-proof.mjs", "prove", dir, "pins.json", "0".repeat(64), "absent-verifier", out],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8" });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /EEXIST/);
  assert.deepEqual(JSON.parse(await readFile(path.join(out, "attempt.json"))), attempt);
});

test("offline harness refuses key-bearing environments before any artifact write", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "snip-key-check-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ["scripts/offline-proof.mjs", "prepare", path.join(dir, "out")],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, STARKNET_PRIVATE_KEY: "test-only-placeholder" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Signing credentials forbidden/);
  assert.deepEqual(await readdir(dir), []);
});

test("settlement fallback rejects a legacy bank before reading proof or credentials", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "snip-legacy-settlement-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "web"));
  await writeFile(path.join(dir, "web/live-config.json"), JSON.stringify({ proof_version: "0x50524f4f4631", program_hash: "0x1" }));
  const result = spawnSync(process.execPath, [path.resolve("scripts/settle.mjs"), "unused-proof.json", "unused-recovery.json", "--send"],
    { cwd: dir, env: { PATH: process.env.PATH, HOME: "/nonexistent-account-store" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /compatible V2 bank must be configured/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});
