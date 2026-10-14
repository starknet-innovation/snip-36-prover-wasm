// Selectable prover modules. Stats are medians from the paired browser campaign
// (docs/port/benchmark-sparse-merkle-01.json, coinflip-heads workload, same machine).
// Proofs are byte-identical across builds; only memory and time differ.
export const PROVER_BUILDS = Object.freeze({
  standard: Object.freeze({
    label: "Standard",
    note: "Unchanged pinned prover (v0.1.0)",
    url: "./sequencer-prover.wasm",
    peak_bytes: 13826136697,
    linear_bytes: 14366539776,
    prove_ms: 59400,
    need: "about 14 GiB",
  }),
  memory: Object.freeze({
    label: "Memory-optimised",
    note: "Opt-in prover-memory profile (v0.2.0-memory)",
    url: "./prover-memory.wasm",
    peak_bytes: 2311203058,
    linear_bytes: 3307667456,
    prove_ms: 80415,
    need: "about 3.5 GiB",
  }),
});

// ponytail: navigator.deviceMemory is a coarse, rounded RAM hint (Chromium reports
// 32 on a 32 GB Mac; Safari/Firefox report nothing). Standard is chosen only when
// the device reports 16+ GB; otherwise the memory build, which runs anywhere standard does.
// Upgrade path: add better signals (free memory, a memory64 grow probe, timing) here.
export function recommendedBuild(nav = globalThis.navigator) {
  return (nav?.deviceMemory ?? 0) >= 16 ? "standard" : "memory";
}

const gb = (n) => (n / 1e9).toFixed(2) + " GB";
const s = (ms) => (ms / 1000).toFixed(1) + " s";

// Renders radio cards into `root` and returns a getter for the selected build key.
export function buildPicker(root, onChange = () => {}) {
  const recommended = recommendedBuild();
  let selected = recommended;
  root.replaceChildren();
  root.setAttribute("role", "radiogroup");
  for (const [key, b] of Object.entries(PROVER_BUILDS)) {
    const label = document.createElement("label");
    label.className = "build-option";
    const input = document.createElement("input");
    Object.assign(input, { type: "radio", name: "prover-build", value: key });
    input.checked = key === selected;
    input.onchange = () => {
      selected = key;
      onChange(key, b);
    };
    const body = document.createElement("span");
    body.innerHTML = `<b></b><small></small><span class="build-stats">
      <span>WASM MEMORY<strong>${gb(b.linear_bytes)}</strong></span>
      <span>RUST HEAP<strong>${gb(b.peak_bytes)}</strong></span>
      <span>PROVE<strong>${s(b.prove_ms)}</strong></span></span>`;
    body.querySelector("b").textContent = b.label;
    body.querySelector("small").textContent =
      b.note + (key === recommended ? " · Recommended for this device" : "");
    label.append(input, body);
    root.append(label);
  }
  onChange(selected, PROVER_BUILDS[selected]);
  return {
    get: () => selected,
    disable: (d) =>
      root.querySelectorAll("input").forEach((i) => (i.disabled = d)),
  };
}

// One-line summary of what this browser actually measured for a proof receipt.
export function measuredSummary(report, key) {
  const b = PROVER_BUILDS[key] ?? PROVER_BUILDS.standard;
  return `${b.label}: proved in ${s(report.prove_ms)} (reference ${s(b.prove_ms)}) · linear memory ${gb(report.wasm_linear_memory_bytes)} · Rust heap peak ${gb(report.rust_requested_peak_bytes)}`;
}
