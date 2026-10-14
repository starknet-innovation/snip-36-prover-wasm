import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "./server.mjs";

const server = await startServer(0);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const module of [
    "public-execution-worker.mjs",
    "public-prover-worker.mjs",
  ]) {
    const messages = await page.evaluate(async (module) => {
      const url = new URL(module, location.href).href;
      const source = `
        await import(${JSON.stringify(url)});
        // Exercise each boundary before the owner's real postMessage arrives.
        for (const properties of [
          { origin: "https://untrusted.example" },
          { source: {} },
          { isTrusted: false },
          { data: null },
        ]) await self.onmessage({ origin: "", source: null, isTrusted: true,
          data: { id: "unexpected" }, ...properties });
        self.dispatchEvent(new MessageEvent("message", { data: { id: "unexpected" } }));
        self.postMessage({ kind: "ready" });
      `;
      const blob = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
      const worker = new Worker(blob, { type: "module" });
      try {
        return await new Promise((resolve, reject) => {
          const messages = [];
          const timeout = setTimeout(
            () => reject(Error("Worker test timed out")),
            10000,
          );
          worker.onerror = (event) => {
            clearTimeout(timeout);
            reject(Error(event.message));
          };
          worker.onmessage = ({ data }) => {
            messages.push(data);
            if (data.kind === "ready") worker.postMessage({ id: "owner" });
            else if (data.id === "owner") {
              clearTimeout(timeout);
              resolve(messages);
            }
          };
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(blob);
      }
    }, module);
    assert.equal(
      messages.length,
      2,
      "Foreign/synthetic messages must produce no response",
    );
    assert.equal(messages[0].kind, "ready");
    assert.equal(messages[1].id, "owner");
    assert.equal(messages[1].kind, "error");
    assert.match(messages[1].error, /required|Missing browser-generated PIE/);
    console.log(
      `${module}: owner message accepted; foreign and synthetic events rejected`,
    );
  }
  const mismatch = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker("./public-prover-worker.mjs", { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(Error("Identity test timed out")); }, 30000);
    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(data);
    };
    worker.postMessage({ id: "identity", pie: new Uint8Array([1]).buffer,
      expectedWasm: { bytes: 8, sha256: "0".repeat(64) } });
  }));
  assert.equal(mismatch.kind, "error");
  assert.match(mismatch.error, /Prover WASM identity mismatch/);
  console.log("Prover rejects replaced WASM before initialization/proving");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
