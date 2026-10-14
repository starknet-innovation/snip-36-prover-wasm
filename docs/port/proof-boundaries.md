The test-only [native helper](../../native/proof_boundaries.rs) decodes actual recursive candidate proof bytes using the unchanged 3035dd verifier's pinned `get_proof_config()`, requires full input consumption, and requires exact canonical reserialization of the decompressed proof. It then reconstructs the complete serialized layout by serializing each component in protocol order and requires that layout to equal the original bytes. Private evaluation-sample storage is mutated only through checked component spans.

Canonical mutations increment one M31 limb modulo its prime, preserving valid field encodings. Cases cover trace/interaction/composition roots; preprocessed, main, interaction and previous-point OOD evaluations; composition evaluations; claimed sums; salt and both nonces; first/last columns and queried values in every evaluation tree; first/last queried authentication paths and their first/last limbs; every FRI root, final coefficients, first/last FRI authentication paths and witnesses. Unequal query values and complete authentication/witness records are also permuted. Constant records cannot demonstrate ordering changes and are not counted as mutations. Separate negative cases exercise noncanonical fields, trailing fields, and truncation.

Every mutation is recompressed with the original three-byte version header and passed to the unchanged `spike_native verify` binary with the independently retained expected-output fixture. A positive control is verified first. Canonical cases must deserialize and reserialize exactly before verification. Signal termination and verifier panics fail the test; panics are also recorded separately from ordinary errors. A negative passes only for the expected reason: canonical mutations must end in `Error: "Verification failed"`, and malformed encodings must fail during decompression/deserialization before the verifier is called. Any other error (for example I/O) fails the check. These verdict rules live in std-only [boundary_rules.rs](../../native/boundary_rules.rs), whose tests run in CI; all 1,605 retained cases satisfy them. Output parents are created automatically, while an existing final output directory is rejected. The helper checks the original verifier SHA before and after the suite. It does not modify the verifier or production prover.

The pinned native verifier parses the version prefix but does not validate its value. These tests preserve the original prefix and do not claim that changing an otherwise valid prefix must be rejected. Tests also do not establish adversarial security, formal equivalence, CI validation, or human review.

Use an isolated original workspace and build only the new example; no candidate Cargo overrides are involved:

```sh
python3 scripts/prepare-sources.py native --build-dir build/boundary-study
cp native/proof_boundaries.rs native/boundary_rules.rs \
  build/boundary-study/native-prover/crates/privacy_prove/examples/
cargo +nightly-2026-01-15 build --locked --release \
  --manifest-path build/boundary-study/native-prover/Cargo.toml \
  -p privacy-prove --example proof_boundaries --target-dir build/target-native
build/target-native/release/examples/proof_boundaries \
  artifacts/port/sourced-proof-05/balance.proof.bin \
  artifacts/port/corpus-01/balance.expected.json \
  build/target-native/release/examples/spike_native \
  artifacts/port/boundaries/balance-01
```

Repeat the last command for `coinflip-heads` and `coinflip-tails`, using new output directories. The pinned unchanged verifier SHA is `2b9878070536597b636d257d12577a5d528c3a7fb2bc0ab048df7864c16aa6b2`. Raw manifests contain proof/expected/verifier hashes and component spans. JSONL journals retain started/completed cases, proof hashes, exit status, panic detection, and failures; compressed mutated proofs and stdout/stderr remain beside them under `artifacts/port/boundaries/`. These artifacts must be retained, including any failed attempt.

Local execution against the final sourced candidate proofs (`sourced-proof-05`) passed all three workloads: 535 cases each, consisting of one accepted positive control, 530 rejected canonical mutations, and four rejected malformed encodings. Each workload included 24 explicit ordering mutations. No verifier panics or signal terminations occurred. [Recorded identities and counts](validation-proof-boundaries.json) distinguish these local results from CI, review, or release. The three proof hashes also match the retained baseline bytes; this does not substitute for intermediate invariant tests.
