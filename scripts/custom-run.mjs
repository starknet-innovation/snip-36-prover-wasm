// Generic headless driver: executes, and by default proves, the caller-supplied
// virtual transaction in RUN_DIR/browser-input.json with the actual browser Workers.
// Sends no transaction and needs no key. See docs/custom-transactions.md.
//
// Unlike browser-e2e.mjs it runs no invalid-signature control: that control needs an
// account that validates a signature, which a caller's account may not do.
import { readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { totalmem } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { inflateRawSync } from "node:zlib";
import { PROOF_TIMEOUT_MS } from "./proof-timeouts.mjs";

export const USAGE = `Usage: RUN_DIR=DIR node scripts/custom-run.mjs [--execution-only] [--timeout-minutes N]

Reads DIR/browser-input.json ({request, source}; default DIR artifacts/run).
--execution-only stops after the Cairo PIE and the resource summary.
--timeout-minutes bounds the whole browser run (default ${PROOF_TIMEOUT_MS / 60000}).`;

export function parseRunArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      "execution-only": { type: "boolean" },
      "timeout-minutes": { type: "string" },
      help: { type: "boolean" },
    },
  });
  const minutes = values["timeout-minutes"];
  if (minutes !== undefined && !/^\d+(\.\d+)?$/.test(minutes))
    throw Error("--timeout-minutes must be a positive number");
  const timeoutMs =
    minutes === undefined ? PROOF_TIMEOUT_MS : Number(minutes) * 60 * 1000;
  // setTimeout-style delays above 2^31-1 ms are not representable.
  if (!(timeoutMs >= 1000 && timeoutMs <= 2 ** 31 - 1))
    throw Error("--timeout-minutes must be a positive number");
  return {
    help: Boolean(values.help),
    executionOnly: Boolean(values["execution-only"]),
    timeoutMs,
  };
}

export function checkInput(input) {
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!object(input) || !object(input.request) || !object(input.source))
    throw Error("browser-input.json must be {request, source}");
  if (!object(input.request.transaction))
    throw Error("browser-input.json request has no transaction");
  if (
    !object(input.source.capture) &&
    typeof input.source.endpoint !== "string"
  )
    throw Error("browser-input.json source needs an endpoint or a capture");
  // Without a capture the Worker would otherwise anchor to "latest".
  if (!object(input.source.capture) && !object(input.source.block_id))
    throw Error("browser-input.json source needs a fixed block_id");
  return input;
}

// Minimal ZIP reader for the Cairo PIE (central directory; stored or deflated).
export function unzipEntry(buf, name) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw Error("Not a ZIP archive");
  let at = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    if (buf.readUInt32LE(at) !== 0x02014b50)
      throw Error("Corrupt ZIP central directory");
    const method = buf.readUInt16LE(at + 10),
      size = buf.readUInt32LE(at + 20),
      nameLength = buf.readUInt16LE(at + 28),
      extra = buf.readUInt16LE(at + 30),
      comment = buf.readUInt16LE(at + 32),
      local = buf.readUInt32LE(at + 42);
    if (buf.toString("utf8", at + 46, at + 46 + nameLength) === name) {
      const start =
        local +
        30 +
        buf.readUInt16LE(local + 26) +
        buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw Error("Unsupported ZIP compression method");
    }
    at += 46 + nameLength + extra + comment;
  }
  throw Error(name + " not in archive");
}

// Sums what Blockifier reports per call, over validate, execute and inner calls.
function walkCalls(info, totals) {
  if (!info || typeof info !== "object") return;
  totals.calls++;
  for (const [name, count] of Object.entries(info.builtin_counters ?? {}))
    totals.builtins[name] = (totals.builtins[name] ?? 0) + count;
  for (const [name, use] of Object.entries(info.syscalls_usage ?? {})) {
    const entry = (totals.syscalls[name] ??= {
      call_count: 0,
      linear_factor: 0,
    });
    entry.call_count += use.call_count ?? 0;
    entry.linear_factor += use.linear_factor ?? 0;
  }
  for (const inner of info.inner_calls ?? []) walkCalls(inner, totals);
}

// `pie` is execution_resources.json of the PIE: the whole virtual OS run, which is
// what the prover's trace has to hold. `transaction` is the executor's own account of
// the transaction alone and is omitted when the receipt does not carry those fields.
export function summarizeResources(pieResources, receipt = {}) {
  const summary = {
    virtual_os: {
      n_steps: pieResources.n_steps,
      n_memory_holes: pieResources.n_memory_holes,
      builtin_instance_counter: pieResources.builtin_instance_counter,
    },
  };
  const info = receipt.execution?.execution;
  if (info && typeof info === "object") {
    const totals = { calls: 0, builtins: {}, syscalls: {} };
    walkCalls(info.validate_call_info, totals);
    walkCalls(info.execute_call_info, totals);
    summary.transaction = {
      actual_resources: info.actual_resources ?? null,
      total_gas: info.total_gas ?? null,
      validate_gas_consumed:
        info.validate_call_info?.execution?.gas_consumed ?? null,
      execute_gas_consumed:
        info.execute_call_info?.execution?.gas_consumed ?? null,
      call_count: totals.calls,
      builtin_counters: totals.builtins,
      syscalls_usage: totals.syscalls,
    };
  }
  if (receipt.report)
    summary.report = Object.fromEntries(
      [
        "acquisition_execution_witness_ms",
        "virtual_os_ms",
        "total_ms",
        "wasm_linear_memory_bytes",
        "rust_requested_peak_bytes",
        "pie_bytes",
        "pie_sha256",
      ]
        .filter((key) => receipt.report[key] !== undefined)
        .map((key) => [key, receipt.report[key]]),
    );
  return summary;
}

// Everything this script derives from browser-input.json. A run removes all of them as
// soon as it has found that file, whatever its mode and before every check, the
// credential refusal and argument parsing included: otherwise an --execution-only run,
// or one refused or failed later, would leave an earlier request's proof files next to
// the new request.
export const DERIVED_OUTPUTS = [
  "execution.json",
  "cairo-pie.zip",
  "execution-resources.json",
  "proof.json",
  "proof.base64",
  "proof-facts.txt",
];

export async function clearDerivedOutputs(dir) {
  await Promise.all(
    DERIVED_OUTPUTS.map((name) => rm(path.join(dir, name), { force: true })),
  );
}

// One deadline for the whole browser run, started before the browser is launched.
// remainingMs() is what is left of it, for the browser start-up calls that take their
// own timeout, and throws once it is spent.
export function startDeadline(timeoutMs, now = Date.now) {
  const started = now();
  return {
    elapsedMs: () => now() - started,
    remainingMs() {
      const left = timeoutMs - (now() - started);
      if (left <= 0)
        throw Error(`Browser run exceeded ${timeoutMs / 60000} minutes`);
      return Math.ceil(left);
    },
  };
}

// The proof receipt must be about the execution that was just saved: same run, same
// PIE, and a statement whose payload is that execution's virtual OS output. The module
// hash in the receipt only identifies the prover bytes that ran, not what they proved,
// and proof-facts.txt is derived from the receipt's output preimage.
export function assertProofMatchesExecution(execution, proof) {
  const sameFelts = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((felt, i) => {
      try {
        return BigInt(felt) === BigInt(b[i]);
      } catch {
        return false;
      }
    });
  if (!execution)
    throw Error("Proof receipt arrived without a saved execution receipt");
  if (execution.run_id === undefined || execution.run_id !== proof.run_id)
    throw Error("Proof receipt belongs to another run than the execution");
  if (
    typeof execution.report?.pie_sha256 !== "string" ||
    execution.report.pie_sha256 !== proof.report?.pie_sha256
  )
    throw Error("Proof was generated for another PIE than the saved execution");
  if (
    !Array.isArray(execution.output) ||
    execution.output.length === 0 ||
    !sameFelts(proof.output, execution.output) ||
    !Array.isArray(proof.output_preimage) ||
    !sameFelts(proof.output_preimage.slice(3), execution.output)
  )
    throw Error("Proof statement does not match the execution output");
}

async function main() {
  const argv = process.argv.slice(2);
  // The only invocation that touches nothing.
  if (argv.includes("--help")) return console.log(USAGE);
  const dir = path.resolve(process.env.RUN_DIR ?? "artifacts/run");
  // If this is a run directory its input may have been replaced: nothing derived from
  // an earlier input may survive this invocation, even one refused just below.
  let text, unreadable;
  try {
    text = await readFile(path.join(dir, "browser-input.json"), "utf8");
    await clearDerivedOutputs(dir);
  } catch (error) {
    unreadable = error;
  }
  // Before anything is written or any browser is started.
  if (process.env.STARKNET_PRIVATE_KEY)
    throw Error("Do not pass signing credentials to the browser step");
  const options = parseRunArgs(argv);
  if (unreadable) throw unreadable;
  const input = checkInput(JSON.parse(text));
  const save = (name, data) =>
    writeFile(path.join(dir, name), data, { mode: 0o600 });
  const json = (value) => JSON.stringify(value, null, 2) + "\n";
  let expectedWasm, proverBytes;
  if (!options.executionOnly) {
    if (totalmem() < 6 * 1024 ** 3)
      throw Error(
        "The low-memory V2 prover needs a runner with at least 6 GiB RAM",
      );
    proverBytes = await readFile("web/sequencer-prover.wasm");
    expectedWasm = {
      bytes: proverBytes.length,
      sha256: createHash("sha256").update(proverBytes).digest("hex"),
    };
    if (
      process.env.PROVER_SHA256 &&
      process.env.PROVER_SHA256 !== expectedWasm.sha256
    )
      throw Error("Candidate WASM replaced before validation");
  }
  const [
    { chromium },
    { startServer },
    { proofFacts },
    { assertProofProfile },
  ] = await Promise.all([
    import("playwright"),
    import("./server.mjs"),
    import("./transaction.mjs"),
    import("../web/prover-profile.mjs"),
  ]);

  let savedExecution;
  async function saveExecution(page, index) {
    // The receipt carries the PIE as a number array; pull the bytes out in base64
    // chunks instead of one large message. execution.json keeps everything else.
    const { rest, length } = await page.evaluate((i) => {
      const { pie, ...rest } = window.receipts[i];
      return { rest, length: pie.length };
    }, index);
    const chunks = [],
      CHUNK = 4 * 1024 * 1024;
    for (let from = 0; from < length; from += CHUNK)
      chunks.push(
        Buffer.from(
          await page.evaluate(
            ({ i, from, to }) => {
              const bytes = new Uint8Array(
                window.receipts[i].pie.slice(from, to),
              );
              let text = "";
              for (let k = 0; k < bytes.length; k += 0x8000)
                text += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
              return btoa(text);
            },
            { i: index, from, to: from + CHUNK },
          ),
          "base64",
        ),
      );
    const pie = Buffer.concat(chunks);
    if (
      rest.kind !== "execution" ||
      !rest.ok ||
      createHash("sha256").update(pie).digest("hex") !== rest.report.pie_sha256
    )
      throw Error("PIE bytes do not match the Worker's receipt");
    await save("cairo-pie.zip", pie);
    await save("execution.json", JSON.stringify(rest));
    savedExecution = rest;
    const summary = summarizeResources(
      JSON.parse(unzipEntry(pie, "execution_resources.json").toString()),
      rest,
    );
    await save("execution-resources.json", json(summary));
    console.log("Saved browser execution");
    console.log(JSON.stringify(summary, null, 2));
  }

  async function saveProof(page, index) {
    const receipt = await page.evaluate((i) => window.receipts[i], index);
    if (receipt.kind !== "proof" || !receipt.ok)
      throw Error("Incomplete receipt");
    const { report } = receipt;
    if (
      report.wasm_sha256 !== expectedWasm.sha256 ||
      report.wasm_bytes !== expectedWasm.bytes
    )
      throw Error("Browser did not prove with the expected WASM bytes");
    const proof = Buffer.from(receipt.proof);
    assertProofProfile(proof);
    if (
      createHash("sha256").update(proof).digest("hex") !== report.proof_sha256
    )
      throw Error("Proof bytes do not match the Worker's receipt");
    assertProofMatchesExecution(savedExecution, receipt);
    const facts = proofFacts(receipt.output_preimage);
    await save("proof.json", JSON.stringify(receipt));
    // The two files `sncast invoke --proof-file / --proof-facts-file` read.
    await save("proof.base64", proof.toString("base64"));
    await save("proof-facts.txt", facts.join(","));
    console.log("Saved browser proof");
    console.log(JSON.stringify(report, null, 2));
  }

  const server = await startServer(0, { proverBytes });
  const deadline = startDeadline(options.timeoutMs);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: deadline.remainingMs(),
      args: ["--disable-dev-shm-usage"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" },
    });
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("Browser error:", e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {
      timeout: deadline.remainingMs(),
    });
    await page.waitForFunction(
      () => typeof window.startRun === "function",
      undefined,
      { timeout: deadline.remainingMs() },
    );
    const elapsed = () => (deadline.elapsedMs() / 1000).toFixed(0) + " s";
    await page.evaluate(
      ({ input, options }) => {
        window.startRun(input.request, input.source, options);
      },
      {
        input,
        options: { executionOnly: options.executionOnly, expectedWasm },
      },
    );
    let saved = 0,
      lastStatus = "";
    for (;;) {
      const state = await page.evaluate(() => ({
        error: window.runError,
        done: Boolean(window.runComplete),
        receipts: (window.receipts ?? []).map((r) => r.kind),
        status: (document.querySelector("#status")?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        memory: document.querySelector("#memory")?.textContent ?? "",
      }));
      if (state.status !== lastStatus) {
        lastStatus = state.status;
        console.log(`[${elapsed()}] ${state.status} (memory ${state.memory})`);
      }
      for (; saved < state.receipts.length; saved++)
        if (state.receipts[saved] === "execution")
          await saveExecution(page, saved);
        else await saveProof(page, saved);
      if (state.error) throw Error(state.error);
      if (state.done) break;
      deadline.remainingMs();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (saved !== (options.executionOnly ? 1 : 2))
      throw Error("Browser run completed without the expected receipts");
    console.log(`Done in ${elapsed()}; outputs in ${dir}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
