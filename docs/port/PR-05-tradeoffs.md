# Evaluate later portable memory tradeoffs in a separate profile

Add `prover-tradeoffs`, prepared and built separately under `build/tradeoffs`.
Its adaptive block sizes target 96 MiB of eligible block-column residency, but
stop at 32 blocks: a component that still exceeds 96 MiB at 32 blocks is not
reduced further, so 96 MiB is a target, not a hard cap. Size arithmetic is
checked/saturating. FRI denominator inversion operates
on bounded chunks and drops dead accumulations before extension. The default
sourced candidate and pristine verifier remain separate.

Validation: existing Stwo/framework tests and all three browser proofs match
baseline bytes and pass unchanged native verification and tamper tests. The
smoke requested allocation peak is unchanged from the sourced profile; these
runs do not establish a memory improvement. No prepared challenge workload,
native allocator, page advice or protocol constants were imported.
