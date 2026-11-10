# Building from pinned source

The current profile adopts backend v1.4.0 / deps-v15. It uses sequencer `148de44521b49e32c5a675e287572768932cc99e` and the transaction-service `starkware-libs/proving` monorepo at `e0035ffc8e08da270b8cb4a71f3708af70c2c775`. The separately bundled proving-utils `0a97f45` is not this prover.

The V2 browser release `v0.2.0` is pending publication. Build both modules locally; CI and Pages build them through the reusable `build-wasm.yml` workflow. Existing V1 release modules cannot be mixed into this profile.

Requirements: Git, Rust/rustup, Python 3.11+ for preparation, Python 3.10 for Cairo tooling, and a Wasm-capable LLVM clang/llvm-ar. Keep rustup's Cargo ahead of standalone Cargo installations in PATH. Dependencies stay under `build/`. Budget substantial memory and disk space for the first build.

```sh
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar PYTHON310=python3.10 ./scripts/build.sh executor
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar ./scripts/build.sh prover
npm ci --ignore-scripts
npm run assets
npm test
npm run demo:build
npm run demo:test
npm run demo:test:live
npm run serve
```

Preparation verifies exact commits, the upstream virtual-OS program hash, the portability patches, the complete executor manifest mirror, and the committed locks. The prover comes from one monorepo; V1 low-memory patches are not applied. Browser changes provide an in-memory output-preimage sink, worker-local witness execution, the memory64 host ABI and target portability. Circuit constraints, blinding rows, preprocessed roots, bootloader, proof header and security parameters remain upstream V2 defaults.

The executor uses Cairo 2.19.6 with the native64 Sierra fallthrough encoding preserved on wasm32. Its Cairo 0 compiler remains the checksum-pinned compiler-only 0.14.3a3 variant; signing is disabled there. Python requirements are pinned in `patches/executor/python-requirements.txt`. Builds use nightly-2026-01-15 and wasm-bindgen 0.2.105 for the executor. Both targets need the Wasm C compiler for zstd.

Each source build writes its module hashes and source identity to `build/source-assets.json`. `npm run assets` verifies that receipt against current pins, both patch sets, the module bytes and generated executor bindings. A stale or incomplete receipt fails; rebuild both modules after changing pins or patches. With no source receipt, the downloader uses the committed release manifest, and refuses unpublished assets. Compiler/platform differences can change Wasm bytes, so source receipts are separate from release checksums.

To upgrade an existing prepared V1 checkout, preserve `build/sequencer` and `build/native-prover` elsewhere before rebuilding. Preparation refuses unexpected revisions or changed patch fingerprints and does not reset a developer's checkout. A fresh checkout can also be prepared separately with `python3 scripts/prepare-sources.py executor --build-dir build/check-v2` (or `prover` / `native`).

`patches/executor` mirrors every Cargo manifest in the browser dependency closure for Dependabot. CI checks manifests and resolves identical dependency identities, edges, features and target conditions with `--locked`. See the [resolver instructions](../patches/executor/README.md).

Optional native verification uses an unpatched V2 checkout and its upstream lock; only the CLI example is added:

```sh
./scripts/build.sh native
build/target-native/release/examples/spike_native verify proof.bin output_preimage.json artifacts/native-verification
```

The native example also supports `prove PIE OUTPUT_PREIMAGE_JSON OUTPUT_DIR`. Signing credentials are unnecessary for these builds; `build.sh` rejects `STARKNET_PRIVATE_KEY`.

The existing Sepolia CoinFlip bank requires the historical V1 statement. The updated contract source requires PROOF2 and the new virtual-OS hash, and exposes `get_proof_profile`. Deploy and configure a compatible bank before enabling deposits. Publishing assets or deploying contracts is separate from a local source build. Historical V1 receipts remain in `evidence/`.

V2 blinding is unchanged: upstream derives the recursive circuit blinding seed from the Cairo proof trace root. The retained Web Crypto host ABI was not invoked in the recorded V2 run (see its zero random-call counter); no alternative seed or blinding rule was introduced.
