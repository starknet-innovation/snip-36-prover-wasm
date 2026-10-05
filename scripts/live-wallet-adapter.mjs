// Test-only Wallet API adapter. Signing stays in Node; this file is never bundled into Pages.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { getStarkKey } from "@scure/starknet";
import {
  CHAIN,
  STRK,
  hex,
  selector,
  rpc,
  readGame,
  settleCalls,
  depositCalls,
  revealCalls,
  validateRound,
} from "../web/live-core.mjs";
import {
  unsignedBalanceRequest,
  signTransaction,
  bounds,
  feeCeiling,
} from "./transaction.mjs";
export async function testWallet(config, dir) {
  await mkdir(dir, { recursive: true });
  let address = process.env.STARKNET_ACCOUNT_ADDRESS,
    key = process.env.STARKNET_PRIVATE_KEY;
  if (!key) {
    const accounts = JSON.parse(
      await readFile(
        process.env.SNCAST_ACCOUNTS_FILE ||
          `${process.env.HOME}/.starknet_accounts/starknet_open_zeppelin_accounts.json`,
      ),
    );
    const account =
      accounts["alpha-sepolia"][
        process.env.SNCAST_ACCOUNT || "snip36-e2e-9bdd77aa"
      ];
    address = account.address;
    key = account.private_key;
  }
  address = hex(address);
  if (hex(await rpc("starknet_chainId", [])) !== CHAIN)
    throw Error("Sepolia only");
  const pub = await rpc("starknet_call", {
    block_id: "latest",
    request: {
      contract_address: address,
      entry_point_selector: selector("get_public_key"),
      calldata: [],
    },
  });
  if (hex(pub[0]) !== hex(getStarkKey(key)))
    throw Error("Account credential mismatch");
  const previous = (await readdir(dir)).filter((n) =>
    /^intent-\d+\.json$/.test(n),
  );
  for (const name of previous) {
    const old = JSON.parse(await readFile(`${dir}/${name}`));
    const receipt = await rpc("starknet_getTransactionReceipt", {
      transaction_hash: old.hash,
    });
    if (!receipt.block_hash)
      throw Error("Previous submission remains unresolved: " + old.hash);
  }
  let index = previous.length;
  async function submit(calls, proof) {
    const head = await rpc("starknet_getBlockWithTxHashes", {
      block_id: "latest",
    });
    const nonce = await rpc("starknet_getNonce", {
      block_id: "latest",
      contract_address: address,
    });
    if (
      BigInt(nonce) !==
      BigInt(
        await rpc("starknet_getNonce", {
          block_id: "pre_confirmed",
          contract_address: address,
        }),
      )
    )
      throw Error("Account has a pending transaction");
    const prices = Object.fromEntries(
      ["l1_gas", "l2_gas", "l1_data_gas"].map((k) => [
        k,
        head[k + "_price"].price_in_fri,
      ]),
    );
    const resources = bounds(prices);
    if (!proof) {
      resources.l1_gas.max_amount = hex(500);
      resources.l2_gas.max_amount = hex(20000000);
      resources.l1_data_gas.max_amount = hex(1000);
    }
    if (feeCeiling(resources) > 25n * 10n ** 18n)
      throw Error("Fee ceiling exceeds 25 test STRK");
    const tx = {
      ...unsignedBalanceRequest(address, nonce).transaction,
      resource_bounds: resources,
      calldata: [
        hex(calls.length),
        ...calls.flatMap((c) => [
          c.contract_address,
          selector(c.entry_point),
          hex(c.calldata.length),
          ...c.calldata,
        ]),
      ],
    };
    if (proof) tx.proof_facts = proof.proof_facts;
    const signed = signTransaction(tx, key),
      payload = { ...signed.transaction, type: "INVOKE", version: "0x3" };
    if (proof) payload.proof = proof.data;
    // Exclusive journal file prevents accidental rebroadcast when a run is restarted.
    const file = `${dir}/intent-${index++}.json`;
    const intent = {
      hash: signed.hash,
      payload,
      fee_ceiling: feeCeiling(resources).toString(),
    };
    await writeFile(file, JSON.stringify(intent, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    let result;
    if (proof) {
      const response = await fetch(
        "https://alpha-sepolia.starknet.io/gateway/add_transaction",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            type: "INVOKE_FUNCTION",
            resource_bounds: Object.fromEntries(
              Object.entries(resources).map(([k, v]) => [k.toUpperCase(), v]),
            ),
          }),
          signal: AbortSignal.timeout(120000),
        },
      );
      result = await response.json();
      if (!response.ok || result.code !== "TRANSACTION_RECEIVED")
        throw Error(JSON.stringify(result));
    } else
      result = await rpc("starknet_addInvokeTransaction", {
        invoke_transaction: payload,
      });
    if (hex(result.transaction_hash) !== signed.hash)
      throw Error("Submission hash mismatch");
    console.log(
      "Submitted",
      calls.map((c) => c.entry_point).join("+"),
      signed.hash,
    );
    return { transaction_hash: signed.hash };
  }
  return {
    address,
    async fund() {
      return submit([
        {
          contract_address: STRK,
          entry_point: "approve",
          calldata: [config.bank, hex(10n ** 18n), "0x0"],
        },
        {
          contract_address: config.bank,
          entry_point: "fund",
          calldata: [hex(10n ** 18n), "0x0"],
        },
      ]);
    },
    async request(request, round) {
      switch (request.type) {
        case "wallet_requestAccounts":
          return [address];
        case "wallet_requestChainId":
          return CHAIN;
        case "wallet_getPermissions":
          return ["accounts"];
        case "wallet_supportedWalletApi":
          return ["0.10.3"];
        case "wallet_addInvokeTransaction": {
          validateRound(round, address, config.bank);
          const g = await readGame(config, round.id),
            p = request.params;
          const expected =
            g.state === 0
              ? depositCalls(round)
              : g.state === 2
                ? revealCalls(round)
                : g.state === 3
                  ? settleCalls(round, g)
                  : null;
          if (
            !expected ||
            JSON.stringify(p.invoke_transaction) !== JSON.stringify(expected)
          )
            throw Error("Test adapter refuses unexpected calls");
          if (g.state === 3 && !p.proof)
            throw Error("Proof required for settlement");
          if (g.state !== 3 && p.proof) throw Error("Unexpected proof");
          return submit(expected, p.proof);
        }
        default:
          throw Error("Unsupported test-wallet method " + request.type);
      }
    },
  };
}
