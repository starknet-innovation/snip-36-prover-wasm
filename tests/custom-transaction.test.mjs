import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  NETWORKS,
  DEFAULT_L2_GAS,
  buildInput,
  callArray,
  inputFromArgs,
  toFelt,
} from "../scripts/custom-input.mjs";
import {
  parseRunArgs,
  checkInput,
  unzipEntry,
  summarizeResources,
  DERIVED_OUTPUTS,
  clearDerivedOutputs,
} from "../scripts/custom-run.mjs";
import { PROOF_TIMEOUT_MS } from "../scripts/proof-timeouts.mjs";
import { transactionHash, selector } from "../scripts/transaction.mjs";
import { RPC_NETWORKS, liveTransport } from "../web/anchored-rpc.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/captured-execution.json", import.meta.url),
  ),
);
const base = {
  sender: fixture.request.transaction.sender_address,
  nonce: fixture.request.transaction.nonce,
  blockHash: fixture.anchor.header.block_hash,
};
const balanceOf = {
  to: fixture.request.transaction.calldata[1],
  function: "balance_of",
  calldata: [base.sender],
};
// Recursively compares field names, the part serde's deny_unknown_fields checks.
const shape = (v) =>
  Array.isArray(v)
    ? "array"
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, shape(v[k])]),
        )
      : typeof v;
const temp = async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "snip-custom-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const run = (script, args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: "utf8",
  });

test("custom request has the field layout of an accepted recorded request", () => {
  const { request, source } = buildInput({ ...base, calls: [balanceOf] });
  assert.deepEqual(shape(request), shape(fixture.request));
  assert.deepEqual(
    request.transaction.calldata.map(BigInt),
    fixture.request.transaction.calldata.map(BigInt),
  );
  assert.equal(request.captured_chain_id, fixture.request.captured_chain_id);
  assert.deepEqual(request.chain_info, {
    ...fixture.request.chain_info,
    fee_token_addresses: Object.fromEntries(
      Object.entries(fixture.request.chain_info.fee_token_addresses).map(
        ([k, v]) => [k, toFelt(v)],
      ),
    ),
  });
  // What the executor requires on input: a signature, zero prices and tip, l2 gas.
  assert.deepEqual(request.transaction.signature, ["0x0"]);
  assert.equal(request.transaction.tip, "0x0");
  for (const bound of Object.values(request.transaction.resource_bounds))
    assert.equal(bound.max_price_per_unit, "0x0");
  assert.equal(
    BigInt(request.transaction.resource_bounds.l2_gas.max_amount),
    DEFAULT_L2_GAS,
  );
  assert.equal(DEFAULT_L2_GAS, 117440512n);
  assert.ok(!("proof" in request.transaction));
  assert.match(transactionHash(request.transaction), /^0x[0-9a-f]+$/);
  assert.deepEqual(source, {
    endpoint: RPC_NETWORKS.sepolia.endpoints[0],
    block_id: { block_hash: toFelt(base.blockHash) },
  });
});

test("selectors are computed from names and Array<Call> is laid out per call", () => {
  assert.equal(
    selector("transfer"),
    "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e",
  );
  assert.deepEqual(
    callArray([
      { to: "0xa", function: "transfer", calldata: ["0x1", 2, "3"] },
      { to: "11", selector: "0xC", calldata: [] },
    ]),
    [
      "0x2",
      "0xa",
      selector("transfer"),
      "0x3",
      "0x1",
      "0x2",
      "0x3",
      "0xb",
      "0xc",
      "0x0",
    ],
  );
  assert.throws(() => callArray([]), /At least one call/);
  assert.throws(() => callArray([{ to: "0x1" }]), /selector or a function/);
  assert.throws(
    () => callArray([{ to: "0x1", selector: "0x2", function: "f" }]),
    /selector or a function/,
  );
  assert.throws(
    () => callArray([{ to: "0x" + "f".repeat(64), function: "f" }]),
    /Stark field/,
  );
  assert.throws(() => toFelt("-1"), /Not a felt/);
  assert.throws(() => toFelt("0xzz"), /Not a felt/);
});

test("raw calldata is passed through unchanged apart from felt normalisation", () => {
  const raw = ["0x02", "7", "0x0"];
  const { request } = buildInput({
    ...base,
    calldata: raw,
    blockHash: undefined,
    blockNumber: "42",
  });
  assert.deepEqual(request.transaction.calldata, ["0x2", "0x7", "0x0"]);
  assert.throws(
    () => buildInput({ ...base, calldata: raw, calls: [balanceOf] }),
    /either calls or raw calldata/,
  );
  assert.throws(() => buildInput({ ...base }), /either calls or raw calldata/);
});

test("network switch selects chain, fee tokens and allow-listed endpoints", () => {
  for (const [name, net] of Object.entries(NETWORKS)) {
    const { request, source } = buildInput({
      ...base,
      network: name,
      calls: [balanceOf],
    });
    assert.equal(request.chain_info.chain_id, net.chain_id);
    // The executor compares the short-string chain ID with captured_chain_id.
    assert.equal(
      request.captured_chain_id,
      "0x" + Buffer.from(net.chain_id).toString("hex"),
    );
    assert.equal(request.captured_chain_id, RPC_NETWORKS[name].chainId);
    assert.equal(
      request.chain_info.fee_token_addresses.strk_fee_token_address,
      "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    );
    assert.equal(request.chain_info.is_l3, false);
    assert.equal(source.endpoint, RPC_NETWORKS[name].endpoints[0]);
    // Every default and fallback endpoint is one the browser transport accepts.
    for (const endpoint of RPC_NETWORKS[name].endpoints) {
      assert.equal(
        buildInput({ ...base, network: name, endpoint, calls: [balanceOf] })
          .source.endpoint,
        endpoint,
      );
      assert.equal(typeof liveTransport(endpoint), "function");
    }
  }
  assert.notDeepEqual(
    buildInput({ ...base, network: "mainnet", calls: [balanceOf] }).request
      .chain_info,
    buildInput({ ...base, calls: [balanceOf] }).request.chain_info,
  );
  assert.throws(
    () =>
      buildInput({
        ...base,
        network: "mainnet",
        endpoint: RPC_NETWORKS.sepolia.endpoints[0],
        calls: [balanceOf],
      }),
    /only accepts these mainnet endpoints/,
  );
  assert.throws(
    () =>
      buildInput({
        ...base,
        endpoint: "https://example.invalid/rpc",
        calls: [balanceOf],
      }),
    /only accepts/,
  );
  assert.throws(
    () => buildInput({ ...base, network: "devnet", calls: [balanceOf] }),
    /sepolia or mainnet/,
  );
});

test("block, signature and gas inputs are validated", () => {
  const ok = { ...base, calls: [balanceOf] };
  assert.deepEqual(
    buildInput({ ...ok, blockHash: undefined, blockNumber: 7 }).source.block_id,
    { block_number: 7 },
  );
  assert.throws(() => buildInput({ ...ok, blockNumber: 7 }), /exactly one/);
  assert.throws(
    () => buildInput({ ...ok, blockHash: undefined }),
    /exactly one/,
  );
  assert.throws(
    () => buildInput({ ...ok, blockHash: undefined, blockNumber: "latest" }),
    /non-negative integer/,
  );
  assert.throws(
    () => buildInput({ ...ok, signature: [] }),
    /placeholder signature/,
  );
  assert.deepEqual(
    buildInput({ ...ok, signature: ["1", "0x2"] }).request.transaction
      .signature,
    ["0x1", "0x2"],
  );
  assert.equal(
    buildInput({ ...ok, l2Gas: "1110000000" }).request.transaction
      .resource_bounds.l2_gas.max_amount,
    "0x42294180",
  );
  for (const l2Gas of [0, "0x10000000000000000", "many"])
    assert.throws(() => buildInput({ ...ok, l2Gas }), /l2 gas/);
  assert.throws(
    () => buildInput({ ...ok, sender: undefined }),
    /sender and nonce/,
  );
});

test("input CLI writes one request per run directory and rejects unknown flags", async (t) => {
  const dir = await temp(t);
  const out = path.join(dir, "run");
  const calldataFile = path.join(dir, "raw.json");
  await writeFile(
    calldataFile,
    JSON.stringify(fixture.request.transaction.calldata),
  );
  const args = [
    "--sender",
    base.sender,
    "--nonce",
    base.nonce,
    "--block-hash",
    base.blockHash,
    "--out",
    out,
  ];
  const single = [
    ...args,
    "--to",
    balanceOf.to,
    "--function",
    "balance_of",
    "--calldata",
    base.sender,
  ];
  const first = run("scripts/custom-input.mjs", single);
  assert.equal(first.status, 0, first.stderr);
  const written = JSON.parse(
    await readFile(path.join(out, "browser-input.json")),
  );
  assert.deepEqual(written, buildInput({ ...base, calls: [balanceOf] }));
  assert.deepEqual(checkInput(written), written);
  assert.match(run("scripts/custom-input.mjs", single).stderr, /EEXIST/);
  const raw = run("scripts/custom-input.mjs", [
    ...args,
    "--raw-calldata-file",
    calldataFile,
    "--network",
    "mainnet",
    "--force",
  ]);
  assert.equal(raw.status, 0, raw.stderr);
  const replaced = JSON.parse(
    await readFile(path.join(out, "browser-input.json")),
  );
  assert.equal(replaced.request.chain_info.chain_id, "SN_MAIN");
  assert.deepEqual(
    replaced.request.transaction.calldata,
    written.request.transaction.calldata,
  );
  await assert.rejects(
    inputFromArgs([...single, "--raw-calldata-file", calldataFile]),
    /replaces the single-call options/,
  );
  await assert.rejects(inputFromArgs(args), /--to with a function/);
  await assert.rejects(
    inputFromArgs([...single, "--private-key", "0x1"]),
    /Unknown option/,
  );
  assert.deepEqual(await inputFromArgs(["--help"]), { help: true });
});

test("runner arguments: execution-only switch and bounded configurable timeout", () => {
  assert.deepEqual(parseRunArgs([]), {
    help: false,
    executionOnly: false,
    timeoutMs: PROOF_TIMEOUT_MS,
  });
  assert.deepEqual(
    parseRunArgs(["--execution-only", "--timeout-minutes", "90"]),
    {
      help: false,
      executionOnly: true,
      timeoutMs: 90 * 60 * 1000,
    },
  );
  assert.equal(parseRunArgs(["--timeout-minutes", "0.5"]).timeoutMs, 30000);
  for (const bad of ["0", "-5", "abc", "1e3", "99999999"])
    assert.throws(
      () => parseRunArgs(["--timeout-minutes", bad]),
      /timeout-minutes/,
    );
  assert.throws(() => parseRunArgs(["--timeout-minutes"]), /argument missing/);
  assert.throws(() => parseRunArgs(["--replay"]), /Unknown option/);
  assert.throws(() => parseRunArgs(["extra"]), /positional/);
});

test("runner refuses key-bearing environments and malformed inputs before any artifact write", async (t) => {
  const dir = await temp(t);
  await writeFile(
    path.join(dir, "browser-input.json"),
    JSON.stringify({ request: fixture.request }),
  );
  const keyed = run("scripts/custom-run.mjs", ["--execution-only"], {
    RUN_DIR: dir,
    STARKNET_PRIVATE_KEY: "test-only-placeholder",
  });
  assert.notEqual(keyed.status, 0);
  assert.match(keyed.stderr, /Do not pass signing credentials/);
  const malformed = run("scripts/custom-run.mjs", ["--execution-only"], {
    RUN_DIR: dir,
  });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /must be \{request, source\}/);
  const flag = run("scripts/custom-run.mjs", ["--prove-harder"], {
    RUN_DIR: dir,
  });
  assert.notEqual(flag.status, 0);
  assert.match(flag.stderr, /Unknown option/);
  assert.deepEqual(await readdir(dir), ["browser-input.json"]);
  const request = fixture.request;
  assert.throws(
    () => checkInput({ request, source: { endpoint: "https://x" } }),
    /fixed block_id/,
  );
  assert.throws(
    () => checkInput({ request, source: {} }),
    /endpoint or a capture/,
  );
  assert.throws(
    () => checkInput({ request: {}, source: {} }),
    /no transaction/,
  );
  assert.ok(checkInput({ request, source: { capture: fixture.capture } }));
});

// Single-entry archives in the layout the PIE uses, built without a ZIP library.
function zip(entries) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const body = deflate ? deflateRawSync(data) : data,
      n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(deflate ? 8 : 0, 10);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    central.push(head, n);
    offset += 30 + n.length + body.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("a run clears every derived output of an earlier run, and nothing else", async (t) => {
  const dir = await temp(t);
  const kept = ["browser-input.json", "notes.txt"];
  for (const name of [...kept, ...DERIVED_OUTPUTS])
    await writeFile(path.join(dir, name), "from an earlier request");
  // The proof files are what `sncast invoke` would submit: none may outlive the
  // request they were derived from, in either mode.
  for (const name of ["proof.json", "proof.base64", "proof-facts.txt"])
    assert.ok(DERIVED_OUTPUTS.includes(name));
  await clearDerivedOutputs(dir);
  assert.deepEqual((await readdir(dir)).sort(), kept);
  // Clearing an already clean directory is not an error.
  await clearDerivedOutputs(dir);
  assert.deepEqual((await readdir(dir)).sort(), kept);
});

test("resource summary reads the PIE and totals per-call builtins and syscalls", () => {
  const resources = {
    n_steps: 1234,
    n_memory_holes: 5,
    builtin_instance_counter: { bitwise_builtin: 226 },
  };
  const archive = zip([
    { name: "metadata.json", data: Buffer.from("{}"), deflate: false },
    {
      name: "execution_resources.json",
      data: Buffer.from(JSON.stringify(resources)),
      deflate: true,
    },
  ]);
  assert.deepEqual(
    JSON.parse(unzipEntry(archive, "execution_resources.json")),
    resources,
  );
  assert.equal(unzipEntry(archive, "metadata.json").toString(), "{}");
  assert.throws(() => unzipEntry(archive, "memory.bin"), /not in archive/);
  assert.throws(() => unzipEntry(Buffer.alloc(64), "x"), /Not a ZIP/);
  const summary = summarizeResources(resources, fixture);
  assert.deepEqual(summary.virtual_os, resources);
  const info = fixture.execution.execution;
  assert.deepEqual(summary.transaction.actual_resources, info.actual_resources);
  assert.deepEqual(summary.transaction.total_gas, info.total_gas);
  assert.equal(summary.transaction.call_count, 3);
  assert.deepEqual(summary.transaction.builtin_counters, {
    ec_op: 3,
    range_check: 83,
    pedersen: 1,
  });
  assert.deepEqual(summary.transaction.syscalls_usage, {
    GetExecutionInfo: { call_count: 3, linear_factor: 0 },
    StorageRead: { call_count: 3, linear_factor: 0 },
    CallContract: { call_count: 1, linear_factor: 0 },
  });
  assert.equal(summary.report.pie_sha256, fixture.report.pie_sha256);
  // A receipt without executor details still yields the trace-size figures.
  assert.deepEqual(summarizeResources(resources), { virtual_os: resources });
});
