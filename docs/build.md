# Building from pinned source

The current profile adopts backend v1.4.0 / deps-v15. It uses sequencer `148de44521b49e32c5a675e287572768932cc99e` and the transaction-service `starkware-libs/proving` monorepo at `e0035ffc8e08da270b8cb4a71f3708af70c2c775`. The separately bundled proving-utils `0a97f45` is not this prover.

The V2 browser release [`v1.0.0`](https://github.com/starknet-innovation/snip-36-prover-wasm/releases/tag/v1.0.0) supplies both verified Wasm modules. Run `npm ci --ignore-scripts && npm run assets` to download them using the committed checksums. The source instructions below rebuild the same pinned profile; CI and Pages use the reusable `build-wasm.yml` workflow. Existing V1 release modules cannot be mixed into this profile.

Requirements: Git, Rust/rustup, Python 3.11+ for preparation, Python 3.10 for Cairo tooling, and LLVM clang/llvm-ar 21 or newer for the memory64 indirect-call ABI. CI uses LLVM 23 from the signed official LLVM apt repository. Older Clang can produce a module that links successfully but fails WebAssembly validation; `build.sh` rejects it for the prover. Every CI artifact must compile, instantiate and initialize in Chromium before upload. Keep rustup's Cargo ahead of standalone Cargo installations in PATH. Dependencies stay under `build/`. Budget substantial memory and disk space for the first build.

```sh
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar PYTHON310=python3.10 ./scripts/build.sh executor
WASM_CC=/path/to/clang WASM_AR=/path/to/llvm-ar ./scripts/build.sh prover
npm ci --ignore-scripts
npm run assets
npm test
npm run demo:build
npm run demo:test
npm run demo:test:live
node scripts/prover-smoke.mjs
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

The default Sepolia CoinFlip configuration points to the deployed V2 bank. It requires PROOF2 and the new virtual-OS hash and exposes `get_proof_profile`; the frontend verifies that profile on-chain. The original V1 bank remains in `web/legacy-live-config.json` and the `play.html?bank=v1` recovery view. Publishing assets does not migrate bank state. Deployment and accepted V2 settlement evidence are in `evidence/v2-bank-deployment.json`; historical V1 receipts remain separate.

V2 blinding is unchanged: upstream derives the recursive circuit blinding seed from the Cairo proof trace root. The retained Web Crypto host ABI was not invoked in the recorded V2 run (see its zero random-call counter); no alternative seed or blinding rule was introduced.

## Integration with the current UI and V1 research

The latest wallet connection/network-switch behavior, stake validation, saved-round loading, settlement waits/timeouts, receipt module hashes, live memory stages, and cache-versioned frontend remain enabled. The build picker retains both cards; its V1 memory card is disabled because that module cannot prove the V2 circuit. Device RAM never selects the incompatible module. V2 measurements label the supported standard card; old memory-card measurements remain explicitly V1 history.

Source builds preserve path remapping and content-addressed modules under `build/wasm/`. `prover-baseline` builds the supported V2 control without installing it; `--install` explicitly installs it. V1 memory/tradeoff/kernel modes fail before compilation or installation. Their patches, research notes and results remain historical artifacts. Porting those optimisations to V2 requires separate validation.

Preparation receipts check the complete prepared source trees as well as patch identities. Native preparation rejects implementation edits outside the committed diagnostic example. CI checks that both browser and native cryptographic packages resolve from the exact V2 monorepo revision with matching package versions.

`demo:build` generates a runtime module manifest from the verified source-build receipt. Every browser proof hashes the loaded bytes against that manifest, allowing platform-specific source builds while retaining module provenance. A legacy or mismatched runtime profile fails closed.
