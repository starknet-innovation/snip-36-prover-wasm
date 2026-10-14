# Keep memory proving opt-in with reproducible candidate validation

Keep `prover` on the unchanged pinned baseline and add `prover-memory` for the
memory-saving candidate. Optional profiles retain separate content-addressed
modules; `--install` explicitly selects one for local browser use. Preparation
isolates baseline, memory candidate and native verifier sources, rejects dirty
or stale trees, and pins local circuit packages with workspace overrides.

The offline real-PIE harness reexecutes trusted captures, checks independent
public outputs, hashes the exact served/instantiated module, and verifies proofs
and negative controls with the unchanged native verifier. Panics, crashes and
timeouts fail controls. Metadata uses the build's feature selection, and shared
stage budgets allow all native checks to finish.

Validation includes build-selection/install regressions, preparation/identity
and dependency-graph checks, exact-byte browser proof evidence and repository CI.
Recursive proving evidence is local; existing CI checks source resolution and
the repository tests. No release assets, checksums or protocol pins are changed.
