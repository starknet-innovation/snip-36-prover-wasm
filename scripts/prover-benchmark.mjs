// Paired fresh-Worker measurements. Every attempt is retained, including failures.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { chromium } from "playwright";
import { sha256, corpus } from "./offline-fixtures.mjs";
const exec = promisify(execFile);
let interrupted = false;
// Finish the current child so its finally block closes Chromium and saves evidence.
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { interrupted = true; });
if (process.env.STARKNET_PRIVATE_KEY) throw Error("Signing credentials forbidden");
const [fixtures, baseline, baselineHash, candidate, candidateHash, verifier, output] = process.argv.slice(2);
if (!output || ![baselineHash, candidateHash].every((hash) => /^[a-f0-9]{64}$/.test(hash ?? "")))
  throw Error("usage: prover-benchmark.mjs FIXTURES BASELINE SHA256 CANDIDATE SHA256 VERIFIER NEW_OUTPUT_DIR");
const dir = path.resolve(output); await mkdir(dir, { recursive: true });
const plan = JSON.parse(await readFile("docs/port/benchmark-plan.json"));
for (const [file, hash] of [[baseline, baselineHash], [candidate, candidateHash]])
  if (sha256(await readFile(file)) !== hash) throw Error("Preregistered module replaced");
const versionBrowser = await chromium.launch({ headless: true,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" } });
const chromiumVersion = versionBrowser.version(); await versionBrowser.close();
const identity = { registered_at: new Date().toISOString(), plan, baseline: { file: baseline, sha256: baselineHash },
  candidate: { file: candidate, sha256: candidateHash }, verifier: { file: verifier, sha256: sha256(await readFile(verifier)) },
  runner_sha256: sha256(await readFile("scripts/offline-proof.mjs")), benchmark_sha256: sha256(await readFile("scripts/prover-benchmark.mjs")),
  corpus: JSON.parse(await readFile(path.join(fixtures, "corpus.json"))), node: process.version, chromium: chromiumVersion,
  source_identity_files: process.env.BENCH_IDENTITY_FILES?.split(path.delimiter) ?? [],
  mode: "paired fresh Workers; separate child browser per attempt" };
identity.repository_head = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
identity.harness_files = {};
for (const file of ["scripts/offline-proof.mjs", "scripts/offline-fixtures.mjs", "scripts/browser-memory.mjs",
  "scripts/server.mjs", "web/sequencer-memory64.mjs", "web/public-prover-worker.mjs", "web/public-run-controller.mjs", "package-lock.json"])
  identity.harness_files[file] = sha256(await readFile(file));
identity.source_identities = [];
for (const file of identity.source_identity_files) { const bytes = await readFile(file); identity.source_identities.push({ file, sha256: sha256(bytes), record: JSON.parse(bytes) }); }
if (identity.source_identities.length < 2) throw Error("Set BENCH_IDENTITY_FILES to baseline and candidate identity records");
await writeFile(path.join(dir, "registration.json"), JSON.stringify(identity, null, 2), { flag: "wx" });
const attempts = [];
const save = () => writeFile(path.join(dir, "attempts.json"), JSON.stringify(attempts, null, 2));
campaign: for (const [name] of corpus) {
  for (let pair = 0; pair < plan.warmup_pairs + plan.measured_pairs; pair++) {
    const warmup = pair < plan.warmup_pairs;
    const roles = pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    for (const role of roles) {
      if (interrupted) break campaign;
      const attemptDir = path.join(dir, `${name}-${warmup ? "warmup" : "measured"}-${pair}-${role}`);
      const trial = { name, pair, warmup, role, directory: attemptDir, status: "running", started_at: new Date().toISOString() };
      attempts.push(trial); await save();
      console.log(`${name} ${warmup ? "warmup" : "measured"} pair ${pair} ${role}`);
      try {
        const module = role === "baseline" ? baseline : candidate, hash = role === "baseline" ? baselineHash : candidateHash;
        const result = await exec(process.execPath, ["scripts/offline-proof.mjs", "prove", fixtures, module, hash, verifier, attemptDir], {
          timeout: plan.timeout_ms_per_proof + 300000, maxBuffer: 2 * 1024 ** 2,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", OFFLINE_WORKLOAD: name },
        });
        trial.stdout = result.stdout; trial.stderr = result.stderr;
        const receipt = JSON.parse(await readFile(path.join(attemptDir, `${name}.proof.json`)));
        trial.report = receipt.report;
        if (receipt.report.wasm_sha256 !== hash) throw Error("Measured wrong module");
        trial.status = "passed";
      } catch (error) {
        trial.status = "failed"; trial.error = String(error); trial.stdout = error.stdout; trial.stderr = error.stderr;
      }
      trial.finished_at = new Date().toISOString(); await save();
    }
  }
}
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const cv = (values) => { const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)) / mean; };
const summary = [];
const metrics = ["load_ms", "init_ms", "prove_ms", "fresh_worker_ms", "rust_requested_peak_bytes", "wasm_linear_memory_bytes", "browser_process_peak_bytes"];
for (const [name] of corpus) {
  const group = attempts.filter((a) => a.name === name);
  const result = { name, roles: {}, stable: group.every((a) => a.status === "passed") };
  for (const role of ["baseline", "candidate"]) {
    const data = group.filter((a) => a.role === role && !a.warmup && a.status === "passed");
    const values = data.map((a) => a.report.prove_ms);
    const variation = data.length === plan.measured_pairs ? cv(values) : null;
    result.roles[role] = { successful_measured_attempts: data.length, prove_time_cv: variation,
      medians: Object.fromEntries(metrics.map((m) => [m, data.length && data.every((a) => Number.isFinite(a.report[m])) ? median(data.map((a) => a.report[m])) : null])) };
    if (variation === null || variation > plan.stability_gate.maximum_time_coefficient_of_variation_each_side) result.stable = false;
  }
  if (result.stable) {
    const paired = metrics.map((metric) => {
      const pairs = [];
      for (let pair = plan.warmup_pairs; pair < plan.warmup_pairs + plan.measured_pairs; pair++) {
        const base = group.find((a) => a.pair === pair && a.role === "baseline").report[metric];
        const cand = group.find((a) => a.pair === pair && a.role === "candidate").report[metric];
        if (Number.isFinite(base) && base > 0 && Number.isFinite(cand)) pairs.push(cand / base);
      }
      return [metric, pairs.length === plan.measured_pairs ? median(pairs) : null];
    });
    result.median_paired_ratios = Object.fromEntries(paired);
    result.accepted = ["prove_ms", "rust_requested_peak_bytes", "wasm_linear_memory_bytes"].every((key) => Number.isFinite(result.median_paired_ratios[key])) &&
      result.median_paired_ratios.prove_ms <= plan.acceptance.maximum_median_prove_time_ratio &&
      result.median_paired_ratios.rust_requested_peak_bytes <= plan.acceptance.maximum_median_rust_requested_peak_ratio &&
      result.median_paired_ratios.wasm_linear_memory_bytes <= plan.acceptance.maximum_median_linear_memory_ratio;
  } else result.accepted = false; // Deliberately no ratios for unstable or failed workloads.
  summary.push(result);
}
await writeFile(path.join(dir, "summary.json"), JSON.stringify({ scope: "preregistered paired campaign", interrupted,
  declared_attempts: corpus.length * (plan.warmup_pairs + plan.measured_pairs) * 2,
  completed_attempts: attempts.filter((trial) => trial.status !== "running").length,
  all_accepted: !interrupted && summary.every((v) => v.accepted), workloads: summary }, null, 2));
console.log(JSON.stringify(summary));
