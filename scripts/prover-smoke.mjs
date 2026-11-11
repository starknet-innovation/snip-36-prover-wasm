// Check the actual module before uploading or publishing a browser build.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "./server.mjs";

const server = await startServer(0);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { loadMemory64 } = await import("./sequencer-memory64.mjs");
    const { runtimeBuildIdentity } = await import("./prover-builds.mjs");
    const api = await loadMemory64("./sequencer-prover.wasm", (message) => {
      throw Error(message);
    }, () => {}, await runtimeBuildIdentity("standard"));
    api.init();
    return { ...api.identity, ...api.memory() };
  });
  assert.match(result.wasm_sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.wasm_linear_memory_bytes > 0);
  console.log("Memory64 prover compiled, instantiated and initialized:", JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
