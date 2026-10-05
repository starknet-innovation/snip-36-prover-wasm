import { pedersen, poseidonHashMany } from "@scure/starknet";
// The result is taken from the executed contract message, never from an animation.
export const PLAY_SELECTOR =
  "0x21c4a0db2b08b026c4e31bf76d5dd9b92aa54c0978df57474355786073775e8";
const felt = (value) => BigInt(value);
export function coinflipResult(receipt, contract) {
  const tx = receipt.request?.transaction,
    c = tx?.calldata;
  if (
    !Array.isArray(c) ||
    c.length !== 7 ||
    felt(c[0]) !== 1n ||
    felt(c[1]) !== felt(contract) ||
    felt(c[3]) !== 3n ||
    felt(c[2]) !== felt(PLAY_SELECTOR)
  )
    throw Error("Not a single CoinFlip play call");
  const [seed, player, choice] = c.slice(4).map(felt);
  if (choice !== 0n && choice !== 1n)
    throw Error("CoinFlip choice must be heads or tails");
  const messages = [];
  function visit(call) {
    if (!call) return;
    for (const m of call.execution?.l2_to_l1_messages ?? [])
      messages.push({ call, message: m });
    for (const child of call.inner_calls ?? []) visit(child);
  }
  visit(receipt.execution?.execution?.execute_call_info);
  const found = messages.filter(
    ({ call, message }) =>
      felt(call.call.storage_address) === felt(contract) &&
      felt(message.message.to_address) === 1n,
  );
  if (found.length !== 1) throw Error("Expected one CoinFlip result message");
  const payload = found[0].message.message.payload.map(felt);
  if (
    payload.length !== 5 ||
    payload[0] !== player ||
    payload[1] !== seed ||
    payload[2] !== choice ||
    ![0n, 1n].includes(payload[3]) ||
    payload[4] !== BigInt(payload[3] === choice)
  )
    throw Error("CoinFlip result does not match the executed request");
  if ((BigInt(pedersen(seed, player)) & 1n) !== payload[3])
    throw Error("CoinFlip outcome differs from Pedersen computation");
  const raw = receipt.output;
  const expected = poseidonHashMany([felt(contract), 1n, 5n, ...payload]);
  if (
    !Array.isArray(raw) ||
    raw.length !== 6 ||
    felt(raw[4]) !== 1n ||
    felt(raw[5]) !== expected
  )
    throw Error("CoinFlip message is not bound to the public output");
  return {
    player: "0x" + player.toString(16),
    seed: "0x" + seed.toString(16),
    choice: Number(choice),
    outcome: Number(payload[3]),
    matched: payload[4] === 1n,
  };
}
