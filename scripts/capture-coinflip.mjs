// Run locally: prepares two signed, historical Sepolia rounds. Never publishes a key.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { pedersen } from "@scure/starknet";
import { startServer } from "./server.mjs";
import {
  unsignedBalanceRequest,
  signTransaction,
  selector,
  hex,
  CHAIN_ID,
} from "./transaction.mjs";
const deployment = JSON.parse(
  await readFile("evidence/coinflip-deployment.json"),
);
const endpoint = "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
async function rpc(method, params) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw Error(j.error.message);
  return j.result;
}
if (BigInt(await rpc("starknet_chainId", [])) !== CHAIN_ID)
  throw Error("Wrong chain");
const header = await rpc("starknet_getBlockWithTxHashes", {
  block_id: "latest",
});
const address = process.env.STARKNET_ACCOUNT_ADDRESS;
if (!address)
  throw Error("Set STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY locally");
const nonce = await rpc("starknet_getNonce", {
  block_id: { block_hash: header.block_hash },
  contract_address: address,
});
const source = { endpoint, block_id: { block_hash: header.block_hash } };
const inputs = [0, 1].map((bet) => {
  const request = unsignedBalanceRequest(address, nonce);
  request.transaction.calldata = [
    "0x1",
    deployment.contract_address,
    selector("play"),
    "0x3",
    hex(header.block_number),
    hex(address),
    hex(bet),
  ];
  request.transaction = signTransaction(
    request.transaction,
    process.env.STARKNET_PRIVATE_KEY,
  ).transaction;
  return { request, source, bet };
});
// The browser receives only public signed inputs, never the signing environment.
const server = await startServer(0);
const browser = await chromium.launch({
  headless: true,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" },
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.startRun);
  await mkdir("fixtures/coinflip", { recursive: true });
  for (const input of inputs) {
    await page.evaluate(
      (i) => window.startRun(i.request, i.source, { executionOnly: true }),
      input,
    );
    await page.waitForFunction(
      () => window.runComplete || window.runError,
      null,
      { timeout: 180000 },
    );
    const error = await page.evaluate(() => window.runError);
    if (error) throw Error(error);
    const result = await page.evaluate(() => window.runComplete);
    delete result.pie;
    result.coinflip = {
      contract_address: deployment.contract_address,
      player: hex(address),
      seed: hex(header.block_number),
      bet: input.bet,
      outcome: Number(
        BigInt(pedersen(hex(header.block_number), hex(address))) & 1n,
      ),
    };
    await writeFile(
      `fixtures/coinflip/${input.bet === 0 ? "heads" : "tails"}.json`,
      JSON.stringify(result),
    );
    console.log(
      JSON.stringify({
        bet: input.bet,
        output: result.output,
        report: result.report,
        coinflip: result.coinflip,
      }),
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
