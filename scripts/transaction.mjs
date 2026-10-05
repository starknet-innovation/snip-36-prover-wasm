import {
  poseidonHashMany,
  sign,
  getPublicKey,
  getStarkKey,
  verify,
  keccak,
} from "@scure/starknet";
export const CHAIN_ID = BigInt("0x534e5f5345504f4c4941");
export const STRK =
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const PROGRAM =
  "0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1";
export const hex = (n) => "0x" + BigInt(n).toString(16);
const ascii = (s) => BigInt("0x" + Buffer.from(s).toString("hex"));
export const selector = (name) => hex(keccak(new TextEncoder().encode(name)));
// Project only the gateway wire fields; never forward arbitrary file properties.
export function gatewayTransaction(tx) {
  const felt = (value) => {
    if (
      typeof value !== "string" ||
      !/^0x[0-9a-f]{1,64}$/i.test(value) ||
      BigInt(value) >= (1n << 251n) + 17n * (1n << 192n) + 1n
    )
      throw Error("Invalid transaction felt");
    return hex(value);
  };
  if (
    tx.type !== "INVOKE" ||
    tx.version !== "0x3" ||
    tx.nonce_data_availability_mode !== "L1" ||
    tx.fee_data_availability_mode !== "L1" ||
    !Array.isArray(tx.signature) ||
    tx.signature.length !== 2 ||
    !Array.isArray(tx.calldata) ||
    tx.calldata.length !== 5 ||
    !Array.isArray(tx.proof_facts) ||
    tx.proof_facts.length < 3 ||
    tx.proof_facts.length > 1024 ||
    !Array.isArray(tx.paymaster_data) ||
    tx.paymaster_data.length ||
    !Array.isArray(tx.account_deployment_data) ||
    tx.account_deployment_data.length ||
    typeof tx.proof !== "string" ||
    tx.proof.length > 64 * 1024 * 1024 ||
    Buffer.from(tx.proof, "base64").toString("base64") !== tx.proof ||
    tx.proof.length === 0
  )
    throw Error("Invalid proof-bearing gateway transaction");
  // Also enforce the resource bounds' uint64/uint128 wire ranges.
  transactionHash(tx);
  return {
    type: "INVOKE_FUNCTION",
    version: "0x3",
    sender_address: felt(tx.sender_address),
    nonce: felt(tx.nonce),
    tip: felt(tx.tip),
    signature: tx.signature.map(felt),
    calldata: tx.calldata.map(felt),
    proof_facts: tx.proof_facts.map(felt),
    paymaster_data: [],
    account_deployment_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode: "L1",
    resource_bounds: Object.fromEntries(
      ["l1_gas", "l2_gas", "l1_data_gas"].map((key) => [
        key.toUpperCase(),
        {
          max_amount: felt(tx.resource_bounds[key].max_amount),
          max_price_per_unit: felt(tx.resource_bounds[key].max_price_per_unit),
        },
      ]),
    ),
    proof: tx.proof,
  };
}
export function transactionHash(tx) {
  const resources = [
    ["L1_GAS", "l1_gas"],
    ["L2_GAS", "l2_gas"],
    ["L1_DATA", "l1_data_gas"],
  ].map(([name, key]) => {
    const amount = BigInt(tx.resource_bounds[key].max_amount),
      price = BigInt(tx.resource_bounds[key].max_price_per_unit);
    if (amount < 0n || amount >= 1n << 64n || price < 0n || price >= 1n << 128n)
      throw Error("Resource bound outside wire range");
    return (ascii(name) << 192n) | (amount << 128n) | price;
  });
  if (
    tx.nonce_data_availability_mode !== "L1" ||
    tx.fee_data_availability_mode !== "L1"
  )
    throw Error("Only L1 availability mode supported");
  const hash = (values) => poseidonHashMany(values.map(BigInt));
  const values = [
    ascii("invoke"),
    3n,
    BigInt(tx.sender_address),
    hash([tx.tip, ...resources]),
    hash(tx.paymaster_data),
    CHAIN_ID,
    BigInt(tx.nonce),
    0n,
    hash(tx.account_deployment_data),
    hash(tx.calldata),
  ];
  if (tx.proof_facts?.length) values.push(hash(tx.proof_facts));
  return hex(hash(values));
}
export function signTransaction(tx, key) {
  if (!/^0x[0-9a-f]{1,64}$/i.test(key ?? ""))
    throw Error("Missing or malformed local signing credential");
  try {
    const hash = transactionHash(tx),
      sig = sign(hash, key);
    if (!verify(sig, hash, getPublicKey(key))) throw Error();
    return {
      transaction: { ...tx, signature: [hex(sig.r), hex(sig.s)] },
      hash,
      publicKey: getStarkKey(key),
    };
  } catch {
    throw Error("Local signing or signature self-check failed");
  }
}
export function bounds(prices) {
  const amounts = { l1_gas: 65536n, l2_gas: 117440512n, l1_data_gas: 432n };
  return Object.fromEntries(
    Object.entries(amounts).map(([n, a]) => [
      n,
      { max_amount: hex(a), max_price_per_unit: hex(BigInt(prices[n]) * 2n) },
    ]),
  );
}
export function feeCeiling(resourceBounds) {
  return Object.values(resourceBounds).reduce(
    (v, b) => v + BigInt(b.max_amount) * BigInt(b.max_price_per_unit),
    0n,
  );
}
export function unsignedBalanceRequest(address, nonce) {
  return {
    captured_chain_id: hex(CHAIN_ID),
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
      sender_address: hex(address),
      calldata: ["0x1", STRK, selector("balance_of"), "0x1", hex(address)],
      signature: [],
      nonce: hex(nonce),
      resource_bounds: bounds({ l1_gas: 0, l2_gas: 0, l1_data_gas: 0 }),
      tip: "0x0",
      paymaster_data: [],
      account_deployment_data: [],
      nonce_data_availability_mode: "L1",
      fee_data_availability_mode: "L1",
    },
  };
}
export function proofFacts(output) {
  if (
    output.length < 3 ||
    BigInt(output[0]) !== 1n ||
    BigInt(output[1]) !== BigInt(output.length - 1) ||
    BigInt(output[2]) !== BigInt(PROGRAM)
  )
    throw Error("Unexpected bootloader statement/program");
  return [
    hex(ascii("PROOF1")),
    hex(ascii("VIRTUAL_SNOS")),
    ...output.slice(2).map(hex),
  ];
}
