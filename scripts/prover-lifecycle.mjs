// One memory64 instance: repeated init, two real proofs, and a recoverable PIE error.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { startServer } from "./server.mjs";
import { sha256, expectedPreimage, sameFelts } from "./offline-fixtures.mjs";
const exec = promisify(execFile);
if (process.env.STARKNET_PRIVATE_KEY) throw Error("Signing credentials forbidden");
const [fixtureDir, modulePath, moduleHash, verifier, output] = process.argv.slice(2);
if (!output || !/^[a-f0-9]{64}$/.test(moduleHash ?? "")) throw Error("usage: prover-lifecycle.mjs FIXTURES WASM SHA256 NATIVE_VERIFIER NEW_OUTPUT_DIR");
const dir = path.resolve(output); await mkdir(dir, { recursive: true });
const attempt = { started_at: new Date().toISOString(), status: "running" };
await writeFile(path.join(dir, "attempt.json"), JSON.stringify(attempt), { flag: "wx" });
let browser, server;
try {
  const bytes = await readFile(modulePath); if (sha256(bytes) !== moduleHash) throw Error("Module replaced");
  const fixture = JSON.parse(await readFile("fixtures/captured-execution.json"));
  const pins = JSON.parse(await readFile("pins.json")); const expected = expectedPreimage(fixture, pins.program_hash);
  const pie = await readFile(path.join(fixtureDir, "balance.pie.zip"));
  if (sha256(pie) !== fixture.report.pie_sha256) throw Error("Retained PIE replaced");
  server = await startServer(0, { proverBytes: bytes }); const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"], env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" } });
  const page = await browser.newPage(); await page.goto(origin);
  const result = await page.evaluate(({ pie, identity, origin }) => new Promise((resolve, reject) => {
    const source = `import { loadMemory64 } from ${JSON.stringify(origin + "/sequencer-memory64.mjs")};
      self.onmessage = async ({data}) => {
        try {
          const api = await loadMemory64(${JSON.stringify(origin + "/sequencer-prover.wasm")}, message => self.postMessage({kind:'panic',message}), () => {}, data.identity);
          api.init(); api.memory(); const initial = api.memory(); api.init(); const reinitialized = api.memory();
          const first = api.prove(new Uint8Array(data.pie)); const after_first = api.memory();
          let error; try { api.prove(new Uint8Array([1,2,3])); } catch(failure) { error = String(failure); }
          if (!error) throw Error('Malformed PIE accepted');
          const after_error = api.memory(); api.init();
          const second = api.prove(new Uint8Array(data.pie)); const after_second = api.memory();
          self.postMessage({kind:'done', identity:api.identity, initial, reinitialized, after_first, after_error, after_second,
            error, first:{proof:Array.from(first.proof),output_preimage:first.output_preimage},
            second:{proof:Array.from(second.proof),output_preimage:second.output_preimage}});
        } catch(error) { self.postMessage({kind:'error',error:String(error)}); }
      };`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url, { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(url); reject(Error("Lifecycle timeout")); }, 40 * 60 * 1000);
    const finish = (fn, value) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); fn(value); };
    worker.onerror = (e) => finish(reject, Error(e.message));
    worker.onmessage = ({ data }) => {
      if (data.kind === "error") finish(reject, Error(data.error));
      else if (data.kind === "done") finish(resolve, data);
    };
    worker.postMessage({ pie, identity });
  }), { pie: Array.from(pie), identity: { sha256: moduleHash, bytes: bytes.length }, origin });
  if (result.identity.wasm_sha256 !== moduleHash) throw Error("Wrong module");
  await writeFile(path.join(dir, "raw-result.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  if (!sameFelts(result.first.output_preimage, expected) || !sameFelts(result.second.output_preimage, expected)) throw Error("Wrong lifecycle statement");
  if (!Buffer.from(result.first.proof).equals(Buffer.from(result.second.proof))) throw Error("Sequential proof bytes changed");
  if (result.reinitialized.rust_requested_live_bytes !== result.initial.rust_requested_live_bytes) throw Error("Repeated init retains another precompute set");
  if (result.after_error.rust_requested_live_bytes > result.after_first.rust_requested_live_bytes) throw Error("Error increases retained allocation");
  if (result.after_second.rust_requested_live_bytes !== result.after_first.rust_requested_live_bytes) throw Error("Sequential proof retains another allocation");
  for (const name of ["first", "second"]) {
    const file = path.join(dir, `${name}.proof.bin`); await writeFile(file, Buffer.from(result[name].proof), { flag: "wx" });
    await exec(path.resolve(verifier), ["verify", file, path.resolve(fixtureDir, "balance.expected.json"), path.join(dir, `${name}.verified`)], { timeout: 120000 });
  }
  delete result.first.proof; delete result.second.proof;
  await writeFile(path.join(dir, "result.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  attempt.status = "passed"; console.log("One instance: repeated init, malformed PIE recovery and sequential proof verification passed");
} catch (error) { attempt.status = "failed"; attempt.error = String(error); throw error; }
finally { attempt.finished_at = new Date().toISOString(); await writeFile(path.join(dir, "attempt.json"), JSON.stringify(attempt, null, 2)); await browser?.close(); if (server) await new Promise((r) => server.close(r)); }
