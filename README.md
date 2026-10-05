# SNIP-36 browser prover

[![CI](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/ci.yml/badge.svg)](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/ci.yml)
[![Daily Sepolia Browser E2E](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/daily-sepolia.yml/badge.svg)](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/workflows/daily-sepolia.yml)

Generate SNIP-36 proofs entirely in browser Workers, from an authenticated public Starknet state snapshot through Cairo execution and recursive proving. Signing is local and separate; the browser never receives a private key. The daily test submits the resulting proof to Sepolia and requires a successful on-chain receipt.

This is a desktop-browser prototype: the measured recursive prover used about **14.1 GB of Wasm linear memory** and **13.8 GB of peak requested Rust allocations**, taking about **87 seconds** on an Apple M3 Max. Linear memory, requested allocations and resident process memory are different metrics. Mobile support and arbitrary workload performance are untested.

## Verified on Sepolia

A real browser-generated proof was accepted in [transaction `0x60e1…bd30d`](https://sepolia.voyager.online/tx/0x60e1afba1ee97ea8523909c017e639e35ffbefd25adcee8a26cb290fb1bd30d), block **16,111,332**, on 2026-10-05. It executed STRK `balance_of(account)` through an existing account and cost **1.172821106001977728 testnet STRK**. The nonce advanced and the balance delta matched the fee. Public receipts are in [`evidence/`](evidence/).

**The correct prover pin matters.** The reference backend's `prove virtual-os` path invokes its sequencer transaction service, using proving-utils **3035dd**. Its standalone utility uses a different revision, **0a97f45**. The latter produced locally valid proofs rejected by Sepolia in our test. This repository uses **3035dd**, without changing the pinned circuit or security parameters. See [`pins.json`](pins.json) and [`docs/architecture.md`](docs/architecture.md).

## Run

Requirements: Node.js24+, a recent Chromium with WebAssembly memory64 support, and at least16GB RAM (32GB recommended for local development).

```sh
npm ci --ignore-scripts
npm run assets           # Download released Wasm modules and verify their SHA256/size.
npm test
npm run serve
```

Open `http://127.0.0.1:8767`, paste a signed execution request and fixed-block source (or saved RPC capture), then choose **Execute and prove**. The page performs read-only RPC acquisition; it does not submit transactions. For the automated flow, see [`docs/daily-e2e.md`](docs/daily-e2e.md).

The source is distributed as pinned upstream checkouts plus browser portability patches. Prebuilt modules are release assets rather than large Git blobs. Their checksums are committed in [`assets.json`](assets.json). See [`docs/build.md`](docs/build.md) for source reproduction and optional native verification.

## Daily testing

The [first GitHub-hosted run](https://github.com/starknet-innovation/snip-36-prover-wasm/actions/runs/37282452695) passed in 3m42s: [Sepolia transaction](https://sepolia.voyager.online/tx/0x512aefe965bd263b4d5f79bc6ca65a5e91cff394ddc74c6ae505636c0e10d17), block **16,112,150**, fee **1.171282850038856832 testnet STRK**. Chromium execution took 9.45s and prover initialization/proving took 147.06s. Its proof also passed the unchanged native `3035dd` verifier after downloading the CI artifact. [Recorded evidence](evidence/first-daily-ci-run.json).

GitHub Actions runs every day at **06:00 UTC** and supports manual dispatch from `main`. It:

1. Signs a fresh Sepolia balance query locally using the environment-protected test account.
2. Acquires fixed-block state and compiles authenticated Sierra classes in a real Chromium Worker.
3. Executes, constructs transaction-specific commitments and Cairo PIE, and generates the full recursive proof in browser Workers.
4. Replays the captured inputs offline, checks byte-identical PIE, and rejects a deliberately invalid signature through the actual account validation code.
5. Checks the statement/program/capture linkage, signs the proof-bearing transaction, and persists its intended hash before broadcast.
6. Submits once to the sequencer gateway and requires `SUCCEEDED` plus closed-block L2/L1 acceptance. Receipts, proofs and captures are retained as workflow artifacts.

The daily test has a hard maximum fee budget of **25 testnet STRK** per run; it never deploys contracts or transfers tokens. No mainnet mode exists. PR CI runs offline tests without signing credentials. Scheduled runs require the `sepolia` environment setup described in the runbook.

## Scope

The pinned AIR, bootloader, recursive circuit, security parameters and proof encoding are preserved. Public RPC header/path authentication does not independently establish L1 consensus finality. A successful Sepolia receipt demonstrates network acceptance for that invocation; it is not a general security audit or an arbitrary-transaction support claim. The daily test verifies on-chain acceptance; optional unchanged native verification remains available for local diagnosis.

Apache-2.0; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for upstream sources and licenses.
