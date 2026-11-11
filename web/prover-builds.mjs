// V2 is the supported runtime. Keep the V1 memory card visible as historical
// context, but never load its incompatible circuit into the V2 proof flow.
import { BACKEND_RELEASE, PROVING_REVISION } from "./prover-profile.mjs";
export const PROVER_BUILDS = Object.freeze({
  standard: Object.freeze({
    label: "Standard V2",
    available: true,
    note: "V2 circuit · balance replay measurement",
    url: "./sequencer-prover.wasm",
    sha256: "173161a747692e74d7420f85f673c716304a5180bd28572d0717072852dfafca",
    bytes: 70062417,
    peak_bytes: 14146828585,
    linear_bytes: 14283112448,
    prove_ms: 61106,
    need: "about 14 GiB",
  }),
  memory: Object.freeze({
    label: "Memory-optimised V1",
    available: false,
    note: "V1 only · unavailable for the V2 circuit",
    url: "./prover-memory.wasm",
    sha256: "fba4188d5a2f73d41534e8f7e2b6e312766ea9b8a2c0de098bf4d9f7accf4029",
    bytes: 94897180,
    peak_bytes: 1562659763,
    linear_bytes: 2251816960,
    prove_ms: 80415,
    need: "about 2.5 GiB",
  }),
});

// Device RAM cannot make a V1 circuit compatible with V2. Keep the recommendation
// on the supported circuit until a V2 memory profile has been validated.
export function recommendedBuild() {
  return "standard";
}

export async function runtimeBuildIdentity(key, fetchImpl = fetch) {
  if (!Object.hasOwn(PROVER_BUILDS, key) || !PROVER_BUILDS[key].available)
    throw Error("This prover build is not available for the V2 circuit");
  const response = await fetchImpl("./demo-data/prover-assets.json", { credentials: "omit", redirect: "error" });
  if (!response.ok) throw Error("V2 module manifest unavailable; run npm run demo:build");
  const manifest = await response.json();
  const identity = manifest.builds?.[key];
  if (manifest.backend_release !== BACKEND_RELEASE || manifest.proving_revision !== PROVING_REVISION ||
      !/^[a-f0-9]{64}$/.test(identity?.sha256 ?? "") || !Number.isSafeInteger(identity?.bytes) ||
      identity.bytes < 8 || identity.bytes > 128 * 1024 * 1024)
    throw Error("V2 module manifest does not match this prover profile");
  return identity;
}

export const gb = (n) => (n / 1e9).toFixed(2) + " GB";
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
    input.disabled = !b.available;
    input.onchange = () => {
      if (!b.available) return;
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
      b.note + (key === recommended ? " · Supported V2 build" : "");
    label.append(input, body);
    root.append(label);
  }
  onChange(selected, PROVER_BUILDS[selected]);
  return {
    get: () => selected,
    disable: (d) =>
      root.querySelectorAll("input").forEach((i) => (i.disabled = d || !PROVER_BUILDS[i.value].available)),
  };
}

// One-line summary of what this browser actually measured for a proof receipt.
export function measuredSummary(report, key) {
  const b = PROVER_BUILDS[key] ?? PROVER_BUILDS.standard;
  return `${b.label}: proved in ${s(report.prove_ms)} (reference ${s(b.prove_ms)}) · linear memory ${gb(report.wasm_linear_memory_bytes)} · Rust heap peak ${gb(report.rust_requested_peak_bytes)} · module ${report.wasm_sha256.slice(0, 8)}… verified`;
}
