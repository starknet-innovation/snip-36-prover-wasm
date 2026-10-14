// Kill a real synchronous WASM proof while it runs, then initialize a fresh Worker.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './server.mjs';
import { sha256 } from './offline-fixtures.mjs';
import { PROOF_TIMEOUT_MS } from './proof-timeouts.mjs';
if (process.env.STARKNET_PRIVATE_KEY) throw Error('Signing credentials forbidden');
const [fixtures, module, hash, output] = process.argv.slice(2);
if (!output) throw Error('usage: prover-cancellation.mjs FIXTURES WASM SHA256 NEW_OUTPUT_DIR');
const bytes = await readFile(module), pie = await readFile(path.join(fixtures, 'balance.pie.zip'));
const fixture = JSON.parse(await readFile('fixtures/captured-execution.json'));
if (sha256(bytes) !== hash || sha256(pie) !== fixture.report.pie_sha256) throw Error('Input identity mismatch');
await mkdir(output, { recursive: true });
const attempt = { started_at: new Date().toISOString(), status: 'running', wasm_sha256: hash };
const file = path.join(output, 'attempt.json'); await writeFile(file, JSON.stringify(attempt), { flag: 'wx' });
let server, browser;
try {
  server = await startServer(0, { proverBytes: bytes });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
  const page = await browser.newPage(); await page.goto(origin);
  const result = await page.evaluate(({ origin, pie, identity, cancelStage, timeoutMs }) => new Promise((resolve, reject) => {
    const source = `import { loadMemory64 } from ${JSON.stringify(origin + '/sequencer-memory64.mjs')};
      self.onmessage = async ({data}) => { try {
        const api = await loadMemory64(${JSON.stringify(origin + '/sequencer-prover.wasm')},
          message => self.postMessage({kind:'error',message}),
          stage => self.postMessage({kind:'stage',stage}), data.identity);
        api.init(); self.postMessage({kind:'initialized',identity:api.identity});
        if(data.pie) { api.prove(new Uint8Array(data.pie)); self.postMessage({kind:'completed'}); }
      } catch(error) { self.postMessage({kind:'error',message:String(error)}); } };`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' }); let replacement, cancelled = false, stale = 0;
    const stages = []; const timeout = setTimeout(() => finish(reject, Error('Cancellation test timed out')), timeoutMs);
    function finish(fn, value) { clearTimeout(timeout); worker.terminate(); replacement?.terminate(); URL.revokeObjectURL(url); fn(value); }
    worker.onerror = (event) => finish(reject, Error(event.message));
    worker.onmessage = ({data}) => {
      if (cancelled) { stale++; return; }
      if (data.kind === 'error' || data.kind === 'completed') return finish(reject, Error(data.message ?? 'Proof completed before cancellation'));
      if (data.kind !== 'stage') return;
      stages.push(data.stage);
      if (!data.stage.message.includes(cancelStage)) return;
      cancelled = true; worker.terminate();
      replacement = new Worker(url, { type: 'module' });
      replacement.onerror = (event) => finish(reject, Error(event.message));
      replacement.onmessage = ({data: next}) => {
        if (next.kind === 'error') finish(reject, Error(next.message));
        else if (next.kind === 'initialized') setTimeout(() => finish(resolve, { cancelled_at: data.stage, stale_messages: stale,
          replacement_identity: next.identity, stages }), 200);
      };
      replacement.postMessage({ identity });
    };
    worker.postMessage({ pie, identity });
  }), { origin, pie: Array.from(pie), identity: { sha256: hash, bytes: bytes.length },
    cancelStage: process.env.CANCEL_STAGE ?? "Prove the cairo-circuit verifier",
    // Cancellation lands mid-proof, so allow the same budget as a full proof.
    timeoutMs: PROOF_TIMEOUT_MS });
  if (result.replacement_identity.wasm_sha256 !== hash) throw Error('Replacement Worker loaded another module');
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  attempt.status = 'passed'; console.log('Terminated real recursive proving; fresh Worker initialized exact candidate bytes');
} catch(error) { attempt.status = 'failed'; attempt.error = String(error); throw error; }
finally { attempt.finished_at = new Date().toISOString(); await writeFile(file, JSON.stringify(attempt, null, 2)); await browser?.close(); if(server) await new Promise(resolve => server.close(resolve)); }
