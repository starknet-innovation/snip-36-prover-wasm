import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { responseBytes } from "./network.mjs";
import { execFileSync } from "node:child_process";
const repository = "starknet-innovation/snip-36-prover-wasm";
const release = "v0.2.0";
const targets = Object.freeze({
  "executor.wasm": {
    path: "web/auth/browser_virtual_os_bg.wasm",
    url: "https://github.com/starknet-innovation/snip-36-prover-wasm/releases/download/v0.2.0/executor.wasm",
  },
  "prover.wasm": {
    path: "web/sequencer-prover.wasm",
    url: "https://github.com/starknet-innovation/snip-36-prover-wasm/releases/download/v0.2.0/prover.wasm",
  },
});
const sha = (b) => createHash("sha256").update(b).digest("hex");

export function validateManifest(manifest) {
  if (
    manifest.repository !== repository ||
    manifest.release !== release ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length !== 2
  )
    throw Error("Unexpected release manifest");
  const seen = new Set();
  return manifest.assets.map((asset) => {
    if (!Object.hasOwn(targets, asset.name) || seen.has(asset.name))
      throw Error("Unexpected or duplicate release asset");
    seen.add(asset.name);
    const target = targets[asset.name];
    if (
      asset.path !== target.path ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 8 ||
      asset.bytes > 128 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw Error("Invalid release asset metadata");
    return {
      ...target,
      name: asset.name,
      bytes: asset.bytes,
      sha256: asset.sha256,
    };
  });
}

export async function downloadAssets(
  manifest,
  { root = ".", fetchImpl = fetch } = {},
) {
  // Validate the entire manifest before any network or filesystem writes.
  for (const asset of validateManifest(manifest)) {
    const destination = path.join(root, asset.path);
    let data;
    try {
      data = await readFile(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (data?.length === asset.bytes && sha(data) === asset.sha256) {
      console.log("Verified " + asset.path);
      continue;
    }
    const response = await fetchImpl(asset.url, {
      credentials: "omit",
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok)
      throw Error(`Download ${asset.name}: HTTP ${response.status}`);
    data = await responseBytes(response, asset.bytes);
    if (data.length !== asset.bytes || sha(data) !== asset.sha256)
      throw Error("Release checksum mismatch: " + asset.name);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = destination + "." + randomUUID() + ".download";
    try {
      // Security review (js/http-to-file-access): Reviewed release download: exact size and committed SHA256 checked above; fixed destination. See docs/security-alerts.md.
      await writeFile(temporary, data, { flag: "wx", mode: 0o644 });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    console.log("Downloaded and verified " + asset.path);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Source builds carry their own hashes: compiler/platform differences may change module bytes.
  // A stale receipt fails instead of silently falling back to an incompatible release.
  let hasSourceReceipt = false;
  try {
    await readFile("build/source-assets.json");
    hasSourceReceipt = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (hasSourceReceipt || process.argv.includes("--source"))
    execFileSync("python3", ["scripts/source-assets.py", "verify"], { stdio: "inherit" });
  else {
    const manifest = JSON.parse(await readFile("assets.json", "utf8"));
    if (manifest.release_status === "unpublished")
      throw Error("V2 browser release assets are unpublished; build executor and prover with scripts/build.sh first (see docs/build.md)");
    await downloadAssets(manifest);
  }
}
