# Security scope

This is an experimental browser proving integration, not an independent audit of the pinned cryptographic implementation. Use a funded disposable Sepolia account. There is no mainnet mode. The signing key belongs only in the protected `sepolia` environment and the local signing process; browser execution/proving must never receive it.

The initial publication's GitHub dependency scan reported40advisories:39against the preserved full sequencer workspace `patches/executor/Cargo.lock`, and one against the Python Cairo build-tool requirements (`ecdsa`, P-256 timing advisory). The daily workflow uses JavaScript Stark-curve signing, not that Python package. The npm dependency audit was clean at publication. A full workspace lock includes packages outside the browser target, but that alone does not establish that an advisory is irrelevant; affected dependency reachability still needs assessment. See the repository's [dependency alerts](https://github.com/starknet-innovation/snip-36-prover-wasm/security/dependabot).

Do not silently upgrade the proof/circuit dependencies or dismiss these alerts to make a status indicator green. Preserve the pinned evidence and validate any dependency changes with browser proof generation, unchanged native verification where applicable, and Sepolia acceptance. Source builds should run without signing credentials.

For a suspected issue, use GitHub private vulnerability reporting when available or contact the repository maintainers privately. Do not include signing keys, unused signed submissions, or account files in public issues.
