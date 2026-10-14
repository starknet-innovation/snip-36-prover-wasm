# Retain recursive-proof, correctness and browser measurement evidence

The completed paired C campaign uses about 64.5% less requested Rust peak allocation and 58% less linear memory, but proving is 40–50% slower. All 36 attempts pass and the stability gates pass; the declared time promotion gate fails on every workload. No release promotion is warranted under this plan.

Add a test-only structured proof mutator built against the original 3035dd
native dependency graph, leaving the pristine verifier binary unchanged.
Require canonical decoding/serialization and exact component layout before
mutating roots, OOD values, composition data, openings, authentication paths,
FRI values and ordering. Verify each case against independent expected output.
All three final proofs pass 535 checks each: one positive control, 530 canonical
mutations and four malformed encodings. All 1,602 negatives reject without panics
or signals. The unchanged native verifier parses but does not validate version
values; the helper preserves the original header and records that limitation.

Retain final module/source/dependency/toolchain identities, Worker lifecycle and
cancellation evidence, real execution-to-proof/replay/invalid-signature results,
raw paired benchmark attempts, CI checks, provenance and independent agent
reviews. Correctness checks do not establish a performance gain. Apply the
preregistered stability and promotion gates to complete paired measurements;
report every attempt including the interrupted initial campaign.

Human review, candidate recursive-proof CI, live Sepolia validation and release
promotion remain distinct from these local results. No assets or checksums are
promoted by this PR.
