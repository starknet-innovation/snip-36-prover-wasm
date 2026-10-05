// CI browser integration test. Runs actual Wasm Workers, never a Node/native prover.
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import path from "node:path";
import { startServer } from "./server.mjs";
const dir = path.resolve(process.env.RUN_DIR ?? "artifacts/run");
await mkdir(dir, { recursive: true });
if (process.env.STARKNET_PRIVATE_KEY)
  throw Error("Do not pass signing credentials to the browser step");
if (totalmem() < 14 * 1024 ** 3)
  throw Error(
    "The full recursive prover needs a runner with at least 14 GiB RAM",
  );
const input = JSON.parse(await readFile(path.join(dir, "browser-input.json")));
const server = await startServer(0);
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" },
  });
  const page = await browser.newPage();
  await page.exposeFunction("saveReceipt", async (receipt) => {
    if (!["execution", "proof"].includes(receipt.kind) || !receipt.ok)
      throw Error("Incomplete receipt");
    await writeFile(
      path.join(dir, receipt.kind + ".json"),
      JSON.stringify(receipt),
    );
    console.log("Saved browser " + receipt.kind);
  });
  page.on("pageerror", (e) => console.error("Browser error:", e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => typeof window.startRun === "function");
  await page.evaluate(
    (input) => window.startRun(input.request, input.source),
    input,
  );
  await page.waitForFunction(
    () => window.runComplete || window.runError,
    {},
    { timeout: 20 * 60 * 1000 },
  );
  const error = await page.evaluate(() => window.runError);
  if (error) throw Error(error);
  const report = await page.evaluate(() => window.runComplete.report);
  console.log(JSON.stringify(report, null, 2));
  // Replay execution independently in another actual Worker, with no provider network reads.
  const execution = JSON.parse(
    await readFile(path.join(dir, "execution.json")),
  );
  const replay = await page.evaluate(
    ({ request, capture }) =>
      new Promise((resolve, reject) => {
        const w = new Worker("./public-execution-worker.mjs", {
          type: "module",
        });
        w.onmessage = ({ data }) => {
          if (data.kind === "execution") {
            w.terminate();
            resolve({ report: data.report, output: data.output });
          } else if (data.kind === "error") {
            w.terminate();
            reject(Error(data.error));
          }
        };
        w.onerror = (e) => {
          w.terminate();
          reject(Error(e.message));
        };
        w.postMessage({
          id: crypto.randomUUID(),
          request,
          source: { capture },
        });
      }),
    { request: execution.request, capture: execution.capture },
  );
  if (
    replay.report.pie_sha256 !== execution.report.pie_sha256 ||
    JSON.stringify(replay.output) !== JSON.stringify(execution.output)
  )
    throw Error("Offline replay differs");
  await writeFile(path.join(dir, "replay.json"), JSON.stringify(replay));
  const invalid = structuredClone(execution.request);
  invalid.transaction.signature[0] = "0x1";
  const rejection = await page.evaluate(
    ({ request, capture }) =>
      new Promise((resolve, reject) => {
        const w = new Worker("./public-execution-worker.mjs", {
          type: "module",
        });
        w.onmessage = ({ data }) => {
          if (data.kind === "execution") {
            w.terminate();
            reject(Error("Invalid signature accepted"));
          } else if (data.kind === "error") {
            w.terminate();
            resolve(data.error);
          }
        };
        w.onerror = (e) => {
          w.terminate();
          reject(Error(e.message));
        };
        w.postMessage({
          id: crypto.randomUUID(),
          request,
          source: { capture },
        });
      }),
    { request: invalid, capture: execution.capture },
  );
  if (!/invalid signature/i.test(rejection))
    throw Error("Invalid-signature control failed for an unrelated reason");
  await writeFile(
    path.join(dir, "invalid-signature.json"),
    JSON.stringify({ rejected: true, error: rejection }),
  );
  console.log(
    "Offline replay identical; actual account invalid-signature rejection passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
