import { pedersen, poseidonHashMany, keccak } from "@scure/starknet";
export const CHAIN = "0x534e5f5345504f4c4941";
export const STRK =
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const PROGRAM =
  "0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1";
export const CONFIG =
  "0x57ed4d5e20d617d8cc087a5882eae4f71d005172326be6439b2e1fd8b4dc57";
export const RPC = "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
export const hex = (n) => "0x" + BigInt(n).toString(16);
export const selector = (name) => hex(keccak(new TextEncoder().encode(name)));
export function felt(v) {
  if (typeof v !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(v))
    throw Error("Invalid felt");
  if (BigInt(v) >= (1n << 251n) + 17n * (1n << 192n) + 1n)
    throw Error("Felt outside field");
  return hex(v);
}
export function amount(text) {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(text))
    throw Error("Enter a decimal test-STRK amount");
  const [a, b = ""] = text.split(".");
  const n = BigInt(a) * 10n ** 18n + BigInt(b.padEnd(18, "0"));
  if (n <= 0n || n > 10000000000000000n)
    throw Error("Stake must be positive and at most 0.01 test STRK");
  return n.toString();
}
export function units(n) {
  const v = BigInt(n),
    a = v / 10n ** 18n,
    b = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return a.toString() + (b ? "." + b : "");
}
export function newRound(
  player,
  bank,
  choice,
  stake,
  random = globalThis.crypto,
) {
  if (![0, 1].includes(choice)) throw Error("Invalid choice");
  player = felt(player);
  bank = felt(bank);
  const bytes = random.getRandomValues(new Uint8Array(31));
  const nonce =
    "0x" + [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  const commitment = hex(pedersen(hex(choice), nonce));
  return {
    id: hex(poseidonHashMany([BigInt(player), BigInt(commitment)])),
    player,
    bank,
    choice,
    nonce,
    commitment,
    amount: amount(stake),
    created_at: new Date().toISOString(),
    transactions: {},
  };
}
export function validateRound(r, player, bank) {
  if (
    r.player !== hex(player) ||
    r.bank !== hex(bank) ||
    ![0, 1].includes(r.choice) ||
    BigInt(r.amount) <= 0n ||
    BigInt(r.amount) > 10000000000000000n
  )
    throw Error("Round belongs to a different wallet, bank, or invalid stake");
  const commitment = hex(pedersen(hex(r.choice), felt(r.nonce)));
  if (
    commitment !== felt(r.commitment) ||
    hex(poseidonHashMany([BigInt(r.player), BigInt(commitment)])) !== felt(r.id)
  )
    throw Error("Recovery commitment mismatch");
  const transactions = {};
  for (const name of ["deposit", "reveal", "settle", "refund", "expire"]) {
    if (r.transactions?.[name]?.hash)
      transactions[name] = { hash: felt(r.transactions[name].hash) };
  }
  if (
    r.pendingWallet &&
    !["deposit", "reveal", "settle", "refund", "expire"].includes(
      r.pendingWallet,
    )
  )
    throw Error("Invalid pending wallet action");
  return {
    id: felt(r.id),
    player: felt(r.player),
    bank: felt(r.bank),
    choice: r.choice,
    nonce: felt(r.nonce),
    commitment,
    amount: BigInt(r.amount).toString(),
    transactions,
    pendingWallet: r.pendingWallet || null,
    created_at:
      typeof r.created_at === "string"
        ? r.created_at
        : new Date().toISOString(),
  };
}
export function game(values) {
  if (!Array.isArray(values) || values.length !== 9)
    throw Error("Unexpected bank state");
  return {
    player: hex(values[0]),
    amount: (BigInt(values[1]) + (BigInt(values[2]) << 128n)).toString(),
    commitment: hex(values[3]),
    seed_block: Number(BigInt(values[4])),
    seed: hex(values[5]),
    choice: Number(BigInt(values[6])),
    state: Number(BigInt(values[7])),
    deadline: Number(BigInt(values[8])),
  };
}
export function matchGame(r, g) {
  if (g.state === 0) return;
  if (
    g.player !== r.player ||
    g.amount !== r.amount ||
    g.commitment !== r.commitment ||
    (g.state >= 3 && g.state <= 4 && g.choice !== r.choice)
  )
    throw Error("On-chain game differs from saved round");
}
const call = (address, name, args) => ({
  contract_address: address,
  entry_point: name,
  calldata: args,
});
export function depositCalls(r) {
  return [
    call(STRK, "approve", [r.bank, hex(r.amount), "0x0"]),
    call(r.bank, "deposit", [r.id, r.commitment, hex(r.amount), "0x0"]),
    call(r.bank, "match_deposit", [r.id]),
  ];
}
export function revealCalls(r) {
  return [call(r.bank, "reveal", [r.id, hex(r.choice), r.nonce])];
}
export function outcome(g) {
  return Number(BigInt(pedersen(g.seed, g.player)) & 1n);
}
export function settleCalls(r, g) {
  return [call(r.bank, "settle", [r.id, hex(outcome(g))])];
}
export function virtualRequest(config, g, nonce) {
  return {
    captured_chain_id: CHAIN,
    chain_info: {
      chain_id: "SN_SEPOLIA",
      fee_token_addresses: {
        eth_fee_token_address:
          "0x216e06f4761eb833ec9fbc9d08ae554427a2e6f23539d669a26d7e9997222b3",
        strk_fee_token_address: STRK,
      },
      is_l3: false,
    },
    transaction: {
      sender_address: config.executor,
      calldata: [
        "0x1",
        config.coinflip,
        selector("play"),
        "0x3",
        g.seed,
        g.player,
        hex(g.choice),
      ],
      // Public executor ignores signature values; the existing transport requires a nonempty array.
      signature: ["0x0", "0x0"],
      nonce: hex(nonce),
      resource_bounds: {
        l1_gas: { max_amount: "0x5f5e100", max_price_per_unit: "0x0" },
        l2_gas: { max_amount: "0x5f5e100", max_price_per_unit: "0x0" },
        l1_data_gas: { max_amount: "0x186a0", max_price_per_unit: "0x0" },
      },
      tip: "0x0",
      paymaster_data: [],
      account_deployment_data: [],
      nonce_data_availability_mode: "L1",
      fee_data_availability_mode: "L1",
    },
  };
}
export function proofMaterial(receipt, config, r, g) {
  matchGame(r, g);
  if (g.state !== 3) throw Error("Game is not awaiting settlement");
  const result = outcome(g),
    output = [
      g.player,
      g.seed,
      hex(g.choice),
      hex(result),
      hex(Number(result === g.choice)),
    ];
  const message = hex(
    poseidonHashMany([BigInt(config.coinflip), 1n, 5n, ...output.map(BigInt)]),
  );
  const expected = [
    "0x1",
    "0x8",
    PROGRAM,
    "0x5649525455414c5f534e4f5330",
    hex(receipt.anchor.header.block_number),
    receipt.anchor.header.block_hash,
    CONFIG,
    "0x1",
    message,
  ];
  if (
    !receipt.ok ||
    receipt.kind !== "proof" ||
    !Array.isArray(receipt.proof) ||
    receipt.proof.length < 1000 ||
    receipt.proof.length > 1000000 ||
    !receipt.proof.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ||
    !Array.isArray(receipt.output_preimage) ||
    receipt.output_preimage.length !== expected.length ||
    !receipt.output_preimage.every((v, i) => felt(v) === felt(expected[i]))
  )
    throw Error("Proof is not bound to this round");
  const tags = ["0x50524f4f4631", "0x5649525455414c5f534e4f53"];
  let binary = "";
  for (let i = 0; i < receipt.proof.length; i += 8192)
    binary += String.fromCharCode(...receipt.proof.slice(i, i + 8192));
  return {
    data: btoa(binary),
    output,
    proof_facts: [...tags, ...expected.slice(2)],
  };
}
export function proofApiVersion(versions) {
  if (!Array.isArray(versions)) return null;
  return (
    versions
      .filter((v) => /^0\.10\.(?:[3-9]|[1-9]\d+)$/.test(v))
      .sort((a, b) => Number(b.split(".")[2]) - Number(a.split(".")[2]))[0] ??
    null
  );
}
export async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error("Sepolia RPC HTTP " + response.status);
  const j = await response.json();
  if (j.error) {
    const e = Error(j.error.message);
    e.code = j.error.code;
    e.data = j.error.data;
    throw e;
  }
  return j.result;
}
export async function readGame(config, id) {
  return game(
    await rpc("starknet_call", {
      block_id: "latest",
      request: {
        contract_address: config.bank,
        entry_point_selector: selector("get_game"),
        calldata: [id],
      },
    }),
  );
}
