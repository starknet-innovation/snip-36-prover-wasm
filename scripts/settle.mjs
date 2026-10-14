// Settle a revealed CoinFlip round from the command line with a local sncast account.
// Fallback for wallets that do not answer proof-bearing invocations. Settlement is
// permissionless and always pays the recorded player, so any funded account may submit it.
// Dry run by default; pass --send to broadcast.
import { readFile } from "node:fs/promises";
import { testWallet } from "./live-wallet-adapter.mjs";
import {
  readGame,
  proofMaterial,
  settleCalls,
  rpc,
} from "../web/live-core.mjs";

const [proofFile, recoveryFile] = process.argv
  .slice(2)
  .filter((a) => a !== "--send");
if (!proofFile || !recoveryFile)
  throw Error(
    "usage: npm run settle -- coinflip-proof.json coinflip-recovery.json [--send]\n" +
      "Signs with SNCAST_ACCOUNT (or STARKNET_ACCOUNT_ADDRESS/STARKNET_PRIVATE_KEY).",
  );
const config = JSON.parse(await readFile("web/live-config.json", "utf8"));
const proof = JSON.parse(await readFile(proofFile, "utf8"));
const round = JSON.parse(await readFile(recoveryFile, "utf8"));

const game = await readGame(config, round.id);
if (game.state !== 3)
  throw Error(`Round is not awaiting settlement (state ${game.state})`);
proofMaterial(proof, config, round, game); // Throws unless the proof binds this exact round.
const calls = settleCalls(round, game);
console.log("Settle call:", JSON.stringify(calls));
console.log("Payout goes to player", game.player);

if (!process.argv.includes("--send")) {
  console.log(
    "Dry run passed. Re-run with --send to broadcast one Sepolia transaction.",
  );
  process.exit(0);
}
const wallet = await testWallet(
  config,
  process.env.SETTLE_RUN_DIR || "artifacts/settle",
);
console.log("Signing with", wallet.address);
const { transaction_hash } = await wallet.settle(round, proof);
for (let i = 0; i < 100; i++) {
  try {
    const r = await rpc("starknet_getTransactionReceipt", { transaction_hash });
    if (r.block_hash) {
      console.log(
        r.execution_status,
        r.finality_status,
        "block",
        r.block_number,
      );
      if (r.execution_status !== "SUCCEEDED")
        throw Error(
          "Settlement reverted: " + (r.revert_reason ?? transaction_hash),
        );
      process.exit(0);
    }
  } catch (e) {
    if (e.code !== 29) throw e;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
throw Error(
  "Still pending: " + transaction_hash + ". Do not resend; check it later.",
);
