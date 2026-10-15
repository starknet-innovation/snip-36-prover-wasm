# Memory round 2: quotients, FRI layers, pool capacity, pass-wise commits and circuit witness

Five `prover-memory` layers, applied after `sparse-merkle.patch`. The tradeoff and
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
| `stripe-passes` | 1.740 GB | Cairo base commit 1.949 → 1.569 GB; circuit base commit 1.656 → 1.483 GB |
| `circuit-witness` | 1.569 GB | circuit witness write 1.740 → about 1.48 GB; circuit interaction write 1.672 → 1.471 GB |

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
  time, in the original order; the Blake2s states persist between passes, and the
  dead state buffer is freed before the leaves are written.
- `circuit-witness` (stwo-circuits `circuit_prover`, witness code only, approved by
  the user; no constraints or generated files): qm31_ops and eq finish in their own
  scope before the gate components (a single-threaded Worker otherwise ran them last,
  beside every gate's trace and lookup data); blake_g_gate adds its XOR sub-component
  inputs to the atomic claim generators per row instead of collecting 48 words per
  row, and its interaction writer frees each lookup field after its last column.

All five layers give the same proof bytes (balance proof SHA-256 prefix
`7c0f56a44dae2efb`, as for the PR-08 profile). Native time per span, minimum of
alternating runs against a reference built from the PR-08 sources: total 66.17 →
65.29 s; circuit FRI quotients 1.08 → 0.83 s; no phase measurably slower.

The native peak is now the Cairo base commit (1.569 GB; the gap to the fork frontier, 1.238 GB on the same workload, is analysed in [frontier-gap.md](frontier-gap.md)), then the Cairo interaction
write (1.513 GB), circuit composition (1.494 GB) and circuit base commit (1.483 GB).
The Cairo sites hold lookup data from the AIR-generated witness writers, which
stwo-cairo forbids editing by hand; the generic read-back recorded in the ledger is
the admissible route.

Validation: 263 stwo tests with and without `parallel` (new tests for combined
regrowth over coefficient and sourced columns, striped packed layers from 2^12 to
2^16 leaves with both hashers, and pass-wise layers from one chunk to all passes);
12 circuit-prover tests, including the lookup-sum prove tests; 68 JavaScript tests,
Python prover and executor-manifest checks. A fresh `prover-memory` preparation
reproduces the development tree exactly.

Browser ([validation-round2.json](validation-round2.json), module
`4ebd702b3f7522c0d0f467325ed8f073c230349bfa9f2c7edc361504ce7705e6`, one run per
workload, no build-machine paths in the module): all three recursive proofs are
byte-identical to the PR-08 proofs, pass the pristine 3035dd verifier and reject
proof and statement tampering. Requested Rust peak 2.31 → 1.563–1.569 GB; WASM
linear memory 3.25–3.36 → 2.22–2.25 GB. The last layer lowered the requested peak by
0.17 GB but not linear memory, which the allocator's high-water mark sets.
Single-run prove times (76–90 s) are not a paired measurement; the paired campaign,
human review, CI and release remain outstanding. The released v0.2.0-memory module
and `web/prover-builds.mjs` are unchanged.

Paired campaign ([benchmark-round2-01.json](benchmark-round2-01.json), plan
`benchmark-plan.json`, baseline the released v0.2.0-memory module `33fc1717…`,
candidate `4ebd702b…`; 36/36 attempts passed, each natively verified with tamper
rejection):

| Workload | Prove time ratio | Rust requested peak | Linear memory |
|---|---:|---:|---:|
| balance | 0.997 | 2.31 → 1.57 GB (0.679) | 3.25 → 2.25 GB (0.692) |
| coinflip-heads | unstable | 2.31 → 1.56 GB | 3.35 → 2.25 GB |
| coinflip-tails | unstable | 2.31 → 1.56 GB | 3.32 → 2.22 GB |

Balance passes every preregistered gate (time CV 0.25%/0.69%). Both CoinFlip
workloads failed the 5% time-CV gate on both roles: from about 10:07 UTC both
modules slowed by up to 20% with background host load, so the plan reports no
ratios for them; their memory medians are listed for reference only.
