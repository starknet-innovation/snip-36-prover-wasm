// Offline real PIE-to-recursive-proof validation. No wallet or signing process.
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { startServer } from "./server.mjs";
import { corpus, sha256, expectedPreimage, sameFelts, checkExecution } from "./offline-fixtures.mjs";
import { sampleBrowserMemory } from "./browser-memory.mjs";
const exec = promisify(execFile);
if (process.env.STARKNET_PRIVATE_KEY) throw Error("Signing credentials forbidden");
const [mode, directory, wasmPath, expectedHash, verifierPath, outputDirectory] = process.argv.slice(2);
const selectedCorpus = process.env.OFFLINE_WORKLOAD
  ? corpus.filter(([name]) => name === process.env.OFFLINE_WORKLOAD) : corpus;
if (!selectedCorpus.length) throw Error("Unknown offline workload");
if (!["prepare", "prove"].includes(mode) || !directory ||
    (mode === "prove" && (!wasmPath || !/^[a-f0-9]{64}$/.test(expectedHash ?? "") || !verifierPath || !outputDirectory)))
  throw Error("usage: offline-proof.mjs prepare FIXTURE_DIR | prove FIXTURE_DIR WASM SHA256 NATIVE_VERIFIER NEW_OUTPUT_DIR");
const dir = path.resolve(directory);
const out = mode === "prepare" ? dir : path.resolve(outputDirectory);
await mkdir(out, { recursive: true });
const save = (name, value) => writeFile(path.join(out, name), JSON.stringify(value, null, 2), { flag: "wx" });
const attempt = { mode, started_at: new Date().toISOString(), status: "running",
  attempts: selectedCorpus.map(([name]) => ({ name, status: "not_started" })) };
await save("attempt.json", attempt);
let server, browser, browserServer, memory;
try {
  const pins = JSON.parse(await readFile("pins.json"));
  const proverBytes = mode === "prove" ? await readFile(wasmPath) : undefined;
  if (proverBytes && sha256(proverBytes) !== expectedHash) throw Error("Candidate WASM identity mismatch before browser launch");
  const identity = proverBytes && { sha256: expectedHash, bytes: proverBytes.length };
  server = await startServer(0, { proverBytes });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browserServer = await chromium.launchServer({ headless: true, args: ["--disable-dev-shm-usage"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" } });
  browser = await chromium.connect(browserServer.wsEndpoint());
  memory = sampleBrowserMemory(browserServer.process().pid, (sample) => {
    return appendFile(path.join(out, "process-memory.jsonl"), JSON.stringify(sample) + "\n");
  });
  attempt.chromium = browser.version();
  const page = await browser.newPage();
  await page.exposeFunction("proofStage", (data) => appendFile(path.join(out, "stages.jsonl"), JSON.stringify(data) + "\n"));
  // Any provider/network read is a harness failure, including from Workers.
  const foreignRequests = [];
  await page.context().route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      foreignRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin);
  async function workerCall(module, payload) {
    memory.reset();
    const started = performance.now();
    const result = await page.evaluate(({ module, payload }) => new Promise((resolve, reject) => {
      const started = performance.now();
      const worker = new Worker(module, { type: "module" });
      const timer = setTimeout(() => { worker.terminate(); reject(Error("Proof/execute timeout")); }, 20 * 60 * 1000);
      const finish = (fn, value) => { clearTimeout(timer); worker.terminate(); fn(value); };
      worker.onerror = (e) => finish(reject, Error(e.message));
      worker.onmessage = ({ data }) => {
        if (data.id !== payload.id) return;
        if (["stage", "panic"].includes(data.kind)) window.proofStage(data);
        if (data.kind === "error") finish(reject, Error(data.error));
        if (["execution", "proof"].includes(data.kind)) {
          if (data.pie) data.pie = Array.from(new Uint8Array(data.pie));
          data.report.fresh_worker_ms = performance.now() - started;
          finish(resolve, data);
        }
      };
      if (payload.pie) payload.pie = new Uint8Array(payload.pie).buffer;
      worker.postMessage(payload);
    }), { module, payload });
    result.report.harness_call_ms = performance.now() - started;
    Object.assign(result.report, memory.snapshot());
    return result;
  }
  const retained = mode === "prove" ? JSON.parse(await readFile(path.join(dir, "corpus.json"))) : [];
  for (const [name, file] of selectedCorpus) {
    const fixtureBytes = await readFile(file);
    const fixture = JSON.parse(fixtureBytes);
    const expected = expectedPreimage(fixture, pins.program_hash);
    const entry = { name, fixture: file, fixture_sha256: sha256(fixtureBytes), pie_sha256: fixture.report.pie_sha256,
      expected_output_preimage: expected, expected_source: "committed execution output plus pinned single-task bootloader header" };
    const trial = attempt.attempts.find((item) => item.name === name);
    trial.status = "running";
    await writeFile(path.join(out, "attempt.json"), JSON.stringify(attempt, null, 2));
    console.log(`${mode}: ${name}`);
    if (mode === "prepare") {
      const result = await workerCall("./public-execution-worker.mjs", { id: name, request: fixture.request, source: { capture: fixture.capture } });
      const pie = Buffer.from(result.pie);
      checkExecution(fixture, result, pie);
      await writeFile(path.join(out, `${name}.pie.zip`), pie, { flag: "wx" });
      await save(`${name}.expected.json`, expected);
      await save(`${name}.execution.json`, { report: result.report, output: result.output });
      retained.push(entry);
    } else {
      const stored = retained.find((item) => item.name === name);
      if (JSON.stringify(stored) !== JSON.stringify(entry)) throw Error("Retained corpus metadata differs from trusted fixtures");
      const pie = await readFile(path.join(dir, `${name}.pie.zip`));
      if (sha256(pie) !== entry.pie_sha256) throw Error("Retained PIE digest mismatch");
      const expectedFile = path.join(dir, `${name}.expected.json`);
      if (!sameFelts(JSON.parse(await readFile(expectedFile)), expected)) throw Error("Expected output file tampered");
      const result = await workerCall("./public-prover-worker.mjs", { id: name, pie: Array.from(pie), expectedWasm: identity });
      if (result.report.wasm_sha256 !== expectedHash || result.report.wasm_bytes !== identity.bytes ||
          result.report.pie_sha256 !== entry.pie_sha256 || !sameFelts(result.output_preimage, expected))
        throw Error("Candidate identity/input/public statement mismatch");
      const proof = Buffer.from(result.proof);
      if (sha256(proof) !== result.report.proof_sha256) throw Error("Proof digest mismatch");
      const proofFile = path.join(out, `${name}.proof.bin`);
      await writeFile(proofFile, proof, { flag: "wx" });
      await save(`${name}.proof.json`, { output_preimage: result.output_preimage, report: result.report });
      const verified = await exec(path.resolve(verifierPath), ["verify", proofFile, expectedFile, path.join(out, `${name}.verified`)], { timeout: 120000 });
      await save(`${name}.native.json`, { stdout: verified.stdout, stderr: verified.stderr });
      // Check both verifier-facing boundaries with the same pristine verifier.
      const tampered = Buffer.from(proof); tampered[Math.floor(tampered.length / 2)] ^= 1;
      const badProof = path.join(out, `${name}.tampered.bin`);
      await writeFile(badProof, tampered, { flag: "wx" });
      const badExpected = [...expected]; badExpected[badExpected.length - 1] = `0x${(BigInt(badExpected.at(-1)) + 1n).toString(16)}`;
      await save(`${name}.tampered-expected.json`, badExpected);
      for (const [label, proofArg, outputArg] of [
        ["proof", badProof, expectedFile], ["statement", proofFile, path.join(out, `${name}.tampered-expected.json`)],
      ]) {
        try {
          await exec(path.resolve(verifierPath), ["verify", proofArg, outputArg, path.join(out, `${name}.negative-${label}`)], { timeout: 120000 });
        } catch (error) {
          if (!Number.isInteger(error.code) || error.code === 0) throw error;
          await save(`${name}.negative-${label}.json`, { rejected: true, exit_code: error.code, stdout: error.stdout, stderr: error.stderr });
          continue;
        }
        throw Error(`Native verifier accepted tampered ${label}`);
      }
      trial.report = result.report;
    }
    if (foreignRequests.length) throw Error("Offline harness attempted external network access");
    trial.status = "passed";
    await writeFile(path.join(out, "attempt.json"), JSON.stringify(attempt, null, 2));
  }
  if (mode === "prepare") await save("corpus.json", retained);
  attempt.status = "passed";
} catch (error) {
  attempt.status = "failed";
  attempt.error = String(error);
  for (const trial of attempt.attempts)
    if (trial.status === "running") { trial.status = "failed"; trial.error = String(error); }
  throw error;
} finally {
  attempt.finished_at = new Date().toISOString();
  await writeFile(path.join(out, "attempt.json"), JSON.stringify(attempt, null, 2));
  await browser?.close();
  await memory?.stop();
  await browserServer?.close();
  if (server) await new Promise((r) => server.close(r));
}
