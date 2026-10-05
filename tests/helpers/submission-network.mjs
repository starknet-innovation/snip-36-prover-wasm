// Preloaded only by submission-flow.test.mjs. No request reaches the network.
import assert from "node:assert/strict";
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
const dir = process.env.RUN_DIR;
const load = async (name) =>
  JSON.parse(await readFile(path.join(dir, name), "utf8"));
const plan = await load("submission-plan.json");
const transaction = await load("mock-transaction.json");
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  await appendFile(
    path.join(dir, "network-calls.jsonl"),
    JSON.stringify({ url, body }) + "\n",
  );
  if (url === "https://alpha-sepolia.starknet.io/gateway/add_transaction") {
    assert.equal(
      (await load("submission-intent.json")).transaction_hash,
      plan.transaction_hash,
    );
    if (process.env.SUBMISSION_TEST_SCENARIO === "transport-error")
      throw Error("Simulated unknown transport outcome");
    return Response.json({
      code: "TRANSACTION_RECEIVED",
      transaction_hash: plan.transaction_hash,
    });
  }
  assert.equal(url, "https://api.zan.top/public/starknet-sepolia/rpc/v0_10");
  let result;
  switch (body.method) {
    case "starknet_chainId":
      result = "0x534e5f5345504f4c4941";
      break;
    case "starknet_getNonce":
      result =
        body.params.block_id === "pre_confirmed"
          ? plan.nonce
          : "0x" + (BigInt(plan.nonce) + 1n).toString(16);
      break;
    case "starknet_getTransactionReceipt":
      result = {
        execution_status: "SUCCEEDED",
        finality_status: "ACCEPTED_ON_L2",
        block_number: 100,
        block_hash: "0x123",
        actual_fee: { amount: "0x1", unit: "FRI" },
      };
      break;
    case "starknet_getTransactionByHash":
      result = structuredClone(transaction);
      if (process.env.SUBMISSION_TEST_SCENARIO === "changed-bound")
        result.resource_bounds.l2_gas.max_amount = "0x1";
      break;
    case "starknet_getBlockWithTxHashes":
      result = { transactions: [plan.transaction_hash] };
      break;
    case "starknet_call":
      result = ["0x63", "0x0"];
      break;
    default:
      throw Error("Unexpected test RPC: " + body.method);
  }
  return Response.json({ jsonrpc: "2.0", id: body.id, result });
};
