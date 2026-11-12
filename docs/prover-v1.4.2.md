# V2 browser prover layers

`patches/prover/proving.patch` is the browser portability layer for proving monorepo revision
`e0035ffc8e08da270b8cb4a71f3708af70c2c775`: output transport, target support,
worker-local execution, memory64 ABI and allocation metrics.

`patches/prover/low-memory-v2.patch` is copied byte-for-byte from backend **v1.4.2**
(`3a2bc73774eca3d96052db937a98c95057fef661`), path
`vendor/low-memory-prover/proving-v2.patch`. SHA-256:
`88132044b4a11cd3369d193d568eaf97d80cd9556b81e1c9445a6fa0d32359d4`.
Preparation checks the pinned digest and applies it after portability. It includes
the reviewed SIMD/FFT fixes; no local edits to this optimization patch are made.
The protocol, blinding, verifier and serialized proof format remain V2.

The default `prover` build uses both layers. `prover-baseline` uses portability
alone in its own source and target directory, cannot install over the default,
and produces a content-addressed module for explicit comparison. Native
verification uses neither patch and remains at the same upstream revision.
Prepared receipts distinguish the profiles and hash their full source trees.

Both modes use the committed browser lock and portable vendor archive. The
independent native graph uses `native.Cargo.lock`. Executor security upgrades
remain in `patches/executor` and are not replaced by backend bundle locks.

See [build instructions](build.md), the
[upstream safety review](https://github.com/starknet-innovation/snip-36-prover-backend/blob/v1.4.2/vendor/low-memory-prover/SAFETY-REVIEW-V2-2026-11-12.md)
and [local validation](../evidence/backend-v1.4.2-validation.json).

## Reproduce the offline proof checks

After building both browser modules and the native verifier as described in
[build.md](build.md), use fresh artifact directories:

```sh
node scripts/offline-proof.mjs prepare artifacts/v142-corpus
module_sha=$(shasum -a 256 web/sequencer-prover.wasm | cut -d ' ' -f 1)
OFFLINE_STOCK_EVIDENCE=evidence/release-v1.0.0.json node scripts/offline-proof.mjs prove artifacts/v142-corpus web/sequencer-prover.wasm "$module_sha" build/target-native/release/examples/spike_native artifacts/v142-proofs
```

This replays the three committed executions, generates proofs in real browser
Workers with external requests blocked, requires the stock V2 proof hashes,
verifies with the unpatched native verifier, and rejects a mutated proof and
public statement for every fixture. CI runs the same checks on its Linux module.
The proof hash comparison is exact, not an approximate numerical comparison.
