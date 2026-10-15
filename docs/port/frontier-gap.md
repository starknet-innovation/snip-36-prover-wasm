# Why the memory profile is above the provably.fast frontier

The provably.fast memory season reported 1.13 GiB (frontier `66670df`, record
f2498dc7) and 1.04 GiB (record 666a7eba, not promoted, patch not public). Those are
Linux cgroup `memory.peak` (resident pages) with 16 threads on the evaluator's own
input. This port reports requested Rust heap in a single-threaded browser Worker on
the balance transaction. The figures are not comparable as published.

## Like-for-like measurement

[`native/peak_profile.rs`](../../native/peak_profile.rs) (requested heap,
`RAYON_NUM_THREADS=1`), balance PIE from `artifacts/port/corpus-01`:

| Build | Requested peak | Native time |
|---|---:|---:|
| Fork's unmodified upstream base (`starkware-libs/proving` `dd1787bc9`) | 14.21 GB | |
| This port's pinned baseline | 13.83 GB | |
| Fork's memory frontier `66670df` | **1.238 GB** | 62.9 s |
| This port after round 2 ([PR-09](PR-09-memory-round-2.md)) | **1.569 GB** | 65.3 s |

The two bases need about the same memory, so the 0.33 GB gap is mechanisms, not the
newer upstream. The fork's upstream is a different protocol version: the base and
frontier produce the same proof as each other, but the pristine 3035dd verifier
rejects it (`ValueOutOfRange`; 229,538 against 231,962 bytes). Mechanisms port;
code does not copy over unchanged.

To run the frontier with this profiler its `#[global_allocator]`
(`LargeBlockCache`, `crates/privacy_prove/src/lib.rs`) was commented out. Requested
sizes do not depend on the allocator; the cache only changes paging.

## Where the gap is

Live memory at the same two points in both builds, by the span that allocated each
block (profiler `SNAP` events):

| Live data | Port | Frontier | Gap |
|---|---:|---:|---:|
| Cairo base-trace write output (0.41 GB trace + lookup data), at the Cairo base commit | 0.952 GB | 0.510 GB | 0.44 GB |
| Circuit trees, at the start of the circuit `prove_ex` | 0.955 GB | 0.710 GB | 0.25 GB |
| Live at the start of the proof (estimate: circuit preprocessing) | 0.118 GB | 0.060 GB | 0.06 GB |

The frontier's commits add more on top than this port's (Cairo base commit +0.28
against +0.15 GB, circuit base commit +0.46 against +0.15 GB); it is lower only
because much less is already resident. Per phase (peak / live on entry, GB):

| Phase | Port | Frontier |
|---|---:|---:|
| Cairo base commit | 1.569 / 1.416 | 1.224 / 0.950 |
| Cairo interaction write | 1.513 / 1.437 | 1.048 / 0.965 |
| Circuit composition | 1.494 / 1.102 | 1.029 / 0.793 |
| Circuit base commit | 1.483 / 1.338 | 1.238 / 0.936 |

Removing only the Cairo gap would leave the circuit sites (about 1.48 GB) as the
peak; both are needed to reach about 1.24 GB.

## The mechanisms

1. **Cairo lookup tuple narrowing** (frontier `crates/prover/src/witness/prelude.rs`
   and about 40 component files). Tuples held from the trace write to the interaction
   trace are stored in the bits their values occupy and widened exactly at interaction
   time: XOR tuples `[relation, a, b, a^b]` become `a | b << 16` (4 words to 1), and
   `memory_id_to_big` tuples (28 limbs of 9 bits) become 11 words instead of 30.
   Estimated from the table above, assuming both builds hold the same 0.41 GB of
   base trace (103 M cells): Cairo lookup data about 0.54 GB here against about
   0.10 GB in the frontier. The fork's newer upstream may differ slightly in trace
   layout, so this split is an estimate, not a direct measurement.

   *Constraint:* the writers are AIR-generated (`// This file was created by the AIR
   team.`, 60 of 68 files in `stwo-cairo/.../witness/components/`), and the pinned
   stwo-cairo `CLAUDE.md` lists hand-editing them as Forbidden because regeneration
   from stwo-air-infra overwrites the edits. The fork's contestants edited them anyway.
   The compliant alternative is the generic read-back (an `EvalAtRow` over committed
   columns that recomputes the tuples; no generated file edited), which is a larger
   build. Declined: no hand edits of generated files; the read-back is the route.

2. **Packed circuit base-tree sources** (frontier `M11_PACK=2`, `M11_PACK_LEGS=1`;
   `PackedTrace` in `crates/stwo/src/prover/air/component_prover.rs`, `pack_column` in
   `pcs/mod.rs`). After the circuit base tree is committed, each column whose trace
   values fit in 16 bits drops its coefficients and keeps a `u8`/`u16` copy of them as
   a `TraceSource`. Prover-side stwo only. Readers must regrow packed columns; the
   fork avoids per-column regrowth by combining on the trace domain in the quotients
   (ported in `quotient-combine`), trace-domain barycentric weights for out-of-domain
   samples, and decommitment plans on the trace domain. Composition regrows once per
   component.

3. **Lazy circuit preprocessing**: built at first use rather than in the precomputes.
   The 0.06 GB difference in live memory at the start of the proof is attributed to
   it by inspection of the two flows, not by isolated measurement.

## Browser ceiling not covered by the frontier

WASM linear memory (2.22–2.25 GB) is about 0.65 GB above the requested peak and did
not fall with the last 0.17 GB of round 2. Natively the frontier returns pages to the
system (`munmap` in `LargeBlockCache`, `malloc_trim`); WASM linear memory never
shrinks, so allocator fragmentation becomes browser memory. Nothing in the fork
addresses this.

## Reproduction

```sh
git -C build/reference-proving worktree add ../ref-66670df 66670df77   # and ../ref-base dd1787bc9
cp native/peak_profile.rs build/ref-66670df/crates/privacy_prove/examples/
# frontier only: comment out the #[global_allocator] in crates/privacy_prove/src/lib.rs
cd build/ref-66670df && cargo +nightly-2026-01-15 build --release -p privacy-prove \
  --example peak_profile --target-dir ../target-ref-66670df
RAYON_NUM_THREADS=1 build/target-ref-66670df/release/examples/peak_profile \
  artifacts/port/corpus-01/balance.pie.zip OUT_DIR
```

Live-memory attribution used temporary `tracing::info!("SNAP ...")` events before
the Cairo base commit (`prover/src/prover.rs`) and at the start of `prove_ex`
(`stwo/src/prover/mod.rs`) in both trees; they are not part of any patch.
