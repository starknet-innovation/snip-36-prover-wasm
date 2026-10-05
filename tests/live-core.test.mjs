import test from "node:test";
import assert from "node:assert/strict";
import { poseidonHashMany } from "@scure/starknet";
import {
  amount,
  newRound,
  validateRound,
  depositCalls,
  virtualRequest,
  proofMaterial,
  proofApiVersion,
  outcome,
  hex,
  PROGRAM,
  CONFIG,
} from "../web/live-core.mjs";
const config = { bank: "0x9", coinflip: "0x8", executor: "0x7" };
const round = () => newRound("0x6", config.bank, 0, "0.001");
test("stakes use exact decimal units with a bounded testnet ceiling", () => {
  assert.equal(amount("0.001"), "1000000000000000");
  for (const v of [
    "0",
    "-1",
    "1e-3",
    "0.010000000000000001",
    "0.0000000000000000001",
    "Infinity",
  ])
    assert.throws(() => amount(v));
});
test("recovery binds wallet, choice, nonce and session", () => {
  const r = round();
  assert.equal(validateRound(r, r.player, r.bank).id, r.id);
  for (const field of ["nonce", "id", "commitment", "player", "bank"])
    assert.throws(() =>
      validateRound({ ...r, [field]: "0x42" }, r.player, r.bank),
    );
  assert.throws(() => validateRound({ ...r, choice: 1 }, r.player, r.bank));
});
test("deposit and matching are atomic with exact approval", () => {
  const r = round(),
    calls = depositCalls(r);
  assert.deepEqual(
    calls.map((c) => c.entry_point),
    ["approve", "deposit", "match_deposit"],
  );
  assert.equal(calls[0].calldata[1], hex(r.amount));
  assert.equal(calls[2].calldata[0], r.id);
});
test("public executor request uses public placeholder values and no fee authorization", () => {
  const tx = virtualRequest(
    config,
    { seed: "0xa", player: "0x6", choice: 1 },
    0,
  ).transaction;
  assert.equal(tx.sender_address, config.executor);
  assert.deepEqual(tx.signature, ["0x0", "0x0"]);
  assert.equal(tx.calldata[1], config.coinflip);
  for (const bound of Object.values(tx.resource_bounds))
    assert.equal(bound.max_price_per_unit, "0x0");
});
test("proof attachment must bind the exact round and message", () => {
  const r = round(),
    g = { ...r, state: 3, seed: "0xa" },
    o = outcome(g);
  const msg = hex(
    poseidonHashMany([
      8n,
      1n,
      5n,
      BigInt(r.player),
      10n,
      0n,
      BigInt(o),
      BigInt(o === 0),
    ]),
  );
  const receipt = {
    ok: true,
    kind: "proof",
    proof: Array(1100).fill(0),
    anchor: { header: { block_number: 100, block_hash: "0x12" } },
    output_preimage: [
      "0x1",
      "0x8",
      PROGRAM,
      "0x5649525455414c5f534e4f5330",
      "0x64",
      "0x12",
      CONFIG,
      "0x1",
      msg,
    ],
  };
  assert.equal(proofMaterial(receipt, config, r, g).proof_facts.length, 9);
  for (const field of ["seed", "player"])
    assert.throws(() =>
      proofMaterial(receipt, config, r, { ...g, [field]: "0x55" }),
    );
  assert.throws(() =>
    proofMaterial(receipt, { ...config, coinflip: "0x99" }, r, g),
  );
  assert.throws(() =>
    proofMaterial({ ...receipt, proof: [256] }, config, r, g),
  );
});
test("proof API gate rejects unsupported and malformed versions", () => {
  assert.equal(proofApiVersion(["0.9.0", "0.10.2"]), null);
  assert.equal(proofApiVersion(["0.10.3", "0.10.4"]), "0.10.4");
  assert.equal(proofApiVersion(["0.10.3-rc.0", "0.10.4-rc.1", "junk"]), null);
  assert.equal(proofApiVersion(["0.10.4-rc.0"]), "0.10.4-rc.0");
  assert.equal(proofApiVersion(["0.10.4-rc.0", "0.10.4"]), "0.10.4");
  assert.equal(proofApiVersion(["0.10.3", "0.10.4-rc.0"]), "0.10.4-rc.0");
});
