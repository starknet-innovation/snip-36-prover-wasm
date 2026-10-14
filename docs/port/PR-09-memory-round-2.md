# Memory round 2: quotients, FRI layers, pool capacity and pass-wise commits

Four `prover-memory` layers, applied after `sparse-merkle.patch`. The tradeoff and
kernel profiles keep their validated sources (`tradeoffs.patch` conflicts with the
new quotient combine). No verifier, channel, `core/` or protocol code changes.
Sources and credit are in [mechanism-ledger.json](mechanism-ledger.json).

Measured with [peak_profile.rs](../../native/peak_profile.rs) on balance, native,
`RAYON_NUM_THREADS=1`. The profiler now also records time per span and, at `SNAP`
events, which span allocated each live block of at least 1 MiB.

| Layer | Global peak | What it removes |
|---|---:|---|
| (memory profile after PR-08) | 2.312 GB | |
| `quotient-combine` | 2.312 GB | circuit FRI quotients 2.232 → 2.062 GB |
| `striped-fri-layers` | 2.107 GB | circuit FRI commit 2.312 → 2.056 GB |
| `exact-pool` | 1.949 GB | circuit proof 2.062 → 1.495 GB; Cairo base commit 2.107 → 1.949 GB |
| `stripe-passes` | 1.740 GB | Cairo base commit 1.949 → 1.602 GB; circuit base commit 1.656 → 1.483 GB |

- `quotient-combine`: sourced or coefficient-only columns of one (size, point) are
  combined as `Σ cᵢ fᵢ` (on the trace domain, or in coefficients) and only its four
  coordinates are evaluated on stripe 0, instead of up to 16 regrown stripes. The
  combine step computes denominator inverses and domain points per block of 256
  packed rows and frees the per-point numerators before the extension.
- `striped-fri-layers`: packed FRI trees are hashed in aligned stripes of 2^14 leaves
  up to the first kept layer, so neither the packed copy of a layer nor its leaves
  are ever whole.
- `exact-pool`: `BaseColumnPool` reserved capacity for the next size on fresh
  buffers near the largest size. That capacity is requested memory, and WASM linear
  memory, for the buffer's lifetime: the stripe-0 buffers rebuilt before the
  quotients took 1.55 GB for 0.93 GB of values. Fresh buffers are now exact.
- `stripe-passes`: trees that keep their coefficients evaluate and absorb each
  stripe's blocks a pass of whole 16-column message chunks (about 32 MiB) at a
  time, in the original order; the Blake2s states persist between passes.

All four layers give the same proof bytes (balance proof SHA-256 prefix
`7c0f56a44dae2efb`, as for the PR-08 profile). Native time per span, minimum of
alternating runs against a reference built from the PR-08 sources: total 66.09 →
65.15 s; circuit FRI quotients 1.08 → 0.83 s; no span slower by more than 0.07 s.

The global peak is now the circuit witness write (1.740 GB), which is in
`circuit_prover`; that crate is marked soundness-critical and changing it needs
explicit approval. Next sites: Cairo base commit 1.602 GB, Cairo interaction
write 1.513 GB, circuit composition 1.494 GB.

Validation: 263 stwo tests with and without `parallel`, including new tests for
combined regrowth over coefficient and sourced columns, striped packed layers
(2^12 to 2^16 leaves, both hashers) and pass-wise layers (passes from one chunk to
all). A fresh `prover-memory` preparation reproduces the development tree exactly.

Browser ([validation-round2.json](validation-round2.json), module
`e7f78a8ff98f2c5dae2e40e50e0c87a5fe7181c7b87a5683e10529b1187cbe21`, one run per
workload): all three recursive proofs are byte-identical to the PR-08 proofs, pass
the pristine 3035dd verifier and reject proof and statement tampering. Requested
Rust peak 2.31 → 1.737 GB on every workload; WASM linear memory 3.25–3.36 →
2.22–2.25 GB. Single-run prove times (76–88 s) are not a paired measurement; the
paired campaign, human review, CI and release remain outstanding. The released
v0.2.0-memory module and `web/prover-builds.mjs` are unchanged.
