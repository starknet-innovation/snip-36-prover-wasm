# Security alert assessment (2026-10-05)

This review covers the 40 open [Dependabot alerts](https://github.com/starknet-innovation/snip-36-prover-wasm/security/dependabot) and nine [CodeQL alerts](https://github.com/starknet-innovation/snip-36-prover-wasm/security/code-scanning) observed on 2026-10-05. The later RPC-retry change on `main` moved the request-forgery finding from alert 1 to alert 11; the endpoint fix covers both locations. Counts below describe the proposed source changes, not GitHub's default-branch alert state before merge.

## Executor dependency updates

`patches/executor/Cargo.lock` now resolves versions outside the affected ranges of **31 alerts**. Cargo generated the lock against the pinned, patched sequencer workspace. Source preparation first verifies the original portability lock's SHA256, then installs this reviewed lock. The upstream revisions, compiler, AIR, circuit, proof format, native verifier lock and release asset hashes are unchanged.

| Package | Previous version | Updated version | Dependabot alerts |
| --- | --- | --- | --- |
| aws-lc-rs / aws-lc-sys | 1.15.0 / 0.33.0 | 1.18.1 / 0.45.0 | 8, 9, 10, 14, 15 |
| bytes | 1.10.1 | 1.11.1 | 5 |
| keccak | 0.1.5 | 0.1.6 | 7 |
| libp2p-quic | 0.13.0 | 0.13.1 | 38 |
| openssl | 0.10.75 | 0.10.80 | 22–26, 28, 31, 33 |
| quinn-proto | 0.11.13 | 0.11.15 | 11, 36 |
| rand | 0.8.5 / 0.9.2 | 0.8.6 / 0.9.3 | 20, 21 |
| rkyv | 0.8.14 | 0.8.16 | 32 |
| ruint | 1.17.0 | 1.17.2 | 2 |
| rustls-webpki | 0.103.8 | 0.103.13 | 16, 18, 19, 27 |
| serde_with | 3.15.1 | 3.21.0 | 37 |
| thin-vec | 0.2.14 | 0.2.16 | 17 |
| time | 0.3.44 | 0.3.47 | 6 |
| xxhash-rust | 0.8.15 | 0.8.16 | 39 |
| yamux (0.13 branch) | 0.13.8 | 0.13.10 | 12; alert 13 remains for 0.12.1 |

Associated derive, macro, system and helper crates changed as required by Cargo. `ruint` 1.17.2 declares `reciprocal_mg10` unsafe with an explicit input precondition; 1.17.0 exposed it as a safe function. The advisory currently has no `first_patched_version`, so this update was also checked against the downloaded crate source, rather than relying only on that metadata field.

## Dependabot resolver follow-up

After PR #1 merged, GitHub reported 31 fixed and nine open dependency alerts. The [automatic Cargo security update run](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/runs/37294275402) failed during file fetching because `patches/executor/Cargo.toml` was missing: the reviewed lock was stored outside its fetched workspace.

The executor patch directory now includes all 117 manifests from the pinned, patched source tree, with the same workspace members and path dependencies. Dependabot can fetch the complete manifest graph. Security updates include transitive dependencies; general version update PRs remain disabled. Source preparation rejects manifest drift, and CI checks fresh preparation plus identical dependency resolution with the committed lock. A manifest-changing update needs matching source patches and any required API migration before it can pass CI. See [resolver maintenance](../patches/executor/README.md).

This follow-up repairs the missing-manifest input. The lock, dependency versions, upstream pins and released binaries are unchanged; the nine dependency alerts below remain open. GitHub's hosted security-update job must run again after merge to confirm its result. The single remaining CodeQL JSON-evidence flow is also unchanged (reported as alert 12 after the merge).

## Nine dependency alerts remain affected

Reachability was checked using the **normal and build dependencies** of `browser_virtual_os` for `wasm32-unknown-unknown`, not just a package's presence in the workspace lock:

```sh
cargo +stable tree --locked --manifest-path build/sequencer/Cargo.toml \
  -p browser_virtual_os --target wasm32-unknown-unknown -e normal,build
```

| Package / alerts | Observed dependency path and limitation | Required follow-up |
| --- | --- | --- |
| `lru` 0.12.5 / 0.13.0 — 3 | **0.12.5 is in the browser graph**, through `starknet_patricia_storage` and `num-prime`; 0.13.0 is also retained by `alloy-provider` elsewhere. The advisory concerns `IterMut`. The reviewed cache consumers do not use `iter_mut`, but this is not an exhaustive proof of unreachability. | Migrate all relevant consumers to 0.16.3+ or obtain a reviewed backport, then rebuild and rerun browser/native/network gates. |
| `pyo3` 0.19.2 — 1, 34, 35 | `native_blockifier` and `pyo3-log`; absent from the browser normal/build graph. Upstream pins the 0.19 API. | Coordinate the PyO3 0.29+ / pyo3-log migration and validate native Python bindings. |
| `hickory-proto` 0.25.2 — 29, 30 | `hickory-resolver` and `libp2p-mdns`; absent from the browser normal/build graph. Current consumers constrain the 0.25 API. | Upgrade the DNS/libp2p consumers to a graph containing 0.26.1+ and validate network behavior. |
| `yamux` 0.12.1 — 13 | `libp2p-yamux` 0.47.0 depends on both 0.12 and 0.13. Updating the latter does not fix the former. Absent from the browser normal/build graph. | Migrate the transport consumer away from the 0.12 branch. |
| `jsonwebtoken` 9.3.1 — 4 | `google-cloud-auth` 0.17.2; absent from the browser normal/build graph. | Upgrade the auth consumer to a version using jsonwebtoken 10.3+ and validate its JWT/auth behavior. |
| Python `ecdsa` 0.19.2 — 40 | Installed by the pinned Cairo compiler requirements. The advisory affects signing/key generation/ECDH and has no published fix. Cairo imports its RFC6979 helper; browser and daily signing use JavaScript Stark-curve code. | Keep compiler environments free of signing secrets; replace the upstream dependency when the compiler supports it. `build.sh` now rejects `STARKNET_PRIVATE_KEY`. This is containment, not a patched package. |

These packages remain in their original manifests and remain visible to scanners. Absence from the browser target does not make other sequencer targets safe. The assessment is a snapshot, not a complete audit of every call site or the separately pinned prover graph.

## CodeQL findings

| Alert | Change or reviewed behavior |
| --- | --- |
| 1 / 11 — client-side request forgery | Live transport accepts only the exact reviewed Sepolia RPC URL and fetches a code-owned constant. The UI offers that endpoint as a selection. Host suffixes, credentials, query/fragment additions, alternate paths and other networks are rejected; redirects fail and credentials are omitted. |
| 2 — manifest data sent to network | Asset names select fixed release URLs and fixed local destinations. The entire manifest is checked before any download or write. Repository/release changes, duplicate assets and unexpected paths fail. |
| 3 — file data sent to RPC | Intentional flow (no longer reported after the upstream RPC-retry refactor): locally prepared public account/block/transaction fields become JSON-RPC parameters at a fixed Sepolia URL. No file content controls the URL or headers. Redirects fail; requests omit credentials. The private signing scalar is not included. |
| 4 — file data sent to gateway | Broadcast uses an explicit transaction-field projection after the existing account, call, hash, proof-digest, fee and nonce checks. Extra file properties and extra resource-bound properties are omitted. Wire field types/ranges and proof encoding are checked; redirects fail. Broadcasting remains an explicit CLI step. |
| 5 — network data written as Wasm | Intentional checksum-pinned release download. Actual streamed bytes are capped at the expected size; exact length and SHA256 are checked before writing. A unique exclusive temporary file is renamed only after verification. Failed downloads leave the prior artifact intact. GitHub release redirects remain necessary; the committed digest authenticates the result. |
| 6 — network data written as JSON evidence | **Intentional flow requiring scanner triage:** bounded RPC responses and submission results are serialized as JSON under operator-selected `RUN_DIR`, using filenames owned by the script. These files are evidence, not executable modules. New files use mode 0600. |
| 7 — RPC data in Actions summary | The intended summary reports the matched transaction hash, checked receipt status, safe nonnegative integer block number and bounded nonnegative numeric fee. It uses a fixed explorer-link prefix. |
| 8, 9 — Worker message origin | Both handlers check dedicated-Worker semantics before reading payloads: empty `origin`, null `source`, trusted event and an object payload. Checking against the page origin would incorrectly reject genuine dedicated-Worker messages. Real Chromium tests exercise owner messages and reject foreign/synthetic events. |

After integration with the RPC-retry changes, the local security-extended CodeQL run reports only the intentional JSON-evidence flow corresponding to alert 6. The source comments record the reviewed flows and their rationale; they do **not** disable queries or automatically dismiss GitHub alerts. A maintainer can use these narrow explanations for manual triage. No broad path or rule exclusions are introduced into the repository's scanning configuration.

## Validation and release boundary

- 54 Node tests pass, including URL selection, bounded responses, asset checksum/atomic-write failures and gateway field projection.
- npm audit reports no advisories.
- Chromium accepts real dedicated-Worker messages, rejects synthetic/foreign events, and replays both recorded CoinFlip rounds with their expected PIE hashes using the released executor.
- The updated executor source builds in release mode with `--locked` on `nightly-2026-01-15`; wasm-bindgen 0.2.105 produces unchanged JavaScript/type bindings.
- The source-built executor also replays both CoinFlip fixtures with unchanged PIE hashes. A complete recursive proof of the recorded balance invocation was generated in Chromium with the unchanged released prover, checked against the reconstructed fixture statement, and accepted by the unchanged native verifier. [Validation record](../evidence/security-source-validation.json).
- Fresh source preparation validates the original patched lock, installs the reviewed replacement and is idempotent.
- PR CI now runs the Worker boundary checks, the two recorded-round browser replays, and stubbed wallet safety scenarios, in addition to existing unit and contract tests.

The prebuilt executor/prover assets are deliberately not republished by this PR. Dependency fixes in a lockfile do not modify those binaries. Source-built replacement artifacts require full browser proof generation, unchanged native verification and Sepolia acceptance before release promotion. No new on-chain transaction or release deployment is part of this review.
