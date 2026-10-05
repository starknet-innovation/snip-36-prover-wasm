# Building from pinned source

`npm run assets` is the fast path: it downloads the two released Wasm modules and checks the size and SHA256 against the committed manifest. JavaScript bindings are committed. The initial release contains the actual modules used in the successful browser/Sepolia test; native machine binaries and private account files are not distributed.

Source builds require Git, Rust/rustup, Python3.10 for Cairo tooling, and a Wasm-capable LLVM clang/llvm-ar. Budget substantial disk space and memory; only the first source build is expensive. Dependencies stay under `build/`. Python packages are pinned in `patches/executor/python-requirements.txt`. The build uses nightly-2026-01-15 and wasm-bindgen0.2.105 for the executor.

```sh
# Compiler paths depend on your LLVM installation.
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar ./scripts/build.sh prover
PYTHON310=python3.10 ./scripts/build.sh executor
./scripts/build.sh native
```

The source-preparation script verifies exact upstream commits before applying patches. Executor layers: sequencer, program compression, public test fixture, partial state cache, execution capacity, public-state execution/compiler/authentication. The portable Cairo compiler archive is extracted before the final layer. Preparation checks the SHA256 of the original patched lock before installing the reviewed `patches/executor/Cargo.lock` security updates. Use a fresh `build/sequencer` after changing patches or the lock. Native proving/verifying at revision `3035dd` uses upstream code and its pinned lockfile; the only added file is the CLI example.

Do not pass signing credentials to source builds. `scripts/build.sh` rejects `STARKNET_PRIVATE_KEY`. See [security alert tracking](security-alerts.md) for the remaining upstream dependencies and the distinction between source fixes and released binaries.

To verify a browser proof natively, export its bytes as `proof.bin` and its `output_preimage` as JSON, then run:

```sh
build/target-native/release/examples/spike_native verify proof.bin output_preimage.json artifacts/native-verification
```

The native example can also generate an independent control from a browser PIE with `prove PIE OUTPUT_PREIMAGE_JSON OUTPUT_DIR`. It is not part of browser execution/proving. Browser generation plus the unchanged native verifier was tested locally; the daily workflow uses real network proof verification to avoid rebuilding the large native dependency graph on every run.

Compiler/platform differences can change Wasm binary bytes without changing proof semantics. Source-built artifacts must be tested before changing `assets.json` or a release; do not automatically rewrite expected checksums to accept an unexplained mismatch. The initial asset hashes refer to the tested macOS cross-compiled modules, not a claim of bit-identical builds on every host.
