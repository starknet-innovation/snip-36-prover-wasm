# Optional memory-saving prover

The unchanged pinned prover is the default source build. The slower memory-saving
implementation is selected explicitly as `prover-memory`.

| Build mode | Prepared sources | Installs browser module by default |
| --- | --- | --- |
| `prover` | `build/baseline` | Yes |
| `prover-baseline` | `build/baseline` | No |
| `prover-memory` | `build/memory` | No |
| `prover-tradeoffs` | `build/tradeoffs` | No |
| `prover-kernels` | `build/kernels` | No |

Pass `--install` to select an optional profile locally. Each build also retains
its module at `build/wasm/SHA256.wasm`. `npm run assets` restores the released
modules, including the v0.2.0-memory module. Both CoinFlip pages let the user
choose the build, preselecting Standard only when `navigator.deviceMemory` reports 32+ GB
(`web/prover-builds.mjs`); the daily live E2E pins the standard build.

The memory profile preserves the validated candidate's exact source/patch
receipt, including the lifetime, striped, sourced preprocessing and sparse Merkle layers.
The tradeoff and kernel profiles keep their separate extensions. Default sources
use only the original three browser portability patches; native verification
retains its independent pristine 3035dd dependency graph.

Build-selection tests exercise the real shell flow with isolated fake compiler
outputs: default source selection and installation, optional-module retention,
explicit installation and return to baseline, control/experimental profile
noninstallation, and rejection of invalid installation flags before compilation.
The full stack passes 11 Python prover checks and 67 JavaScript tests. Fresh
memory preparation and locked metadata resolve all patched packages locally and
match baseline versions, dependency edges and features.

The locally installed module was restored to the existing released asset
`1f76da1636c1e0e5f9952b3b49fc23d5a93493c2b94d3a2ec221965aa802a8aa`.
The validated memory module `41a6f536…` and kernel module `a72eb0f4…` remain
retained separately. The actual default source build produced module
`40d0165709d1f368846292130e2b4d5d8bc9edfc703f97c48ebfdcfb79af60ed`;
its independent proof validation is recorded in [optional-memory.json](optional-memory.json).
Binary identity differs from the older source-built baseline, so validation
checks the newly produced bytes rather than assuming equivalence.

No optimization patches, protocol pins or released asset checksums changed.
Historical validation commands using `prover` for the candidate refer to the
previous layout; current candidate commands use `prover-memory` and
`--source-root build/memory`. The original memory/time benchmark conclusions
remain unchanged: the time acceptance gate failed, so the candidate is optional.
