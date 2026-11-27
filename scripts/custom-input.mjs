// Builds RUN_DIR/browser-input.json for a caller-supplied virtual INVOKE v3.
// Read-only: no key, no signing, no network request. See docs/custom-transactions.md.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { RPC_NETWORKS, felt } from "../web/anchored-rpc.mjs";
import { STRK, bounds, hex, selector } from "./transaction.mjs";

// The executor requires the canonical STRK token on both networks. The Sepolia
// ETH entry is the one the repository's own requests and fixtures already use.
export const NETWORKS = Object.freeze({
  sepolia: Object.freeze({
    chain_id: "SN_SEPOLIA",
    eth_fee_token_address:
      "0x216e06f4761eb833ec9fbc9d08ae554427a2e6f23539d669a26d7e9997222b3",
  }),
  mainnet: Object.freeze({
    chain_id: "SN_MAIN",
    eth_fee_token_address:
      "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  }),
});
// The amount scripts/transaction.mjs uses for the repository's own flows.
export const DEFAULT_L2_GAS = BigInt(
  bounds({ l1_gas: 0, l2_gas: 0, l1_data_gas: 0 }).l2_gas.max_amount,
);
// Stated limit of the virtual OS on the execute phase; a larger bound buys nothing.
export const VIRTUAL_OS_EXECUTE_GAS_CAP = 1110000000n;

// Accepts 0x-hex or decimal and returns the canonical hex felt.
export function toFelt(value) {
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return felt(hex(text));
  if (!/^0x[0-9a-f]{1,64}$/i.test(text))
    throw Error("Not a felt: " + JSON.stringify(value));
  return felt(text);
}
const felts = (values, what) => {
  if (!Array.isArray(values)) throw Error(what + " must be an array of felts");
  return values.map(toFelt);
};

// Serde layout of Array<Call>, the calldata of a standard account's __execute__:
// [n_calls, (to, selector, calldata_len, ...calldata) per call].
export function callArray(calls) {
  if (!Array.isArray(calls) || !calls.length)
    throw Error("At least one call is required");
  return [
    hex(calls.length),
    ...calls.flatMap((call) => {
      if ((call.selector === undefined) === (call.function === undefined))
        throw Error("Give each call either a selector or a function name");
      const inner = felts(call.calldata ?? [], "Call calldata");
      return [
        toFelt(call.to),
        call.function === undefined
          ? toFelt(call.selector)
          : selector(call.function),
        hex(inner.length),
        ...inner,
      ];
    }),
  ];
}

export function buildInput({
  network = "sepolia",
  sender,
  nonce,
  blockHash,
  blockNumber,
  endpoint,
  calls,
  calldata,
  signature = ["0x0"],
  l2Gas = DEFAULT_L2_GAS,
} = {}) {
  if (!Object.hasOwn(NETWORKS, network))
    throw Error("network must be sepolia or mainnet");
  const rpc = RPC_NETWORKS[network];
  endpoint ??= rpc.endpoints[0];
  if (!rpc.endpoints.includes(endpoint))
    throw Error(
      `The browser transport only accepts these ${network} endpoints: ` +
        rpc.endpoints.join(", "),
    );
  if (sender === undefined || nonce === undefined)
    throw Error("sender and nonce are required");
  // A proof is bound to one block, so the source must name it; never "latest".
  if ((blockHash === undefined) === (blockNumber === undefined))
    throw Error("Give exactly one of a block hash or a block number");
  let block_id;
  if (blockHash !== undefined) block_id = { block_hash: toFelt(blockHash) };
  else {
    const number = Number(blockNumber);
    if (!/^\d+$/.test(String(blockNumber)) || !Number.isSafeInteger(number))
      throw Error("Block number must be a non-negative integer");
    block_id = { block_number: number };
  }
  if ((calls === undefined) === (calldata === undefined))
    throw Error("Give either calls or raw calldata, not both");
  // The executor rejects an empty signature even when the account ignores it.
  if (!Array.isArray(signature) || !signature.length)
    throw Error("A placeholder signature of at least one felt is required");
  let amount;
  try {
    amount = BigInt(l2Gas);
  } catch {
    throw Error("l2 gas must be an integer");
  }
  if (amount <= 0n || amount >= 1n << 64n)
    throw Error("l2 gas must be a nonzero uint64");
  // Zero prices and tip are required on input; the amounts stay as in bounds().
  const resource_bounds = bounds({ l1_gas: 0, l2_gas: 0, l1_data_gas: 0 });
  resource_bounds.l2_gas.max_amount = hex(amount);
  return {
    request: {
      captured_chain_id: rpc.chainId,
      chain_info: {
        chain_id: NETWORKS[network].chain_id,
        fee_token_addresses: {
          eth_fee_token_address: NETWORKS[network].eth_fee_token_address,
          strk_fee_token_address: STRK,
        },
        is_l3: false,
      },
      transaction: {
        sender_address: toFelt(sender),
        calldata: calls ? callArray(calls) : felts(calldata, "Raw calldata"),
        signature: felts(signature, "Signature"),
        nonce: toFelt(nonce),
        resource_bounds,
        tip: "0x0",
        paymaster_data: [],
        account_deployment_data: [],
        nonce_data_availability_mode: "L1",
        fee_data_availability_mode: "L1",
      },
    },
    source: { endpoint, block_id },
  };
}

export const USAGE = `Usage: node scripts/custom-input.mjs --sender 0x.. --nonce N
    (--block-hash 0x.. | --block-number N)
    (--to 0x.. (--function NAME | --selector 0x..) [--calldata A,B,.. | --calldata-file FILE]
     | --raw-calldata-file FILE)
    [--network sepolia|mainnet] [--endpoint URL] [--signature A,B,..]
    [--l2-gas N] [--out DIR] [--force]

Writes DIR/browser-input.json (default RUN_DIR or artifacts/run). Felts are 0x-hex or
decimal; FILE is a JSON array of felts. --raw-calldata-file is the account's whole
__execute__ calldata, for example a serialised Array<Call> with several calls.
--signature defaults to the placeholder 0x0. --l2-gas defaults to ${DEFAULT_L2_GAS};
the virtual OS caps the execute phase at ${VIRTUAL_OS_EXECUTE_GAS_CAP} Sierra gas.`;

const list = (text) => (text.trim() === "" ? [] : text.split(","));
const fileFelts = async (file) => JSON.parse(await readFile(file, "utf8"));

export async function inputFromArgs(argv) {
  const { values: v } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: Object.fromEntries(
      [
        "network",
        "sender",
        "nonce",
        "block-hash",
        "block-number",
        "endpoint",
        "to",
        "function",
        "selector",
        "calldata",
        "calldata-file",
        "raw-calldata-file",
        "signature",
        "l2-gas",
        "out",
      ]
        .map((name) => [name, { type: "string" }])
        .concat([
          ["force", { type: "boolean" }],
          ["help", { type: "boolean" }],
        ]),
    ),
  });
  if (v.help) return { help: true };
  const raw = v["raw-calldata-file"];
  const single = ["to", "function", "selector", "calldata", "calldata-file"];
  if (raw !== undefined && single.some((name) => v[name] !== undefined))
    throw Error("--raw-calldata-file replaces the single-call options");
  if (raw === undefined && v.to === undefined)
    throw Error("Give --to with a function, or --raw-calldata-file");
  if (v.calldata !== undefined && v["calldata-file"] !== undefined)
    throw Error("Give --calldata or --calldata-file, not both");
  const call = raw === undefined && {
    to: v.to,
    function: v.function,
    selector: v.selector,
    calldata:
      v["calldata-file"] !== undefined
        ? await fileFelts(v["calldata-file"])
        : list(v.calldata ?? ""),
  };
  return {
    out: path.resolve(v.out ?? process.env.RUN_DIR ?? "artifacts/run"),
    force: Boolean(v.force),
    input: buildInput({
      network: v.network,
      sender: v.sender,
      nonce: v.nonce,
      blockHash: v["block-hash"],
      blockNumber: v["block-number"],
      endpoint: v.endpoint,
      calls: call ? [call] : undefined,
      calldata: raw === undefined ? undefined : await fileFelts(raw),
      signature: v.signature === undefined ? undefined : list(v.signature),
      l2Gas: v["l2-gas"],
    }),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const parsed = await inputFromArgs(process.argv.slice(2));
  if (parsed.help) console.log(USAGE);
  else {
    await mkdir(parsed.out, { recursive: true });
    const file = path.join(parsed.out, "browser-input.json");
    // A run directory holds one attempt; do not silently replace its request.
    await writeFile(file, JSON.stringify(parsed.input, null, 2) + "\n", {
      flag: parsed.force ? "w" : "wx",
      mode: 0o600,
    });
    const { transaction } = parsed.input.request;
    console.log(
      `Wrote ${file}: ${parsed.input.request.chain_info.chain_id}, ` +
        `${transaction.calldata.length} calldata felts, l2_gas ${BigInt(transaction.resource_bounds.l2_gas.max_amount)}`,
    );
    if (
      BigInt(transaction.resource_bounds.l2_gas.max_amount) >
      VIRTUAL_OS_EXECUTE_GAS_CAP
    )
      console.log(
        `Note: the virtual OS caps the execute phase at ${VIRTUAL_OS_EXECUTE_GAS_CAP} Sierra gas.`,
      );
  }
}
