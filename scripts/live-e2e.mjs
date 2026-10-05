import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { startServer } from "./server.mjs";
import { testWallet } from "./live-wallet-adapter.mjs";
import {
  proofMaterial,
  rpc,
  hex,
  selector,
  outcome,
  STRK,
} from "../web/live-core.mjs";
const dir = process.env.LIVE_RUN_DIR || "artifacts/live-run";
await mkdir(dir, { recursive: true });
const config = JSON.parse(await readFile("web/live-config.json"));
const wallet = await testWallet(config, dir);
if (process.argv.includes("--fund")) {
  console.log(await wallet.fund());
  process.exit(0);
}
const server = await startServer(0);
const browser = await chromium.launch({
  headless: true,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" },
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeBinding("testWalletRequest", async (_, request, round) =>
    wallet.request(request, round),
  );
  await page.addInitScript(() => {
    window.starknet_coinflip_test = {
      id: "coinflip-test",
      name: "Sepolia test wallet (sncast adapter)",
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      version: "1",
      on() {},
      off() {},
      request: (r) =>
        window.testWalletRequest(r, window.coinflipLive?.state.round),
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/play.html`);
  await page.waitForFunction(
    () =>
      document.querySelector("#wallets").textContent.includes("sncast adapter"),
    null,
    { timeout: 60000 },
  );
  await page.click("#connect");
  await page.waitForFunction(
    () =>
      document
        .querySelector("#wallet-status")
        .textContent.includes("Proof API"),
    null,
    { timeout: 30000 },
  );
  await page.waitForFunction(()=>!window.coinflipLive.state.busy);
  // Restore an interrupted run without repeating a transaction. Original intent journal remains authoritative.
  if (process.env.LIVE_RESUME) {
    const r = JSON.parse(await readFile(process.env.LIVE_RESUME));
    await page.locator("#restore").setInputFiles({
      name: "recovery.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(r)),
    });
    await page.waitForFunction(() => !!window.coinflipLive.state.round);
  }
  await page.check("#ready");
  const start = Date.now();
  let last = "";
  let proofChecked = false,
    verified = false,
    prooflessRejected = false;
  const attempted = new Set();
  while (Date.now() - start < 25 * 60000) {
    const state = await page.evaluate(() => {
      const s = window.coinflipLive.state;
      return {
        round: s.round,
        currentGame: s.currentGame,
        busy: s.busy,
        hasProof: !!s.proof,
        status: document.querySelector("#live-status").textContent,
        next: document.querySelector("#next").textContent,
        disabled: document.querySelector("#next").disabled,
      };
    });
    if (state.round)
      await writeFile(
        `${dir}/recovery.json`,
        JSON.stringify(state.round, null, 2),
        { mode: 0o600 },
      );
    if (state.status !== last) {
      console.log(state.status);
      last = state.status;
    }
    if (errors.length) throw Error(errors.join("\n"));
    if (state.currentGame?.state === 3 && !prooflessRejected) {
      try {
        await rpc("starknet_call", {
          block_id: "latest",
          request: {
            contract_address: config.bank,
            entry_point_selector: selector("settle"),
            calldata: [state.round.id, hex(outcome(state.currentGame))],
          },
        });
        throw Error("Proofless settlement unexpectedly accepted");
      } catch (e) {
        if (
          e.code !== 40 ||
          !JSON.stringify(e.data).includes("Expected one proof message")
        )
          throw e;
        prooflessRejected = true;
      }
    }
    if (state.currentGame?.state === 4) {
      const receipt = state.round.transactions.settle?.receipt;
      if (receipt?.execution_status !== "SUCCEEDED" || !receipt.block_hash)
        throw Error("Settlement has no successful closed-block receipt");
      const won = outcome(state.currentGame) === state.currentGame.choice;
      const payout = receipt.events.some(
        (e) =>
          hex(e.from_address) === STRK &&
          e.keys.length >= 3 &&
          hex(e.keys[0]) === selector("Transfer") &&
          hex(e.keys[1]) === config.bank &&
          hex(e.keys[2]) === state.round.player &&
          BigInt(e.data[0]) + (BigInt(e.data[1]) << 128n) ===
            2n * BigInt(state.round.amount),
      );
      if (won !== payout)
        throw Error("Payout events disagree with proved outcome");
      const evidence = {
        proofless_rejected: prooflessRejected,
        payout_verified: payout,
        won,
        tested_at: new Date().toISOString(),
        transport:
          "Wallet API test adapter backed by sncast account; not a browser extension",
        config,
        round: state.round.id,
        game: state.currentGame,
        transactions: state.round.transactions,
        native_verified: verified,
      };
      await writeFile(`${dir}/result.json`, JSON.stringify(evidence, null, 2));
      await page.screenshot({ path: `${dir}/desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )
      )
        throw Error("Mobile overflow");
      await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
      console.log("Full wallet/browser/Sepolia settlement passed");
      break;
    }
    if (!state.busy && state.hasProof && !proofChecked) {
      const proof = await page.evaluate(() => window.coinflipLive.state.proof);
      proofMaterial(proof, config, state.round, state.currentGame);
      await writeFile(`${dir}/proof.json`, JSON.stringify(proof));
      await writeFile(`${dir}/proof.bin`, Buffer.from(proof.proof));
      await writeFile(
        `${dir}/output.json`,
        JSON.stringify(proof.output_preimage),
      );
      if (process.env.NATIVE_VERIFIER) {
        await promisify(execFile)(
          process.env.NATIVE_VERIFIER,
          [
            "verify",
            `${dir}/proof.bin`,
            `${dir}/output.json`,
            `${dir}/native-verification`,
          ],
          { timeout: 60000 },
        );
        const result = JSON.parse(
          await readFile(`${dir}/native-verification/result.json`),
        );
        if (!result.verified) throw Error("Native verifier failed");
        verified = true;
      }
      proofChecked = true;
      console.log(
        "Browser proof SHA256",
        createHash("sha256").update(Buffer.from(proof.proof)).digest("hex"),
      );
    }
    if (!state.busy && !state.disabled) {
      if (state.hasProof) {
        const proofBlock = await page.evaluate(
          () => window.coinflipLive.state.proof.anchor.header.block_number,
        );
        if ((await rpc("starknet_blockNumber", [])) < proofBlock + 10) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
      }
      const action = `${state.currentGame?.state ?? 0}-${state.hasProof}`;
      if (attempted.has(action))
        throw Error(
          "Action failed; inspect status and journal before retry: " +
            state.status,
        );
      attempted.add(action);
      await page.click("#next");
    } else if (
      !state.busy &&
      /error|failed|mismatch|revert|unsupported|refuses|outside|invalid/i.test(
        state.status,
      )
    ) {
      throw Error(state.status);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const final = await page.evaluate(
    () => window.coinflipLive.state.currentGame?.state,
  );
  if (final !== 4)
    throw Error(
      "Live E2E timed out; recover from saved round and intent hashes",
    );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
