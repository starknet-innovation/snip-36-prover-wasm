import test from "node:test";
import assert from "node:assert/strict";
import { pedersen, poseidonHashMany } from "@scure/starknet";
import { coinflipResult, PLAY_SELECTOR } from "../web/coinflip.mjs";
const hex = (n) => "0x" + BigInt(n).toString(16);
const contract = "0x123",
  seed = "0x42",
  player = "0xabc";
function receipt(choice) {
  const outcome = BigInt(pedersen(seed, player)) & 1n;
  const payload = [
    player,
    seed,
    hex(choice),
    hex(outcome),
    hex(outcome === BigInt(choice) ? 1 : 0),
  ];
  return {
    request: {
      transaction: {
        calldata: [
          "0x1",
          contract,
          PLAY_SELECTOR,
          "0x3",
          seed,
          player,
          hex(choice),
        ],
      },
    },
    execution: {
      execution: {
        execute_call_info: {
          call: { storage_address: contract },
          execution: {
            l2_to_l1_messages: [{ message: { to_address: "0x1", payload } }],
          },
        },
      },
    },
    output: [
      "0x0",
      "0x0",
      "0x0",
      "0x0",
      "0x1",
      hex(poseidonHashMany([BigInt(contract), 1n, 5n, ...payload.map(BigInt)])),
    ],
  };
}
test("both choices derive the same deterministic outcome with opposite matches", () => {
  const heads = coinflipResult(receipt(0), contract),
    tails = coinflipResult(receipt(1), contract);
  assert.equal(heads.outcome, tails.outcome);
  assert.notEqual(heads.matched, tails.matched);
});
test("wrong call, message, outcome, and public output cannot be shown as a coinflip result", () => {
  for (const mutate of [
    (r) => (r.request.transaction.calldata[2] = "0x1"),
    (r) => (r.request.transaction.calldata[6] = "0x2"),
    (r) =>
      (r.execution.execution.execute_call_info.execution.l2_to_l1_messages[0].message.payload[0] =
        "0x1"),
    (r) => (r.output[5] = "0x1"),
    (r) =>
      r.execution.execution.execute_call_info.execution.l2_to_l1_messages.push(
        r.execution.execution.execute_call_info.execution.l2_to_l1_messages[0],
      ),
  ]) {
    const r = receipt(0);
    mutate(r);
    assert.throws(() => coinflipResult(r, contract));
  }
});
for (const side of ["heads", "tails"])
  test(`real ${side} capture binds the game result to verified public state`, async () => {
    const { readFile } = await import("node:fs/promises");
    const { validateCaptureForExecution } =
      await import("../scripts/verify-capture-inputs.mjs");
    const r = JSON.parse(
      await readFile(
        new URL(`../fixtures/coinflip/${side}.json`, import.meta.url),
      ),
    );
    await validateCaptureForExecution(r);
    const game = coinflipResult(r, r.coinflip.contract_address);
    assert.equal(game.choice, side === "heads" ? 0 : 1);
    assert.equal(game.outcome, r.coinflip.outcome);
    assert.equal(BigInt(game.seed), BigInt(r.anchor.header.block_number));
  });
