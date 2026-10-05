# Executor dependency resolver

`Cargo.toml` and the nested manifests are byte-for-byte copies from the pinned
sequencer after this repository's portability patches. `Cargo.lock` is the
reviewed lock installed into that same source tree by `prepare-sources.py`.
The upstream sequencer manifests are distributed under the accompanying
Apache-2.0 license.

This directory exposes the complete supported browser workspace and local
dependency paths to Dependabot. Unused upstream node, Python-binding, networking
and cloud targets are removed by `dependency-scope.patch`. The 29 manifests
include normal/build, optional and development dependencies.

`browser-vendor/num-prime-0.4.4` contains the upstream crate under its included
MIT/Apache licenses. Its only changed upstream file is `Cargo.toml`, updating
LRU to 0.16.3+. Its Rust algorithms are unchanged. Source preparation copies
that vendored crate into the prepared workspace. Other implementation files
remain in the fetched, patched source checkout. Dependabot
creates temporary source targets while resolving updates. Build the executor
from `build/sequencer`, using the instructions in `docs/build.md`.

Source preparation rejects a mirror that differs from the patched source
manifests. A Dependabot PR that changes a manifest therefore needs the matching
source patch/API migration before it can pass CI. Lock-only updates use the
existing constraints and are applied directly during source preparation.

To regenerate after changing source patches, first prepare a fresh pinned
checkout (a mismatch intentionally stops preparation after applying patches),
then run:

```sh
python3 scripts/executor_manifests.py sync
python3 scripts/prepare-sources.py executor
python3 scripts/executor_manifests.py resolve
```

CI prepares fresh sources, compares every manifest, and checks that both
workspaces resolve identical dependency edges, features and target conditions
with `--locked`. It neither compiles the resolver placeholders nor changes the
reviewed lock. Dependency updates still need the build and browser/native
validation appropriate to the affected targets before release promotion.
