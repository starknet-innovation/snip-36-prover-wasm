# Browser memory port validation

Starting revision: `739b084d1f533e60cd38cf9a0a6391de7965aafd` (matches the handoff).
Local branch: `port/memory-candidate-validation`. `pins.json` remains authoritative.
No release manifest or released asset has been promoted by this work.

## Controls and identities

`prover-baseline` prepares the original three upstream checkouts and original
browser portability patches under `build/baseline`; it does not apply circuit
or candidate workspace patches. `prover` prepares `build/stwo-circuits` at the
existing pin and installs workspace-root overrides for the seven circuit
packages in the actual dependency closure. `native` retains the separate
unmodified transaction-service 3035dd Git dependency graph.

```sh
npm ci --ignore-scripts --cache build/npm-cache
npm run assets                         # Do this before any candidate installation.
node scripts/build-demo.mjs            # Does not invoke the released-asset downloader.
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar ./scripts/build.sh prover-baseline
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar ./scripts/build.sh prover
./scripts/build.sh native
```

Source preparation records a fingerprint of pins, patches, lock and prepared
files, including untracked implementation files. It rejects changed patches
or edited prepared trees. Move stale prepared checkouts aside and prepare fresh
ones after changing patches; do not edit Cargo's cached Git checkouts. Native
preparation adds only the example and the retained native lock.

Every successful prover build retains a module under `build/wasm/SHA256.wasm`.
The baseline build does not install over `web/sequencer-prover.wasm`. Candidate
builds still install there for ordinary browser use. `npm run demo:build` can
replace that installation; use `node scripts/build-demo.mjs` for candidate work.
The offline harness serves an immutable in-memory copy of the explicitly
selected module, hashes it before launch, and requires the Worker to hash the
same bytes before instantiation. A module identity mismatch fails before init.
Ordinary proof receipts now also include `wasm_sha256` and `wasm_bytes`.

Capture metadata and features using the same target and command on each side:

```sh
cargo +nightly-2026-01-15 metadata --locked --format-version 1 \
  --manifest-path build/proving-utils/Cargo.toml --filter-platform wasm64-unknown-unknown > candidate-metadata.json
cargo +nightly-2026-01-15 tree --locked --manifest-path build/proving-utils/Cargo.toml \
  --target wasm64-unknown-unknown -p snip36-browser-prover -e features > candidate-features.txt
python3 scripts/check-prover-resolution.py BASELINE_METADATA CANDIDATE_METADATA NATIVE_METADATA
python3 scripts/prover-identity.py --wasm MODULE --metadata METADATA --output NEW_IDENTITY_JSON
```

The graph check compares versions, edges, dependency target conditions and
resolved features. It checks that each required patched package resolves to
its prepared local directory and that the native verifier retains pinned Git
sources. The baseline graph has `parallel` enabled and does not enable
`release-unused-buffers`; `--no-default-features` does not change that finding.

## Offline recursive proving

The committed recordings retain expected public executor outputs, authenticated
captures and expected PIE hashes, but not PIE bytes. Preparation executes each
capture in a real executor Worker, prohibits external networking, requires
both expected output and expected PIE digest, and retains the resulting PIE.
`corpus.json` records the trusted fixture hashes and independently derived
single-task privacy bootloader statement: `[1, output.length + 2, program_hash,
...recorded_output]`. The CoinFlip heads statement agrees with the separately
committed native-verified evidence. Candidate output is never used to define
the expected-output file supplied to the native verifier.

```sh
node scripts/offline-proof.mjs prepare artifacts/port/corpus-NEW
node scripts/offline-proof.mjs prove artifacts/port/corpus-NEW \
  build/wasm/SHA256.wasm SHA256 \
  build/target-native/release/examples/spike_native artifacts/port/proof-NEW
```

Use a fresh output directory for every attempt. The harness retains raw proof,
receipt, verifier stdout/stderr, stage records and failure status. It checks
module, PIE, proof and statement identities, verifies with the unchanged native
verifier, and requires rejection of a changed proof and changed statement for
every workload. No fixed production seed is introduced. Byte comparison is an
additional observed differential invariant; verification against the trusted
statement remains required even when proofs are identical.

`PROVER_SHA256=SHA256 RUN_DIR=PREPARED_RUN npm run e2e:browser` also enforces the
candidate hash before and during the existing full execution/proving test.
`demo:test` and `demo:test:live` remain execution/UI checks.

## Measurements and scope

`benchmark-plan.json` preregisters paired measurements, stability and acceptance
thresholds. A single corpus traversal is a correctness smoke run, not evidence
of performance improvement. `load_ms` includes fetch, hash, compilation and
instantiation; `init_ms` and `prove_ms` surround their respective ABI calls.
`fresh_worker_ms` surrounds Worker creation through receipt in the browser;
`harness_call_ms` also includes Playwright transport. Rust requested peaks are
cumulative per instance. Linear memory does not shrink on free. Browser process
memory is sampled every 500 ms as summed Chromium-family RSS. Shared pages may
be counted more than once and transient peaks can be missed. This is not a hard
peak or private memory. No separate per-phase peak claim is supported. A larger
independently expected input remains unavailable. Repeated-instance retention
is checked separately by `scripts/prover-lifecycle.mjs`.

The source base and reference trees were fetched by exact commit. The source
preprocessing/finalization APIs differ materially from this target. Porting must
keep target `add_zk_blinding` followed by `finalize_context`, without copying
source `pad_context` or security-season constants. `source-ledger.json` retains
exact source messages, jobs, patch digests and human/model credit; reference
inspection does not mean implementation or validation. Models are execution
provenance, not authors. Participant-first upstreaming remains required before
upstream publication; no upstream PR or deployment was sent.

