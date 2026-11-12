import test from "node:test";
import assert from "node:assert/strict";
import { checkStockProof, sha256 } from "../scripts/offline-fixtures.mjs";

test("stock equivalence requires the same fixture, proof length and every proof byte", () => {
  const proof = Buffer.from("valid proof");
  const entry = { name: "balance", pie_sha256: "fixture", proof_bytes: proof.length, proof_sha256: sha256(proof) };
  const stock = { workloads: [entry] };
  checkStockProof(stock, "balance", "fixture", proof);
  for (const [record, name, pie, bytes] of [
    [stock, "missing", "fixture", proof], [stock, "balance", "other", proof],
    [stock, "balance", "fixture", Buffer.from("Valid proof")],
    [stock, "balance", "fixture", Buffer.concat([proof, Buffer.from([0])])],
    [{ workloads: [entry, entry] }, "balance", "fixture", proof],
  ]) assert.throws(() => checkStockProof(record, name, pie, bytes), /differs from stock V2/);
});
