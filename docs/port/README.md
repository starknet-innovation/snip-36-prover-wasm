# Browser memory port validation

Starting revision: `739b084d1f533e60cd38cf9a0a6391de7965aafd` (matches the handoff).
Local branch: `port/memory-candidate-validation`. `pins.json` remains authoritative.
No release manifest or released asset has been promoted by this work.

## Controls and identities

`prover` is the unchanged default source build. It shares `build/baseline` with
`prover-baseline`, uses only the original three upstream checkouts and original
browser portability patches, and installs the resulting module locally.

`prover-memory` opts into the memory-saving lifetime, striped proving and sourced
preprocessing patches under `build/memory`, including the pinned circuit checkout
and seven circuit-package workspace overrides. It retains a separate module;
`--install` explicitly selects it for local browser use. `prover-tradeoffs` and
`prover-kernels` add their respective experiments to this memory profile and also
require `--install` to replace the local module. `native` keeps the independent
unchanged transaction-service 3035dd dependency graph.

The memory profile reduced requested Rust peak allocations by about 64.5% but
increased proving time by roughly 40–50% in the paired measurements. It failed
the time acceptance gate and is optional. These are build choices; there is no
browser UI selector or automatic profile switching.

```sh
npm ci --ignore-scripts --cache build/npm-cache
npm run assets                         # Do this before any candidate installation.
node scripts/build-demo.mjs            # Does not invoke the released-asset downloader.
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar ./scripts/build.sh prover
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar ./scripts/build.sh prover-memory
./scripts/build.sh native
```

Source preparation records a fingerprint of pins, patches, lock and prepared
files, including untracked implementation files. It rejects changed patches
or edited prepared trees. Without a receipt, preparation requires pristine pinned
checkouts; legacy patched or dirty trees must be moved aside and prepared fresh. Move stale prepared checkouts aside and prepare fresh
ones after changing patches; do not edit Cargo's cached Git checkouts. Native
preparation adds only the example and the retained native lock.

Every successful prover build retains a module under `build/wasm/SHA256.wasm`.
Only `prover` installs over `web/sequencer-prover.wasm` by default. The baseline
control and optional profiles retain separate modules; pass `--install` to choose
one explicitly. `npm run demo:build` can
replace that installation; use `node scripts/build-demo.mjs` for candidate work.
The offline harness serves an immutable in-memory copy of the explicitly
selected module, hashes it before launch, and requires the Worker to hash the
same bytes before instantiation. A module identity mismatch fails before init.
Ordinary proof receipts now also include `wasm_sha256` and `wasm_bytes`.

Capture metadata and features using the same target and command on each side:

```sh
cargo +nightly-2026-01-15 metadata --locked --format-version 1 --no-default-features \
  --manifest-path build/memory/proving-utils/Cargo.toml --filter-platform wasm64-unknown-unknown > candidate-metadata.json
cargo +nightly-2026-01-15 tree --locked --manifest-path build/memory/proving-utils/Cargo.toml \
  --target wasm64-unknown-unknown -p snip36-browser-prover --no-default-features -e features > candidate-features.txt
python3 scripts/check-prover-resolution.py BASELINE_METADATA CANDIDATE_METADATA NATIVE_METADATA
python3 scripts/prover-identity.py --source-root build/memory --wasm MODULE --metadata METADATA --output NEW_IDENTITY_JSON
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

