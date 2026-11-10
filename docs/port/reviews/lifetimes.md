# Independent agent review: lifetimes and compact circuit preprocessing

Reviewed on 2026-10-13 by a delegated Codex Math Reviewer agent. This is an
independent agent assessment, not human cryptographic approval or CI evidence.
The checkout HEAD during review was `5a311a9b0e9cd984fd3c2e1a4e6ecacefc0e218c`.
No proof-system changes or expensive validation runs were performed by this reviewer.

Scope: `stwo-circuits.patch`, `lifetimes.patch`, `sourced-circuits.patch`,
`sourced-utils.patch`, their applied candidate sources, and independent public
statement construction in the offline harness. Stwo striped polynomial,
quotient and Merkle implementations need their separate review.

Patch SHA-256 identities inspected:

| Patch | SHA-256 |
| --- | --- |
| stwo-circuits.patch | b1260af1c1c5c1c94363c011a1e9ccb00b25a000ec6fcd727d372d68c8d22571 |
| lifetimes.patch | 1a0a16579f3768389c255f54588e302efaee568e3560c07b2d1990e14c5fcab9 |
| sourced-circuits.patch | 68380df366f69f72d4a78b357a360e82b3c6d0589e71a20d15b4d40ef6ab6033 |
| sourced-utils.patch | 94a4cf2470734d39bc7440377ff03b260aa928346c244ec3daf534dfa253dae8 |

The required upstream `build/stwo-circuits/AGENTS.md` and Stwo skills
`soundness-review-checklist`, `air-constraint-engineering`, and
`paper-implementation-divergence-log` were read, along with canonical paper
indices and relevant distilled sections. Mathematical anchors are Stwo
`def:flat:AIR`, `def:flat:AIR:solution`, `e:flat:AIR:consistency`,
`prot:STARK:IOPP`, `s:cross:domain:merkle`, `alg:merkle`, and Circle STARKs
`thm:FFT` and the warning at `s:STARK:optimized` that changing ZK assumptions is
not a storage optimization. The existing divergence log was not silently
resolved. No new paper-implementation divergence was identified in this scope.

## Assessment

No concrete semantic regression was found in the inspected lifetime and compact
representation changes. The following equivalences support that conclusion:

- In `build/proving-utils/crates/privacy_prove/src/lib.rs:198`, Cairo proof
  conversion completes while the original proof is live; line 204 copies the
  same commitment seed before dropping that proof. The production sequence at
  lines 219–228 remains circuit validity check, `add_zk_blinding` with the target
  query count, `finalize_context`, then value extraction. The seed source and
  target blinding code were not replaced. Circuit-only preparation is deferred
  in allocation time; its configuration and NoValue circuit construction remain
  unchanged. `privacy_circuit_verify/src/lib.rs:231` still adds the same number
  of structural blinding rows before preprocessing. The existing zero stub seed
  there belongs to NoValue structural construction, not a newly introduced
  production witness seed.
- `build/stwo-circuits/crates/circuits/src/context.rs:273` moves the exact values
  vector out of the context. Rust drops the remaining circuit/gate/metadata
  fields through ordinary ownership. There is no cross-proof global transfer
  slot, forgotten vector, or `ManuallyDrop` in these patches. In
  `circuit_prover/src/prover.rs:210`, `write_trace` completes before the owned
  vector is dropped at line 220. Its returned interaction generator has no
  borrowed-value lifetime and owns its lookup data. The original Rayon scopes
  join before returning; `witness/trace.rs:265` also copies public outputs before
  that return. Commit/mix/challenge ordering remains unchanged.
- `circuit_common/src/preprocessed.rs:401` maintains a lossless sequence invariant
  by induction on each append. Bits contain only literal 0/1 values. The first
  larger value expands that exact prefix to u32; a value failing checked u32
  conversion expands to usize before append. Therefore no high address bits are
  truncated. The native 64-bit and WASM64 targets can represent every stored u32
  in usize. Formula columns are private and created with fixed log sizes at most
  20, so their shifts cannot overflow either supported target.
- The old XOR generator enumerates row `r` as RHS `r >> n`, LHS
  `r & (2^n - 1)`, result their XOR. The formulas at
  `preprocessed.rs:390` are exactly those values and preserve `2^(2n)` lengths,
  insertion order and IDs. `sort_by_size` still performs the same stable sort.
  Gate multiplicities and padding logic are not changed by this representation.
  `get_packed_column` preserves the old `chunks_exact` behavior and lane order;
  both discard a remainder, though valid finalized columns have the required
  padded lengths.
- `PreprocessedColumnSource::all` at `preprocessed.rs:556` enumerates that same
  sorted map by index and holds an immutable Arc. `write_values` enforces exact
  destination length and applies the same BaseField conversion to the same row
  values as `get_trace`. It must not apply a second bit reversal: the original
  trace itself labels that sequence `BitReversedOrder`. Equal trace-domain
  values on the same domain imply equal interpolated polynomials by FFT
  uniqueness; unchanged commitment/opening machinery must therefore see the
  same leaves. The latter machinery's regrowth checks belong to the separate
  Stwo review.
- `browser-prover/src/wasm64_api.rs:56` reuses one initialized precompute per
  instance. Lines 68–69 drop old proof/output buffers before parsing the next
  input, so a recoverable parse error cannot leave the prior proof exposed as
  the result of the new call. Ordinary Result propagation drops per-call owned
  values and trees. No new unsafe block was introduced in these four patches;
  existing ABI unsafe contracts and documented scoped witness initialization
  are outside the changed storage operations.

## Evidence and limitations

Tests specifically cover boolean word boundaries, u32 maximum/wider fallback,
all production fixed-XOR widths, value identity after blinding and padding,
source/generated equality, and owned/borrowed sequential proof commitments.
The owned-values negative test catches an empty-vector native panic and then
verifies later valid calls. These tests exist in the reviewed source; this
reviewer did not rerun their compilation.

Existing `docs/port/validation-sourced.json` records three recursive browser
proofs for module `57c1f6707b1e2efe61b42a0080350fdfb7e92a01fc7492e82ba52006776bf7ad`,
matching baseline bytes, verified with the unchanged native verifier, and
rejecting changed proof and statement. These are finite corpus checks, not a
general soundness proof. `artifacts/port/lifecycle-sourced-03/result.json` records
the later module `784ad8069b9f47086cbc0898cf1a45388069187a136de7b4932bc621a2ca04fe`:
repeat initialization retained identical requested live bytes, two proofs
retained identical requested live bytes, and malformed ZIP recovery passed.
Linear memory still grew between proofs; stable requested live bytes do not
establish zero fragmentation or indefinitely bounded repeated-proof memory.
Earlier failed lifecycle attempts remain recorded.

The offline expected statement is independent of candidate output:
`scripts/offline-fixtures.mjs:9` derives it from committed executor output plus
the pinned single-task bootloader header. `scripts/offline-proof.mjs:99` checks
fixture/corpus identity, retained PIE hash and expected-file values before the
candidate call, then supplies that expected file to native verification at
line 114. A compromised committed fixture or program pin remains outside that
trust boundary. Three fixtures do not cover all transaction shapes.

Two coverage limitations remain explicit:

1. Browser malformed-ZIP failure occurs before circuit ownership transfer.
   Native catch-unwind tests exercise a failure after transfer, but do not prove
   recovery of a WASM instance after a proving-stage trap. An aborting instance
   needs Worker termination; no post-trap reuse guarantee should be claimed.
2. `into_values` documentation describes finalized/blinded/padded use, but the
   type itself does not enforce that callers performed padding and blinding.
   The production call was checked and has the correct sequence. Future callers
   need the same discipline. The source equality unit test uses a small circuit;
   full workload evidence supplies nontrivial gate coverage but does not exhaust
   maximum widths, multiplicities, or all error locations.

This assessment supports further local validation of these scoped changes.
It does not authorize release, substitute for the upstream workflow's human
approval, or assert a browser performance gain.
