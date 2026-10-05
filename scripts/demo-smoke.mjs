import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { startServer } from "./server.mjs";
const remote = process.env.DEMO_URL;
const server = remote ? null : await startServer(0);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(remote || `http://127.0.0.1:${server.address().port}/`);
  await page.getByRole("button", { name: "Run execution" }).click();
  await page.waitForFunction(
    () => window.runComplete || window.runError,
    null,
    { timeout: 120000 },
  );
  const result = await page.evaluate(() => ({
    error: window.runError,
    kind: window.runComplete?.kind,
    sha: window.runComplete?.report.pie_sha256,
  }));
  const fixture = JSON.parse(
    await readFile("fixtures/captured-execution.json"),
  );
  if (
    result.error ||
    result.kind !== "execution" ||
    result.sha !== fixture.report.pie_sha256
  )
    throw Error(JSON.stringify(result));
  if ((await page.locator("#downloads a").count()) !== 2)
    throw Error("Missing downloads");
  await page.getByRole("button", { name: "Check receipt on Sepolia" }).click();
  await page.waitForFunction(
    () => !document.querySelector("#check-chain").disabled,
    null,
    { timeout: 50000 },
  );
  console.log(
    "Chain check:",
    await page.locator("#chain-status").textContent(),
  );
  await mkdir("artifacts/demo", { recursive: true });
  await page.screenshot({ path: "artifacts/demo/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile horizontal overflow");
  await page.screenshot({ path: "artifacts/demo/mobile.png", fullPage: true });
  await page.selectOption("#mode", "live");
  await page.fill("#request", "{}");
  await page.getByRole("button", { name: "Run execution" }).click();
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "ERROR",
  );
  if (errors.length) throw Error(errors.join("\n"));
  console.log("Demo browser smoke passed:", JSON.stringify(result));
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.close(r));
}
