> Historical validation commands below used `prover` for the candidate before
> the profile became optional. Current candidate builds use `prover-memory`
> and sources under `build/memory`; `prover` now selects the unchanged baseline.
> Current reproduction instructions are in [README.md](README.md).

# Validation evidence and reproduction

Starting SHA was `739b084d1f533e60cd38cf9a0a6391de7965aafd`, exactly the handoff.
Work started on local branch `port/memory-candidate-validation`; the focused
review stack was assembled separately. Pins, security/protocol configuration,
release assets and checksums remain unchanged.

The [raw archive](https://github.com/starknet-innovation/snip-36-prover-wasm/releases/download/evidence-2026-10/raw-evidence.tar.gz) (release `evidence-2026-10`, SHA-256
`9c7c4c3d14b297657e60d0b29e23f8c07495ae460a59eb622e6f03f5ca3a5f93`) retains 4,040 identity, metadata,
registration, attempt, stage, RSS, native verification, boundary-test, CI and
build/test log files, plus the three unique final proof binaries. Its
[file index and SHA256](https://github.com/starknet-innovation/snip-36-prover-wasm/releases/download/evidence-2026-10/raw-evidence.tar.gz.json) checks every member.
All three archives (raw, review-fixes, optional-memory), their indexes and
`SHA256SUMS` are assets of the
[`evidence-2026-10` release](https://github.com/starknet-innovation/snip-36-prover-wasm/releases/tag/evidence-2026-10),
kept out of git history.
Large WASM modules, regenerated PIE fixtures and 1,605 boundary mutation binaries
remain under ignored `build/` / `artifacts/port/`; they were not published as
release assets. The source/module identities and journals record their hashes.
The public fixture outputs and pinned program hash independently determine the
expected statement; candidate output is never the expected-output authority.

Local home-directory paths in archived files are replaced with `$HOME`. Each
index entry's `sha256` is the archived (replaced) content; `original_sha256`
is the digest before replacement, which is what hashes embedded in other
evidence files (for example registration identity records) refer to.

The campaign's registration records the harness file hashes and repository head
it ran with. Review fixes made afterwards to harness scripts (default WASM
loading, rejection-reason checks, identity binding) are not part of that run;
they change no prover module, so module identities and proof bytes stand.

Frontier currency: the ledger covers fork sources up to `7796488` (record
573d8ca1), but that record's mechanisms (adaptive blocks, chunked inversion) are
in the tradeoffs profile, not the memory profile. The final memory-season
frontier `66670df` (record f2498dc7) was profiled for the follow-up sparse
Merkle PR (PR-08-sparse-merkle.md); its headline change did not lower the
browser peak and was not kept.

[Paired results](benchmark-results.md) apply the preregistered gates. All 36
attempts pass and all workloads are stable. Requested Rust peaks are about 64.5%
lower and linear memory about 58% lower, while proving is 40–50% slower. The time
gate fails, so there is no promotion under this plan. D/E have independent
correctness smoke evidence but no stable isolated-gain claim.

## Exact commands

The actual LLVM tools were `/opt/homebrew/Cellar/llvm@21/21.1.8/bin/clang` and
`/opt/homebrew/Cellar/llvm@21/21.1.8/bin/llvm-ar`.

```sh
npm ci --ignore-scripts --cache build/npm-cache
node scripts/build-demo.mjs
WASM_CC=/opt/homebrew/Cellar/llvm@21/21.1.8/bin/clang \
WASM_AR=/opt/homebrew/Cellar/llvm@21/21.1.8/bin/llvm-ar ./scripts/build.sh prover
./scripts/build.sh native
# Optional profiles use the same WASM_CC/WASM_AR with prover-tradeoffs/prover-kernels.
node scripts/offline-proof.mjs prepare artifacts/port/corpus-NEW
node scripts/offline-proof.mjs prove artifacts/port/corpus-01 \
  build/wasm/41a6f536d5d24ba7bb8ccb416d937e87f2a90abb88b43a644c67a4d65ad39db6.wasm \
  41a6f536d5d24ba7bb8ccb416d937e87f2a90abb88b43a644c67a4d65ad39db6 \
  build/target-native/release/examples/spike_native artifacts/port/proof-NEW
BENCH_IDENTITY_FILES=artifacts/port/baseline/identity.json:artifacts/port/sourced/identity-06.json \
node scripts/prover-benchmark.mjs artifacts/port/corpus-01 \
  artifacts/port/baseline/prover.wasm dc87c868e66f4ba4aa331a010076f6cd6fe9ab8e02a13354d9eda7a208b4b184 \
  build/wasm/41a6f536d5d24ba7bb8ccb416d937e87f2a90abb88b43a644c67a4d65ad39db6.wasm \
  41a6f536d5d24ba7bb8ccb416d937e87f2a90abb88b43a644c67a4d65ad39db6 \
  build/target-native/release/examples/spike_native artifacts/port/benchmark-NEW
npm test
python3 -m unittest discover -s tests -p 'test_executor_manifests.py'
python3 -m unittest discover -s tests -p 'test_prover*.py'
node scripts/worker-security-test.mjs
npm run demo:test
npm run demo:test:live
PROVER_SHA256=41a6f536d5d24ba7bb8ccb416d937e87f2a90abb88b43a644c67a4d65ad39db6 \
RUN_DIR=artifacts/port/browser-e2e-final npm run e2e:browser
```

The full-browser run prepared `browser-input.json` from the committed balance
request and `source: {capture: fixture.capture}` before execution. It passed
actual execution/proving, identical offline replay and invalid-signature
rejection; the saved proof was separately verified using
`spike_native verify proof.bin artifacts/port/corpus-01/balance.expected.json OUT`.
Use a new RUN_DIR when repeating. The demo suites alone are not recursive tests.

[Structured boundary commands and results](proof-boundaries.md) record 535cases
per workload: one accepted positive, 530 canonical mutations and 4 encoding
negatives. All 1,602 negatives reject without panics/signals. The test helper is
bound to the recorded unchanged native artifact SHA; another platform must
register its independently built verifier identity before adapting that
artifact-specific assertion. This is a validation helper, not production code.

Native C checks passed 259 Stwo / 19 framework / 9 doc tests with parallel and
259/17/9 serial. D passed 259/20/9 parallel and 259/18/9 serial after a clean package
rerun. Scoped corrected E tests passed 257; new bound tests and independent math
review cover its arithmetic correction, and the final C+E WASM passed all three
actual proofs. Native test logs and precise commands are in the archive. Final
Node checks passed 65 tests; Python checks passed 8 + 2. Worker/security/demo checks
passed. All final C/D/E proofs match baseline bytes and unchanged native
verification. [Lifecycle](validation-lifecycle-final.json) and
[cancellation](validation-cancellation-final.json) retain actual Worker results.

## Evidence limits and failed attempts

The initial source-profile attempts failed on two empty-storage cases; their
panic/stage journals remain retained, and full PCS regression coverage was
added. Earlier no-parallel/test-compilation failures and the original misleading
fallback test are retained with the corrective review. The first benchmark was
stopped after its warmup pair when independent review required corrections;
its original journal, recovered child receipts and interruption reason remain.
No ratios are reported for it. The D serial shared-target run initially reused
C's test executable; its 17-test log is explicitly superseded by the confirmed
clean 18-test rerun. Independent [review reports](reviews/stripes-sources.md)
retain initial findings and corrective assessments.

An early native rustup-install race was recorded in the conversation but its
first raw build log was overwritten by a retry; it cannot be presented as a
complete retained raw log. The later shell `tall` failure and successful native
retry are retained. These source-build incidents are separate from the complete
paired campaign; all 36 declared benchmark attempts are retained.

This is one ARM64 macOS/Chromium host and three trusted executions. No larger
independently expected Sepolia corpus was available. Two-proof retention is not
long-run stability; an earlier instance grew linear memory by 67 MB. Malformed
PIE errors occur before ownership transfer; a WASM abort requires Worker
termination. The native verifier parses but does not validate version values;
tests preserve the original header. Requested allocation and sampled RSS limits
are documented in the result report. No fixed production seed was introduced.

Existing CI checks and the new pinned dependency-resolution job pass on all seven
draft PRs ([captured checks](ci-checks.json)). That is not candidate recursive-proof CI. Source/unit/
recursive/benchmark results here are local, independently agent-reviewed
validation, with human final review and live Sepolia acceptance outstanding.
No upstream-source PR, signing, transaction broadcast or asset release occurred.

## Draft review stack

- [Establish exact candidate identities and offline recursive-proof validation](https://github.com/starknet-innovation/snip-36-prover-wasm/pull/3) — `539a1aad246fb4e8dac73eaae1a301554dcccd8f`; base `main`.
- [Reduce circuit witness and preprocessing residency with explicit ownership](https://github.com/starknet-innovation/snip-36-prover-wasm/pull/4) — `fd11c849b040b9db38b542dd36d95ca3a593c3c0`; base `port/memory-01-validation`.
- [Port striped commitments and block composition with differential coverage](https://github.com/starknet-innovation/snip-36-prover-wasm/pull/5) — `4cf5cbab2ae17449118220b3a7436f98512bb0a5`; base `port/memory-02-lifetimes`.
- [Regenerate preprocessed columns from compact trace sources](https://github.com/starknet-innovation/snip-36-prover-wasm/pull/6) — `34688f326ebf9b262b54407aba4707336fa592ea`; base `port/memory-03-stripes`.
- [Isolate adaptive block and chunked denominator memory tradeoffs](https://github.com/starknet-innovation/snip-36-prover-wasm/pull/7) — `ed4b98c290138530d2309702b1aad8235bb8625c`; base `port/memory-04-sources`.
- [Isolate bounded portable BLAKE2s IFFT and quotient kernel experiments](https://github.com/starknet-innovation/snip-36-prover-wasm/pull/8) — `dcba9590182144a9759af401d2d2bd48dd2ce05d`; base `port/memory-05-tradeoffs`.

- [Final measured tradeoff and raw evidence](https://github.com/starknet-innovation/snip-36-prover-wasm/pull/9) — evidence PR based on `port/memory-06-kernels`.
