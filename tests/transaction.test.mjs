import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  transactionHash,
  signTransaction,
  unsignedBalanceRequest,
  feeCeiling,
  bounds,
  proofFacts,
  gatewayTransaction,
} from "../scripts/transaction.mjs";
const vector = JSON.parse(
  await readFile(new URL("../fixtures/hash-vector.json", import.meta.url)),
);
test("SNIP-36 hash matches independently checked pinned native and accepted Sepolia transaction", () => {
  assert.equal(
    transactionHash(vector.request.transaction),
    vector.transaction_hash,
  );
});
test("proof facts are bound into the hash", () => {
  const tx = structuredClone(vector.request.transaction);
  tx.proof_facts = [];
  assert.notEqual(transactionHash(tx), vector.transaction_hash);
});
test("public scalar control signs without leaking key into returned request", () => {
  const r = signTransaction(
    unsignedBalanceRequest("0x123", "0x0").transaction,
    "0x1",
  );
  assert.equal(r.transaction.signature.length, 2);
  assert.equal(
    r.publicKey,
    "0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca",
  );
  assert.equal(r.hash, transactionHash(r.transaction));
});
test("resource bounds are checked without numeric precision loss", () => {
  assert.equal(
    feeCeiling(bounds({ l1_gas: 2n, l2_gas: 3n, l1_data_gas: 5n })),
    65536n * 4n + 117440512n * 6n + 432n * 10n,
  );
  const tx = structuredClone(vector.request.transaction);
  tx.resource_bounds.l2_gas.max_amount = "0x10000000000000000";
  assert.throws(() => transactionHash(tx), /wire range/);
});
test("wrong public program cannot become proof facts", () => {
  assert.throws(() => proofFacts(["0x1", "0x2", "0x1"]), /program/);
});

test("gateway projection preserves signed fields and omits unrelated file properties", () => {
  const tx = {
    ...signTransaction(vector.request.transaction, "0x1").transaction,
    type: "INVOKE",
    version: "0x3",
    proof: "AQID",
    unrelated_file_data: "must not be transmitted",
  };
  tx.resource_bounds.l2_gas.extra = "must not be transmitted";
  const projected = gatewayTransaction(tx);
  assert.equal(projected.type, "INVOKE_FUNCTION");
  assert.equal(projected.proof, "AQID");
  assert.ok(!("unrelated_file_data" in projected));
  assert.ok(!("extra" in projected.resource_bounds.L2_GAS));
  const roundTrip = {
    ...projected,
    resource_bounds: Object.fromEntries(
      Object.entries(projected.resource_bounds).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    ),
  };
  assert.equal(transactionHash(roundTrip), vector.transaction_hash);
  for (const changes of [
    { version: "0x1" },
    { proof: "AQID\n" },
    { signature: [] },
    { proof_facts: [] },
    { paymaster_data: ["0x1"] },
    { sender_address: "0x" + "f".repeat(64) },
  ])
    assert.throws(() => gatewayTransaction({ ...tx, ...changes }), /Invalid/);
});
