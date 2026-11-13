# Security alert assessments

## Executor dependency follow-up (2026-11-11)

The 35 open Dependabot alerts observed on the refreshed V2 dependency graph
are addressed by these executor updates. Alerts remain open on the default
branch until merge and GitHub's dependency-graph refresh. Main already includes
PR #18's certifi 2026.10.18 and aiohttp 3.14.5 updates; those are preserved.

| Package | Previous | Updated | Alerts |
| --- | --- | --- | --- |
| aws-lc-sys | 0.33.0 | 0.47.0 | 8, 9, 10, 14, 15 |
| bytes | 1.10.1 | 1.11.1 | 5 |
| keccak (0.1 branch) | 0.1.5 | 0.1.6 | 7 |
| openssl | 0.10.75 | 0.10.80 | 22–26, 28, 31, 33 |
| quinn-proto | 0.11.13 | 0.11.15 | 11, 36 |
| rand (0.8 branch) | 0.8.5 | 0.8.6 | 21 |
| ruint | 1.17.0 | 1.17.2 | 2 |
| rustls | 0.23.43 | 0.23.46 | 41, 51, 52, 53 |
| rustls-webpki | 0.103.8 | 0.103.16 | 16, 18, 19, 27 |
| serde_with | 3.15.1 | 3.21.0 | 37 |
| thin-vec | 0.2.14 | 0.2.16 | 17 |
| time | 0.3.44 | 0.3.47 | 6 |
| xxhash-rust | 0.8.15 | 0.8.16 | 39 |
| zip | 0.6.6 | 9.0.5 | 55, 56, 57, 58 |

The `ruint` advisory still has no first-patched-version field. Version 1.17.2
is outside its affected range (`<=1.17.0`), and its upstream source makes
`reciprocal_mg10` unsafe with a documented input precondition. Companion and
resolver-required dependencies update with the listed packages.

The ZIP update covers both the adapter's direct dependency and Cairo VM's
transitive dependency. The original Cairo VM 3.2.0 crate is retained with a
small patch: its dependency constraint/features, `SimpleFileOptions` writer API,
and a diagnostic-only allowance for upstream parenthesized expressions when
compiled as a path dependency. No VM execution algorithms, upstream program hash, circuit or
proof-system revisions change. The archive checksum, license and maintenance
procedure are recorded in the [executor resolver notes](../patches/executor/README.md).
Cargo also updates the AWS-LC and WebPKI dependencies required by rustls.

This change is scoped to the alerted executor graph. Main's Python compiler
security pins are preserved.
The independently pinned browser prover/native verifier locks remain unchanged;
it does not claim that those graphs contain no advisories or update released
Wasm assets. Source builds and fresh browser/native compatibility checks are
required before release promotion.

The follow-up validation record is
[`evidence/dependabot-executor-validation.json`](../evidence/dependabot-executor-validation.json).
It records the current alert ranges, module identities, identical uncompressed
PIE members, three native-verified browser proofs and six rejected tamper controls.
Unit, source-resolution, compiler, browser UI and Worker checks accompany those
proof checks.

## Earlier assessment (2026-10-05)

This review covers the 40 open [Dependabot alerts](https://github.com/starknet-innovation/snip-36-prover-wasm/security/dependabot) and nine [CodeQL alerts](https://github.com/starknet-innovation/snip-36-prover-wasm/security/code-scanning) observed on 2026-10-05. The later RPC-retry change on `main` moved the request-forgery finding from alert 1 to alert 11; the endpoint fix covers both locations. PR #1 fixed 31 dependency alerts. This follow-up addresses the remaining nine; default-branch alerts update after merge. CodeQL alert 12 was reviewed and dismissed as a false positive on 2026-10-05.

## Executor dependency updates

PR #1 updated `patches/executor/Cargo.lock` outside the affected ranges of **31 alerts**. The table records those initial changes; packages used only by unsupported sequencer targets are removed in this follow-up. Cargo generated the lock against the pinned, patched sequencer workspace. Source preparation first verifies the original portability lock's SHA256, then installs this reviewed lock. Proof-system source revisions, compiler-visible version, AIR, circuit, proof format, native verifier lock and release asset hashes stay pinned. The compiler-only packaging changes are described below.

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
| yamux (0.13 branch) | 0.13.8 | 0.13.10 | 12 in PR #1; both Yamux branches are removed in this follow-up |

Associated derive, macro, system and helper crates changed as required by Cargo. `ruint` 1.17.2 declares `reciprocal_mg10` unsafe with an explicit input precondition; 1.17.0 exposed it as a safe function. The advisory currently has no `first_patched_version`, so this update was also checked against the downloaded crate source, rather than relying only on that metadata field.

## Dependabot resolver follow-up

After PR #1 merged, GitHub reported 31 fixed and nine open dependency alerts. The [automatic Cargo security update run](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/runs/37294275402) failed during file fetching because `patches/executor/Cargo.toml` was missing: the reviewed lock was stored outside its fetched workspace.

The executor patch directory exposes all 29 manifests in the supported browser workspace and its local dependency closure. Security updates include transitive dependencies; general version update PRs remain disabled. Source preparation rejects manifest drift, and CI compares the mirror with freshly prepared sources and identical locked dependency resolution. Manifest-changing updates need matching source patches before CI can pass. See [resolver maintenance](../patches/executor/README.md). GitHub's hosted updater needs another run after merge to confirm the missing-manifest failure is resolved.

## Remaining nine dependency alerts

The workspace scope now consolidated in `v2.patch` limits the prepared workspace to `browser_virtual_os` and the dependencies required by its normal, build, optional and development configurations. Unused inherited dependency declarations are removed as well. Full upstream sequencer node, Python-binding, networking and cloud-storage targets are outside this repository's supported executor workspace. The separately pinned native prover/verifier remains unchanged.

| Package / alerts | Remediation |
| --- | --- |
| `lru` — 3 | All executor-lock instances are 0.16.4. The direct cache constraint is upgraded. `num-prime` 0.4.4 is vendored with only its LRU dependency constraint changed to 0.16.3+, retaining its Rust algorithms unchanged. The compatible Alloy 1.8.3 update removes its old LRU dependency. |
| `pyo3` — 1, 34, 35 | The unused native Python binding target and its inherited declarations are removed from the supported workspace; PyO3 and pyo3-log are absent from its lock. |
| `hickory-proto` — 29, 30 | Unused sequencer networking targets are removed; neither Hickory package remains in the executor lock. |
| `yamux` — 13 | The unused libp2p targets are removed; both Yamux branches are absent from the executor lock. |
| `jsonwebtoken` — 4 | Unused Google Cloud storage/auth targets are removed; jsonwebtoken is absent from the executor lock. |
| Python `ecdsa` — 40 | A checksum-pinned compiler-only Cairo source variant removes the ECDSA requirement and rejects the unused RFC6979 signing entry point. Package metadata uses `0.14.3a3+snip36compiler1`, while the compiler-visible version stays `0.14.3a3`. Builds use a fresh dedicated compiler environment, check that ECDSA is absent, run `pip check`, compile Cairo, verify a public signature fixture, and check that signing fails. No substitute cryptographic implementation is introduced. |

Removing unsupported targets does not patch those components in upstream sequencer releases. This is a scoped build dependency reduction, not a complete audit of every call site or the separately pinned prover graph. The Python variant is build tooling; use supported external signing tools for transaction authorization. The browser and CLI signing implementations are unchanged.

## CodeQL findings

| Alert | Change or reviewed behavior |
| --- | --- |
| 1 / 11 — client-side request forgery | Live transport accepts only an exact allowlist of reviewed RPC URLs: per network, the SNF node then ZAN's public node (Sepolia and mainnet). A caller selects one; failover only moves to the same network's other listed URL, and every endpoint must report that network's chain ID. Host suffixes, credentials, query/fragment additions, alternate paths and unlisted networks are rejected; redirects fail, credentials are omitted and the only request header is `Content-Type`. |
| 2 — manifest data sent to network | Asset names select fixed release URLs and fixed local destinations. The entire manifest is checked before any download or write. Repository/release changes, duplicate assets and unexpected paths fail. |
| 3 — file data sent to RPC | Intentional flow (no longer reported after the upstream RPC-retry refactor): locally prepared public account/block/transaction fields become JSON-RPC parameters at a fixed Sepolia URL. No file content controls the URL or headers. Redirects fail; requests omit credentials. The private signing scalar is not included. |
| 4 — file data sent to gateway | Broadcast uses an explicit transaction-field projection after the existing account, call, hash, proof-digest, fee and nonce checks. Extra file properties and extra resource-bound properties are omitted. Wire field types/ranges and proof encoding are checked; redirects fail. Broadcasting remains an explicit CLI step. |
| 5 — network data written as Wasm | Intentional checksum-pinned release download. Actual streamed bytes are capped at the expected size; exact length and SHA256 are checked before writing. A unique exclusive temporary file is renamed only after verification. Failed downloads leave the prior artifact intact. GitHub release redirects remain necessary; the committed digest authenticates the result. |
| 6 / 12 — network data written as JSON evidence | **Reviewed false positive:** bounded RPC responses and submission results are serialized as JSON under operator-selected `RUN_DIR`, using filenames owned by the script. These files are evidence, not executable modules. New files use mode 0600. |
| 7 — RPC data in Actions summary | The intended summary reports the matched transaction hash, checked receipt status, safe nonnegative integer block number and bounded nonnegative numeric fee. It uses a fixed explorer-link prefix. |
| 8, 9 — Worker message origin | Both handlers check dedicated-Worker semantics before reading payloads: empty `origin`, null `source`, trusted event and an object payload. Checking against the page origin would incorrectly reject genuine dedicated-Worker messages. Real Chromium tests exercise owner messages and reject foreign/synthetic events. |

The JSON evidence flow was reissued as [alert 12](https://github.com/starknet-innovation/snip-36-prover-wasm/security/code-scanning/12) after PR #1 merged. On 2026-10-05 it was dismissed as a false positive after checking every destination: remote data cannot choose filenames or paths; responses are bounded, parsed and serialized as JSON; saved public evidence is never executed. This narrow dismissal is recorded on the alert. No query or path exclusion is added.

## Validation and release boundary

- 59 Node tests pass, including URL selection, bounded responses, asset checksum/atomic-write failures and gateway field projection.
- Eight dependency consistency/regression guards pass, and the unchanged upstream prime-counting test passes with the vendored LRU constraint.
- The compiler-only environment passes dependency, compilation, public-signature verification and signing-boundary checks.
- npm audit reports no advisories.
- Chromium accepts real dedicated-Worker messages, rejects synthetic/foreign events, and replays both recorded CoinFlip rounds with their expected PIE hashes using the released executor.
- The updated executor source builds in release mode with `--locked` on `nightly-2026-01-15`; wasm-bindgen 0.2.105 produces unchanged JavaScript/type bindings.
- The source-built executor also replays both CoinFlip fixtures with unchanged PIE hashes. A complete recursive proof of the recorded balance invocation was generated in Chromium with the unchanged released prover, checked against the reconstructed fixture statement, and accepted by the unchanged native verifier. [Initial validation](../evidence/security-source-validation.json), [follow-up validation](../evidence/security-followup-validation.json).
- Fresh source preparation validates the original patched lock, installs the reviewed replacement and is idempotent.
- PR CI now runs the Worker boundary checks, the two recorded-round browser replays, and stubbed wallet safety scenarios, in addition to existing unit and contract tests.

The prebuilt executor/prover assets are not republished by this PR. Dependency fixes in a lockfile do not modify those binaries. Source-built replacement artifacts require full browser proof generation, unchanged native verification and Sepolia acceptance before release promotion. No new on-chain transaction or release deployment is part of this review.
