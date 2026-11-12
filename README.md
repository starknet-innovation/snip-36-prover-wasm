# SNIP-36 browser prover

The source targets [backend v1.4.2](https://github.com/starknet-innovation/snip-36-prover-backend/releases/tag/v1.4.2) / `deps-v16`: sequencer `148de44521`, proving `e0035ffc8`, and the updated 0.14.4 V2 circuit. Proof facts use `PROOF2` and virtual-OS program `0x1c7be3…fd324`. The latest wallet, saved-round and progress UI remains available; the default prover now includes v1.4.2’s reviewed low-memory V2 optimizations. Its historical V1 module remains disabled. Browser release [`v1.0.1`](https://github.com/starknet-innovation/snip-36-prover-wasm/releases/tag/v1.0.1) supplies the optimized V2 modules; `npm run assets` downloads and verifies them. [Release validation](evidence/release-v1.0.1.json) records their exact CI provenance, stock proof equality and native verification. Source reproduction is in [the build instructions](docs/build.md). The Sepolia bank is deployed and funded for V2; its class and proof profile are checked on-chain before new play. Earlier V1 rounds remain on their original bank through the separate recovery view.

The [v1.4.2 offline validation](evidence/backend-v1.4.2-validation.json) records browser measurements, native verification and stock proof equality. The [V2 deployment and accepted browser-proof settlement](evidence/v2-bank-deployment.json) are recorded separately from the historical V1 receipts.

**[Play CoinFlip on Sepolia](https://starknet-innovation.github.io/snip-36-prover-wasm/play.html)** · [Recorded replay lab](https://starknet-innovation.github.io/snip-36-prover-wasm/)

Based on [the upstream CoinFlip app](https://github.com/starknet-innovation/snip-36-prover-backend/tree/main/apps/coinflip), the live demo uses your Starknet wallet to commit/deposit, reveal, and settle. A prefunded bank matches the stake; a browser Worker executes the public coinflip and generates a SNIP-36 proof. The bank checks the exact game's proof facts before settlement. GitHub Pages hosts the entire frontend; no signing backend is required.

The wallet must support **Wallet API 0.10.3+ proof-bearing invocation**. Unsupported versions are blocked before deposit. Advertising that version is necessary but does not guarantee a wallet implementation accepts arbitrary CoinFlip proofs. E2E automation uses a Wallet API adapter backed by the existing sncast account, not an installed wallet extension. Test tokens only, maximum stake 0.01 test STRK, 24-hour reveal deadline. Block-hash-derived seeds are not certified unbiased randomness. See [architecture, recovery and compatibility](docs/live-coinflip.md).

Run `npm ci --ignore-scripts && npm run demo:build && npm run serve` to use the verified release modules, or rebuild them with [the source instructions](docs/build.md). Full proving requires recent memory64-capable desktop Chromium. Execution alone is much lighter. CI builds both pinned modules and verifies their source-build receipts. Pages requires the published release to match the current pins, patches and module hashes, then replays the recorded rounds and initializes the prover in Chromium. No account keys or signing secrets are included in the website or Pages workflow.

[![CI](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/ci.yml/badge.svg)](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/ci.yml)
[![Daily Sepolia Browser E2E](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/daily-sepolia.yml/badge.svg)](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/daily-sepolia.yml)

Generate SNIP-36 proofs entirely in browser Workers, from an authenticated public Starknet state snapshot through Cairo execution and recursive proving. Signing is local and separate; the browser never receives a private key. The daily test submits the resulting proof to Sepolia and requires a successful on-chain receipt.

This is a desktop-browser prototype. The historical V1 recursive prover used about **14.1 GB of Wasm linear memory** and **13.8 GB of peak requested Rust allocations**, taking about **87 seconds** on an Apple M3 Max. Linear memory, requested allocations and resident process memory are different metrics. Mobile support and arbitrary workload performance are untested.

## V2 local validation

A V2 proof generated in a real Chromium Worker passed the unpatched upstream native verifier: **231,440 proof bytes**, **72.4 seconds** including initialization, and **13.3 GiB Wasm linear memory** (13.2 GiB peak requested Rust allocations). Both recorded CoinFlip rounds and the balance query replayed successfully, offline replay was identical, and an invalid account signature was rejected. These are local measurements for the retained captures. [Evidence](evidence/v2-source-validation.json). A fresh V2 CoinFlip round subsequently passed browser generation, unchanged native verification, and Sepolia settlement at [block 17,969,259](https://sepolia.voyager.online/tx/0x4fbeb541f02b30208f1d64278b563f6e8f1dc866aef87d0bdc4cf578f6e27e4). Proofless settlement was rejected. This was a losing round, so the pool retained both stakes. [Deployment and live evidence](evidence/v2-bank-deployment.json).

## Historical V1 verification on Sepolia

The live wallet CoinFlip flow also completed: [settlement transaction](https://sepolia.voyager.online/tx/0x20b184e3a7a2926806437fcafcfce1096ca54d16116aa08ce526ebc03786712), block **16,114,692**. Its browser-generated 234,138-byte proof passed the unchanged native verifier; settlement paid **0.002 test STRK** on a 0.001 stake. A proofless settlement call against the revealed state reverted with `Expected one proof message`. [Full public evidence](evidence/live-coinflip-e2e.json). This exercised the Wallet API test adapter; installed extension compatibility remains unverified.


A real browser-generated proof was accepted in [transaction `0x60e1…bd30d`](https://sepolia.voyager.online/tx/0x60e1afba1ee97ea8523909c017e639e35ffbefd25adcee8a26cb290fb1bd30d), block **16,111,332**, on 2026-10-05. It executed STRK `balance_of(account)` through an existing account and cost **1.172821106001977728 testnet STRK**. The nonce advanced and the balance delta matched the fee. Public receipts are in [`evidence/`](evidence/).

**The transaction-service prover pin matters.** v1.4.2's sequencer uses the `starkware-libs/proving` monorepo at **e0035ffc8**. Its separately bundled standalone utility remains on proving-utils **0a97f45**. The browser and native diagnostic verifier use the transaction-service V2 stack. See [`pins.json`](pins.json) and [`docs/architecture.md`](docs/architecture.md).

## Run

Requirements: Node.js 24+, recent Chromium with WebAssembly memory64 support, and at least 8 GB RAM for the recorded fixtures (32 GB recommended for source builds). Larger workloads may need more memory.

```sh
npm ci --ignore-scripts
npm run assets           # Download v1.0.1 modules and verify sizes/SHA256.
npm test
npm run demo:build
npm run serve
```

Open `http://127.0.0.1:8767`, paste a signed execution request and fixed-block source (or saved RPC capture), then choose **Execute and prove**. The replay lab performs read-only RPC acquisition. The separate live page submits transactions only through your connected wallet. For the automated flow, see [`docs/daily-e2e.md`](docs/daily-e2e.md).

The source is distributed as pinned upstream checkouts plus browser portability patches. Modules remain outside Git. [`assets.json`](assets.json) records the low-memory V2 `v1.0.1` release; source builds record platform-specific checksums and source identities in `build/source-assets.json`. See [`docs/build.md`](docs/build.md) for source reproduction and optional native verification.

## Daily testing

The [first GitHub-hosted run](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/runs/37282452695) passed in 3m42s: [Sepolia transaction](https://sepolia.voyager.online/tx/0x512aefe965bd263b4d5f79bc6ca65a5e91cff394ddc74c6ae505636c0e10d17), block **16,112,150**, fee **1.171282850038856832 testnet STRK**. Chromium execution took 9.45s and prover initialization/proving took 147.06s. Its proof also passed the unchanged native `3035dd` verifier after downloading the CI artifact. [Recorded evidence](evidence/first-daily-ci-run.json).

GitHub Actions runs every day at **06:00 UTC** and supports manual dispatch from `main`. It:

1. Signs a fresh Sepolia balance query locally using the environment-protected test account.
2. Acquires fixed-block state and compiles authenticated Sierra classes in a real Chromium Worker.
3. Executes, constructs transaction-specific commitments and Cairo PIE, and generates the full recursive proof in browser Workers.
4. Replays the captured inputs offline, checks byte-identical PIE, and rejects a deliberately invalid signature through the actual account validation code.
5. Checks the statement/program/capture linkage, signs the proof-bearing transaction, and persists its intended hash before broadcast.
6. Submits once to the sequencer gateway and requires `SUCCEEDED` plus closed-block L2/L1 acceptance. Receipts, proofs and captures are retained as workflow artifacts.

The balance-query test has a hard maximum fee budget of **25 testnet STRK**. A following live CoinFlip test uses the configured V2 bank, deposits **0.001 test STRK**, reveals, proves in Chromium and settles through the test Wallet API adapter. It caps each transaction at 25 test STRK, uses the existing prefunded bank, and never deploys or automatically tops up contracts. No mainnet mode exists. The CoinFlip step explicitly skips any incompatible configuration. PR CI builds the pinned Wasm modules and runs offline tests without signing credentials. Scheduled runs require the `sepolia` environment setup described in the runbook.

## Scope

The pinned AIR, bootloader, recursive circuit, security parameters and proof encoding are preserved. Public RPC header/path authentication does not independently establish L1 consensus finality. A successful Sepolia receipt demonstrates network acceptance for that invocation; it is not a general security audit or an arbitrary-transaction support claim. The daily test verifies on-chain acceptance; optional unchanged native verification remains available for local diagnosis.

Apache-2.0; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for upstream sources and licenses.
