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
