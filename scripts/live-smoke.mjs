// Browser UX checks use stubbed chain state; no signing keys or transactions.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { startServer } from "./server.mjs";
import { CHAIN, STRK, selector } from "../web/live-core.mjs";
const config = JSON.parse(await readFile("web/live-config.json"));
const server = await startServer(0),
  browser = await chromium.launch({ headless: true });
try {
  for (const scenario of ["unsupported", "wrong-network", "pending"]) {
    const page = await browser.newPage();
    let submitted = 0;
    await page.route("https://api.zan.top/**", async (route) => {
      const q = route.request().postDataJSON();
      let result, error;
      if (q.method === "starknet_chainId") result = CHAIN;
      else if (q.method === "starknet_blockNumber") result = 100;
      else if (q.method === "starknet_getClassHashAt")
        result =
          q.params.contract_address === config.bank
            ? config.bank_class_hash
            : config.executor_class_hash;
      else if (q.method === "starknet_getTransactionReceipt")
        error = { code: 29, message: "Transaction hash not found" };
      else if (q.params.request.entry_point_selector === selector("get_config"))
        result = [config.owner, config.coinflip, STRK];
      else if (q.params.request.entry_point_selector === selector("liquidity"))
        result = ["0xde0b6b3a7640000", "0x0"];
      else result = Array(9).fill("0x0");
      await route.fulfill({
        json: { jsonrpc: "2.0", id: q.id, ...(error ? { error } : { result }) },
      });
    });
    await page.exposeFunction("walletTestCall", () => {
      submitted++;
      return { transaction_hash: "0x123" };
    });
    await page.addInitScript(
      ({ scenario, CHAIN }) => {
        window.starknet_test = {
          id: "test",
          name: "Test wallet",
          version: "1",
          icon: "",
          on() {},
          off() {},
          async request(r) {
            if (r.type === "wallet_getPermissions") return ["accounts"];
            if (r.type === "wallet_requestAccounts") return ["0x6"];
            if (r.type === "wallet_requestChainId")
              return scenario === "wrong-network" ? "0x1" : CHAIN;
            if (r.type === "wallet_supportedWalletApi")
              return scenario === "unsupported" ? ["0.10.2"] : ["0.10.3"];
            return window.walletTestCall();
          },
        };
      },
      { scenario, CHAIN },
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/play.html`);
    await page.waitForFunction(() =>
      document.querySelector("#wallets").textContent.includes("Test wallet"),
    );
    await page.click("#connect");
    if (scenario === "wrong-network") {
      await page.waitForFunction(() =>
        document
          .querySelector("#live-status")
          .textContent.includes("Switch your wallet"),
      );
    } else {
      await page.waitForFunction(() =>
        document.querySelector("#wallet-status").textContent.includes("0x6"),
      );
      await page.check("#ready");
    }
    if (scenario === "pending") {
      await page.click("#next");
      await page.waitForFunction(
        () => window.coinflipLive.state.round?.transactions.deposit?.hash,
      );
      await page.reload();
      await page.waitForFunction(() =>
        document.querySelector("#wallets").textContent.includes("Test wallet"),
      );
      await page.click("#connect");
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("#next").textContent ===
          "Check pending wallet transaction",
      );
      if (submitted !== 1) throw Error("Pending submission was repeated");
    }
    if (!(await page.locator("#next").isDisabled()))
      throw Error("Unsafe action enabled: " + scenario);
    await page.setViewportSize({ width: 390, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Mobile overflow");
    await page.close();
    console.log("Live UI smoke:", scenario);
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
