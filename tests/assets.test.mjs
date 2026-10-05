import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadAssets, validateManifest } from "../scripts/assets.mjs";
import { responseBytes, responseJson } from "../scripts/network.mjs";

const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const manifest = {
  repository: "starknet-innovation/snip-36-prover-wasm",
  release: "v0.1.0",
  assets: [
    { name: "executor.wasm", path: "web/auth/browser_virtual_os_bg.wasm" },
    { name: "prover.wasm", path: "web/sequencer-prover.wasm" },
  ].map((asset) => ({
    ...asset,
    bytes: wasm.length,
    sha256: createHash("sha256").update(wasm).digest("hex"),
  })),
};

test("release metadata cannot select another repository, URL or destination", async () => {
  const mutations = [
    (m) => {
      m.repository = "other/repo";
    },
    (m) => {
      m.release = "../main";
    },
    (m) => {
      m.assets[0].name = "../../other";
    },
    (m) => {
      m.assets[0].path = "../outside.wasm";
    },
    (m) => {
      m.assets[1] = m.assets[0];
    },
    (m) => {
      m.assets[0].bytes = 2 ** 30;
    },
    (m) => {
      m.assets[0].sha256 = "not a digest";
    },
  ];
  for (const mutate of mutations) {
    const m = structuredClone(manifest);
    mutate(m);
    await assert.rejects(() =>
      downloadAssets(m, {
        fetchImpl: () =>
          assert.fail("Invalid manifest must fail before networking"),
      }),
    );
  }
  assert.equal(
    validateManifest(manifest)[0].url,
    "https://github.com/starknet-innovation/snip-36-prover-wasm/releases/download/v0.1.0/executor.wasm",
  );
});

test("verified downloads are atomic, reusable and leave no partial files on failure", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "snip36-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, manifest.assets[0].path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, "previous artifact");
  for (const bytes of [Buffer.alloc(8), Buffer.alloc(9), Buffer.alloc(7)]) {
    await assert.rejects(
      () =>
        downloadAssets(manifest, {
          root,
          fetchImpl: async () => new Response(bytes),
        }),
      /checksum mismatch|byte limit/,
    );
    assert.equal(await readFile(destination, "utf8"), "previous artifact");
    assert.deepEqual(await readdir(path.dirname(destination)), [
      "browser_virtual_os_bg.wasm",
    ]);
  }
  await downloadAssets(manifest, {
    root,
    fetchImpl: async () => new Response(wasm),
  });
  for (const asset of manifest.assets)
    assert.deepEqual(await readFile(path.join(root, asset.path)), wasm);
  await downloadAssets(manifest, {
    root,
    fetchImpl: () => assert.fail("Already verified"),
  });
});

test("remote bodies are bounded while streaming, cancelled on overflow and decoded strictly", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(9));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () => responseBytes(new Response(stream), 8),
    /byte limit/,
  );
  assert.equal(cancelled, true);
  assert.deepEqual(await responseJson(new Response('{"ok":true}')), {
    ok: true,
  });
  await assert.rejects(
    () => responseJson(new Response(new Uint8Array([255]))),
    /encoded data/,
  );
});
