# Security scope

This is an experimental browser proving integration, not an independent audit of the pinned cryptographic implementation. Use a funded disposable Sepolia account. There is no mainnet mode. The signing key belongs only in the protected `sepolia` environment and the local signing process; browser execution/proving must never receive it.

The 2026-10-05 security review updates the executor source lock to address 31 of the 40 initial Dependabot alerts. Nine alerts remain affected, including `lru` in the browser dependency graph and Python `ecdsa` in the Cairo build tools. See the [per-package assessment and validation limits](docs/security-alerts.md) and the live [dependency alerts](https://github.com/starknet-innovation/snip-36-prover-wasm/security/dependabot). A package being outside the browser build does not make its vulnerable version safe for other sequencer targets.

The released Wasm binaries and their hashes are unchanged. Lockfile fixes apply to source builds; they do not patch previously published binaries. Replacing a release requires the validation gates below. The daily workflow uses JavaScript Stark-curve signing, not Python `ecdsa`; source builds reject the presence of `STARKNET_PRIVATE_KEY`.

Do not silently upgrade the proof/circuit dependencies or dismiss these alerts to make a status indicator green. Preserve the pinned evidence and validate any dependency changes with browser proof generation, unchanged native verification where applicable, and Sepolia acceptance. Source builds should run without signing credentials.

For a suspected issue, use GitHub private vulnerability reporting when available or contact the repository maintainers privately. Do not include signing keys, unused signed submissions, or account files in public issues.
