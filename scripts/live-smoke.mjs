// Browser UX checks use stubbed chain state; no signing keys or transactions.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { startServer } from "./server.mjs";
import { CHAIN, STRK, selector } from "../web/live-core.mjs";
const config = JSON.parse(await readFile("web/live-config.json"));
const server = await startServer(0),
  browser = await chromium.launch({ headless: true });
try {
  for (const scenario of [
    "unsupported",
    "wrong-network",
    "switch-success",
    "switch-rejected",
    "unchecked",
    "invalid-stake",
    "wallet-waiting",
    "wallet-rejected",
    "pending",
  ]) {
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
      if (scenario === "wallet-waiting") return new Promise(() => {});
      if (scenario === "wallet-rejected")
        throw Error("User rejected the wallet request");
      return { transaction_hash: "0x123" };
    });
    await page.addInitScript(
      ({ scenario, CHAIN }) => {
        let chain = [
          "wrong-network",
          "switch-success",
          "switch-rejected",
        ].includes(scenario)
          ? "0x534e5f4d41494e"
          : CHAIN;
        window.switchRequests = 0;
        window.starknet_test = {
          id: "test",
          name: "Test wallet",
          version: "1",
          icon: "",
          on() {},
          off() {},
          async request(r) {
            // Strict wallet bridges validate the object before JSON serialization.
            if (
              r.params &&
              Object.values(r.params).some((v) => v === undefined)
            )
              throw Error("The request payload is invalid");
            if (r.type === "wallet_getPermissions") return ["accounts"];
            if (r.type === "wallet_requestAccounts") return ["0x6"];
            if (r.type === "wallet_requestChainId") return chain;
            if (r.type === "wallet_switchStarknetChain") {
              window.switchRequests++;
              if (r.params.chainId !== CHAIN) throw Error("Wrong target chain");
              if (scenario === "switch-rejected") throw Error("User rejected");
              if (scenario === "switch-success") chain = CHAIN;
              return true;
            }
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
    if (["wrong-network", "switch-rejected"].includes(scenario)) {
      await page.waitForFunction(() =>
        document
          .querySelector("#live-status")
          .textContent.match(/Switch your wallet|could not switch/),
      );
    } else {
      await page.waitForFunction(() =>
        document.querySelector("#wallet-status").textContent.includes("0x6"),
      );
      await page.waitForFunction(() => !window.coinflipLive.state.busy);
      if (!["unchecked", "switch-success"].includes(scenario))
        await page.check("#ready");
    }
    const expectedSwitches = [
      "wrong-network",
      "switch-success",
      "switch-rejected",
    ].includes(scenario)
      ? 1
      : 0;
    if ((await page.evaluate(() => window.switchRequests)) !== expectedSwitches)
      throw Error("Unexpected network switch request count");
    if (expectedSwitches && submitted)
      throw Error("Switch submitted a transaction");
    if (scenario === "invalid-stake") {
      await page.fill("#stake", "1");
      if (
        !(await page.locator("#next").isDisabled()) ||
        !(await page
          .locator("#stake-error")
          .textContent()
          .then((t) => t.includes("at most 0.01")))
      )
        throw Error("Over-limit stake not blocked visibly");
      await page.fill("#stake", "0.001");
      if (await page.locator("#next").isDisabled())
        throw Error("Corrected stake remains blocked");
      if (submitted) throw Error("Validation submitted a transaction");
      await page.fill("#stake", "1");
    }
    if (scenario === "unchecked") {
      if (
        !(await page
          .locator("#action-hint")
          .textContent()
          .then((t) => t.includes("I can finish this round")))
      )
        throw Error("Missing acknowledgement guidance");
      if (submitted !== 0) throw Error("Submitted without acknowledgement");
    }
    if (["wallet-waiting", "wallet-rejected"].includes(scenario)) {
      await page.click("#next");
      await page.waitForFunction(
        () =>
          document
            .querySelector("#action-status")
            .textContent.includes("Confirm deposit in your wallet") ||
          document
            .querySelector("#action-status")
            .textContent.includes("User rejected"),
      );
      if (scenario === "wallet-rejected") {
        await page.waitForFunction(() => !window.coinflipLive.state.busy);
        if (
          !(await page
            .locator("#action-status")
            .textContent()
            .then((t) => t.includes("User rejected")))
        )
          throw Error("Wallet error not shown beside button");
        if (await page.locator("#next").isDisabled())
          throw Error("Explicit rejection prevents retry");
      }
      if (submitted !== 1) throw Error("Unexpected wallet submission count");
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
    if (
      scenario !== "wallet-rejected" &&
      !(await page.locator("#next").isDisabled())
    )
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
