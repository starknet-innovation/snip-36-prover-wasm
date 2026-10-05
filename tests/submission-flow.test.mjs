import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { signTransaction, feeCeiling } from "../scripts/transaction.mjs";
const execute = promisify(execFile);
const vector = JSON.parse(
  await readFile(new URL("../fixtures/hash-vector.json", import.meta.url)),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "snip36-submit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signed = signTransaction(vector.request.transaction, "0x1");
  const payload = {
    ...signed.transaction,
    type: "INVOKE",
    version: "0x3",
    proof: "AQID",
  };
  const { proof, proof_facts, ...rpcTransaction } = payload;
  const save = (name, data) =>
    writeFile(path.join(dir, name), JSON.stringify(data));
  await save("signed-payload.json", payload);
  await save("mock-transaction.json", rpcTransaction);
  await save("submission-plan.json", {
    transaction_hash: signed.hash,
    account: payload.sender_address,
    nonce: payload.nonce,
    proof_sha256: sha(Buffer.from(proof, "base64")),
    fee_ceiling_fri: feeCeiling(payload.resource_bounds).toString(),
    balance_before_fri: "100",
  });
  return {
    dir,
    payload,
    save,
    read: async (name) =>
      JSON.parse(await readFile(path.join(dir, name), "utf8")),
    calls: async () =>
      (await readFile(path.join(dir, "network-calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse),
    run: async (scenario = "success") => {
      try {
        const result = await execute(
          process.execPath,
          [
            "--import",
            fileURLToPath(
              new URL("./helpers/submission-network.mjs", import.meta.url),
            ),
            fileURLToPath(new URL("../scripts/e2e.mjs", import.meta.url)),
            "submit",
          ],
          {
            env: { RUN_DIR: dir, SUBMISSION_TEST_SCENARIO: scenario },
            timeout: 15000,
          },
        );
        return { ...result, code: 0 };
      } catch (error) {
        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
      }
    },
  };
}
const broadcasts = (calls) =>
  calls.filter(({ url }) => url.endsWith("/gateway/add_transaction"));
for (const invalid of ["signature", "base64"]) {
  test(`invalid ${invalid} leaves no intent and allows a corrected retry`, async (t) => {
    const f = await fixture(t);
    const malformed = structuredClone(f.payload);
    if (invalid === "signature") malformed.signature.pop();
    else malformed.proof += "\n"; // Same decoded proof bytes, invalid wire encoding.
    await f.save("signed-payload.json", malformed);
    const rejected = await f.run();
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /Invalid proof-bearing gateway transaction/);
    await assert.rejects(access(path.join(f.dir, "submission-intent.json")), {
      code: "ENOENT",
    });
    assert.equal(broadcasts(await f.calls()).length, 0);
    await f.save("signed-payload.json", f.payload);
    const repaired = await f.run();
    assert.equal(repaired.code, 0, repaired.stderr);
    assert.equal(broadcasts(await f.calls()).length, 1);
  });
}
test("omitted file properties do not fail verification of a successfully included transaction", async (t) => {
  const f = await fixture(t);
  f.payload.extra = "not a wire field";
  f.payload.resource_bounds.l2_gas.extra = "not a resource field";
  await f.save("signed-payload.json", f.payload);
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  const sent = broadcasts(await f.calls());
  assert.equal(sent.length, 1);
  assert.equal(Object.hasOwn(sent[0].body, "extra"), false);
  assert.equal(
    Object.hasOwn(sent[0].body.resource_bounds.L2_GAS, "extra"),
    false,
  );
  assert.equal(
    (await f.read("onchain-verification.json")).returned_signed_fields_match,
    true,
  );
});
test("changes to an actual transmitted resource field still fail receipt verification", async (t) => {
  const f = await fixture(t);
  const result = await f.run("changed-bound");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Included signed field differs: resource_bounds/);
  assert.equal(broadcasts(await f.calls()).length, 1);
});
test("an unknown transport outcome retains intent and prevents a second broadcast", async (t) => {
  const f = await fixture(t);
  const first = await f.run("transport-error");
  assert.equal(first.code, 1);
  assert.match(first.stderr, /Simulated unknown transport outcome/);
  await access(path.join(f.dir, "submission-intent.json"));
  assert.match(
    (await f.read("submission-error.json")).action,
    /do not automatically rebroadcast/,
  );
  const retry = await f.run();
  assert.equal(retry.code, 1);
  assert.match(retry.stderr, /EEXIST/);
  assert.equal(broadcasts(await f.calls()).length, 1);
});
