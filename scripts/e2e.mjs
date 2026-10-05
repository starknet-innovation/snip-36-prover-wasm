import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  CHAIN_ID,
  STRK,
  PROGRAM,
  hex,
  selector,
  unsignedBalanceRequest,
  signTransaction,
  transactionHash,
  bounds,
  feeCeiling,
  proofFacts,
} from "./transaction.mjs";
import { validateCaptureForExecution } from "./verify-capture-inputs.mjs";
const RPC = "https://api.zan.top/public/starknet-sepolia/rpc/v0_10",
  GATEWAY = "https://alpha-sepolia.starknet.io/gateway/add_transaction";
const dir = path.resolve(process.env.RUN_DIR ?? "artifacts/run");
await mkdir(dir, { recursive: true });
const read = async (name) =>
  JSON.parse(await readFile(path.join(dir, name), "utf8"));
const save = async (name, value, exclusive = false) =>
  writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + "\n", {
    flag: exclusive ? "wx" : "w",
  });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => {
  if (
    typeof a === "string" &&
    a.startsWith("0x") &&
    typeof b === "string" &&
    b.startsWith("0x")
  )
    return BigInt(a) === BigInt(b);
  if (Array.isArray(a))
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  if (a && typeof a === "object")
    return (
      b &&
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(([k, v]) => same(v, b[k]))
    );
  return a === b;
};
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) {
    const e = Error(`RPC ${data.error.code}: ${data.error.message}`);
    e.code = data.error.code;
    throw e;
  }
  return data.result;
}
const nonce = (address, block = "pre_confirmed") =>
  rpc("starknet_getNonce", { block_id: block, contract_address: address });
const call = (address, name, calldata, block = "latest") =>
  rpc("starknet_call", {
    block_id: block,
    request: {
      contract_address: address,
      entry_point_selector: selector(name),
      calldata,
    },
  });
const balance = async (address, block = "latest") => {
  const v = await call(STRK, "balance_of", [address], block);
  return BigInt(v[0]) + (BigInt(v[1]) << 128n);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function chain() {
  if (BigInt(await rpc("starknet_chainId", [])) !== CHAIN_ID)
    throw Error("Refusing non-Sepolia network");
}
function checkCall(tx, address) {
  if (
    !same(tx.sender_address, address) ||
    !same(tx.calldata, ["0x1", STRK, selector("balance_of"), "0x1", address]) ||
    BigInt(tx.tip) !== 0n ||
    tx.paymaster_data.length ||
    tx.account_deployment_data.length
  )
    throw Error("Only the intended balance query may be submitted");
}
async function validateArtifacts() {
  const execution = await read("execution.json"),
    proof = await read("proof.json");
  if (
    !execution.ok ||
    execution.kind !== "execution" ||
    !proof.ok ||
    proof.kind !== "proof" ||
    execution.run_id !== proof.run_id
  )
    throw Error("Incomplete or unrelated browser receipts");
  if (
    sha(Buffer.from(execution.pie)) !== execution.report.pie_sha256 ||
    execution.report.pie_sha256 !== proof.report.pie_sha256 ||
    sha(Buffer.from(proof.proof)) !== proof.report.proof_sha256
  )
    throw Error("Browser artifact digest mismatch");
  for (const k of ["request", "anchor", "execution", "output"])
    if (!same(execution[k], proof[k]))
      throw Error("Browser receipt linkage mismatch: " + k);
  await validateCaptureForExecution(execution);
  const facts = proofFacts(proof.output_preimage),
    raw = execution.output;
  if (
    !same(proof.output_preimage.slice(3), raw) ||
    !same(raw[0], hex(BigInt("0x5649525455414c5f534e4f5330"))) ||
    BigInt(raw[1]) !== BigInt(execution.anchor.header.block_number) ||
    !same(raw[2], execution.anchor.header.block_hash) ||
    !same(raw[3], execution.execution.expected_config_hash) ||
    BigInt(raw[4]) !== 0n ||
    raw.length !== 5
  )
    throw Error("Wrong public statement for balance query");
  if (
    !same(
      transactionHash(execution.request.transaction),
      execution.execution.transaction_hash,
    ) ||
    execution.execution.execution.revert_error !== null ||
    execution.execution.execution.validate_call_info.execution.failed
  )
    throw Error("Browser account execution validation failed");
  const replay = await read("replay.json"),
    negative = await read("invalid-signature.json");
  if (
    replay.report.pie_sha256 !== execution.report.pie_sha256 ||
    !negative.rejected
  )
    throw Error("Missing browser replay/signature controls");
  return { execution, proof, facts };
}
async function prepare() {
  await chain();
  const address = hex(process.env.STARKNET_ACCOUNT_ADDRESS);
  const header = await rpc("starknet_getBlockWithTxHashes", {
      block_id: "latest",
    }),
    block = { block_hash: header.block_hash };
  const n = await nonce(address, block),
    pending = await nonce(address);
  if (!same(n, pending))
    throw Error(
      "Account has pending transactions; retry in a fresh run after confirmation",
    );
  const publicKey = (await call(address, "get_public_key", [], block))[0];
  const request = unsignedBalanceRequest(address, n);
  const signed = signTransaction(
    request.transaction,
    process.env.STARKNET_PRIVATE_KEY,
  );
  if (!same(publicKey, signed.publicKey))
    throw Error("Signing key differs from on-chain account key");
  request.transaction = signed.transaction;
  await save(
    "browser-input.json",
    { request, source: { endpoint: RPC, block_id: block } },
    true,
  );
  await save("preflight.json", {
    network: "SN_SEPOLIA",
    address,
    public_key: publicKey,
    nonce: n,
    block_number: header.block_number,
    block_hash: header.block_hash,
    virtual_transaction_hash: signed.hash,
  });
  console.log(
    `Prepared signed balance query at Sepolia block ${header.block_number}.`,
  );
}
async function signSubmission() {
  await chain();
  const { execution, proof, facts } = await validateArtifacts();
  const pre = await read("preflight.json");
  checkCall(execution.request.transaction, pre.address);
  if (!same(await nonce(pre.address), pre.nonce))
    throw Error(
      "Account nonce changed during proving; do not submit stale run",
    );
  const header = await rpc("starknet_getBlockWithTxHashes", {
    block_id: "latest",
  });
  if (header.block_number < pre.block_number + 10)
    throw Error("Proof block is too recent; wait at least ten blocks");
  const stored = await rpc("starknet_getStorageAt", {
    block_id: { block_hash: header.block_hash },
    contract_address: "0x1",
    key: hex(pre.block_number),
  });
  if (!same(stored, pre.block_hash))
    throw Error("Network stored block hash disagrees with proven snapshot");
  const prices = Object.fromEntries(
    ["l1_gas", "l2_gas", "l1_data_gas"].map((k) => [
      k,
      header[k + "_price"].price_in_fri,
    ]),
  );
  const resource_bounds = bounds(prices),
    maximum = feeCeiling(resource_bounds),
    funds = await balance(pre.address);
  if (maximum > 25n * 10n ** 18n)
    throw Error("Maximum fee exceeds fixed 25 testnet STRK budget");
  if (funds <= maximum) throw Error("Insufficient testnet STRK");
  const signed = signTransaction(
    { ...execution.request.transaction, resource_bounds, proof_facts: facts },
    process.env.STARKNET_PRIVATE_KEY,
  );
  if (!same(signed.publicKey, pre.public_key)) throw Error("Signer changed");
  const payload = {
    ...signed.transaction,
    type: "INVOKE",
    version: "0x3",
    proof: Buffer.from(proof.proof).toString("base64"),
  };
  await save("signed-payload.json", payload, true);
  await save(
    "submission-plan.json",
    {
      network: "SN_SEPOLIA",
      transaction_hash: signed.hash,
      account: pre.address,
      nonce: pre.nonce,
      proof_sha256: proof.report.proof_sha256,
      pie_sha256: execution.report.pie_sha256,
      program_hash: PROGRAM,
      proving_utils_revision: "3035dd00421daa541894297bd754db6e2787807b",
      fee_ceiling_fri: maximum.toString(),
      balance_before_fri: funds.toString(),
      created_at: new Date().toISOString(),
    },
    true,
  );
  console.log(
    `Submission prepared: ${signed.hash}; max fee ${Number(maximum) / 1e18} testnet STRK.`,
  );
}
async function submit() {
  if (process.env.STARKNET_PRIVATE_KEY)
    throw Error("Submission step must not receive private key");
  await chain();
  const plan = await read("submission-plan.json"),
    payload = await read("signed-payload.json");
  checkCall(payload, plan.account);
  if (
    transactionHash(payload) !== plan.transaction_hash ||
    sha(Buffer.from(payload.proof, "base64")) !== plan.proof_sha256 ||
    feeCeiling(payload.resource_bounds).toString() !== plan.fee_ceiling_fri ||
    feeCeiling(payload.resource_bounds) > 25n * 10n ** 18n
  )
    throw Error("Submission plan changed");
  if (!same(await nonce(plan.account), plan.nonce))
    throw Error("Nonce changed before broadcast");
  await save(
    "submission-intent.json",
    {
      ...plan,
      gateway: GATEWAY,
      payload_sha256: sha(Buffer.from(JSON.stringify(payload))),
    },
    true,
  );
  const gatewayPayload = {
    ...payload,
    type: "INVOKE_FUNCTION",
    resource_bounds: Object.fromEntries(
      Object.entries(payload.resource_bounds).map(([k, v]) => [
        k.toUpperCase(),
        v,
      ]),
    ),
  };
  // Exactly one broadcast. Unknown transport outcomes must be reconciled by transaction hash.
  let result;
  try {
    const response = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gatewayPayload),
      signal: AbortSignal.timeout(120000),
    });
    result = await response.json();
    await save("submission-response.json", {
      http_status: response.status,
      ...result,
    });
    if (
      result.code !== "TRANSACTION_RECEIVED" ||
      !same(result.transaction_hash, plan.transaction_hash)
    )
      throw Error("Gateway rejected transaction; see saved response");
  } catch (error) {
    await save("submission-error.json", {
      message: error.message,
      expected_transaction_hash: plan.transaction_hash,
      action: "Reconcile this hash; do not automatically rebroadcast",
    });
    throw error;
  }
  let receipt;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    try {
      const r = await rpc("starknet_getTransactionReceipt", {
        transaction_hash: plan.transaction_hash,
      });
      if (r.execution_status === "REVERTED") {
        await save("receipt.json", r);
        throw Error("Transaction reverted");
      }
      if (
        ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"].includes(r.finality_status) &&
        r.block_number !== undefined
      ) {
        receipt = r;
        break;
      }
    } catch (e) {
      if (e.code !== 29) throw e;
    }
    await sleep(5000);
  }
  if (!receipt)
    throw Error("Receipt timeout; reconcile saved hash without rebroadcasting");
  await save("receipt.json", receipt);
  if (receipt.execution_status !== "SUCCEEDED")
    throw Error("Transaction did not succeed");
  const tx = await rpc("starknet_getTransactionByHash", {
    transaction_hash: plan.transaction_hash,
  });
  await save("transaction.json", tx);
  for (const [k, v] of Object.entries(payload))
    if (!["proof", "proof_facts"].includes(k) && !same(v, tx[k]))
      throw Error("Included signed field differs: " + k);
  const block = { block_hash: receipt.block_hash };
  const header = await rpc("starknet_getBlockWithTxHashes", {
    block_id: block,
  });
  if (!header.transactions.some((h) => same(h, plan.transaction_hash)))
    throw Error("Missing from closed block");
  const after = await nonce(plan.account, block),
    funds = await balance(plan.account, block),
    fee = BigInt(receipt.actual_fee.amount);
  if (
    BigInt(after) !== BigInt(plan.nonce) + 1n ||
    receipt.actual_fee.unit !== "FRI" ||
    fee > BigInt(plan.fee_ceiling_fri)
  )
    throw Error("Unexpected nonce or fee");
  const report = {
    ...plan,
    block_number: receipt.block_number,
    block_hash: receipt.block_hash,
    execution_status: receipt.execution_status,
    finality_status: receipt.finality_status,
    actual_fee_fri: fee.toString(),
    actual_fee_strk: Number(fee) / 1e18,
    nonce_after: after,
    balance_after_fri: funds.toString(),
    balance_delta_equals_fee: BigInt(plan.balance_before_fri) - funds === fee,
    returned_signed_fields_match: true,
    proof_fields_returned_by_rpc: "proof_facts" in tx,
    scope:
      "Real Chromium execution and proving followed by successful proof-bearing Sepolia transaction; no independent L1 finality claim",
  };
  await save("onchain-verification.json", report);
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Sepolia browser E2E passed\n\n[Transaction](https://sepolia.voyager.online/tx/${plan.transaction_hash}) — ${receipt.execution_status}, ${receipt.finality_status}, block ${receipt.block_number}. Fee: ${report.actual_fee_strk} testnet STRK.\n`,
      { flag: "a" },
    );
}
try {
  const mode = process.argv[2];
  if (mode === "prepare") await prepare();
  else if (mode === "sign") await signSubmission();
  else if (mode === "submit") await submit();
  else throw Error("Usage: e2e.mjs prepare | sign | submit");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
