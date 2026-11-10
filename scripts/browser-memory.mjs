// OS RSS samples for this Chromium process family. Shared pages can be counted
// more than once; this is sampled summed RSS, not private memory or a hard peak.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export function processFamilyRss(output, rootPid) {
  const rows = output.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  const family = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows)
      if (family.has(parent) && !family.has(pid)) { family.add(pid); changed = true; }
  }
  return rows.filter(([pid]) => family.has(pid)).reduce((sum, [, , rss]) => sum + rss * 1024, 0);
}
export function sampleBrowserMemory(rootPid, onSample = () => {}) {
  let peak = 0, busy = false, error = null, latest = 0, generation = 0;
  async function sample() {
    if (busy) return;
    busy = true;
    const sampledGeneration = generation;
    try {
      const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,rss="], { timeout: 3000, maxBuffer: 4 * 1024 ** 2 });
      if (sampledGeneration !== generation) return;
      latest = processFamilyRss(stdout, rootPid);
      peak = Math.max(peak, latest);
      await onSample({ at: new Date().toISOString(), rss_sum_bytes: latest });
    } catch (failure) { error = String(failure); }
    finally { busy = false; }
  }
  const timer = setInterval(sample, 500);
  return { reset() { generation++; peak = 0; latest = 0; error = null; }, snapshot() { return { browser_process_peak_bytes: peak || null,
    browser_process_rss_sum_bytes: latest || null, browser_process_memory_error: error,
    browser_process_memory_scope: "500 ms sampled summed Chromium-family RSS; shared pages may be counted multiple times" }; },
    async stop() { clearInterval(timer); await sample(); } };
}
