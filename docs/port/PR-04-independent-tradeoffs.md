# Evaluate later portable memory tradeoffs in a separate profile

Add `prover-tradeoffs`, prepared and built separately under `build/tradeoffs`.
Its adaptive block sizes cap eligible block-column residency at 96 MiB, up to
32 blocks, with saturating size arithmetic. FRI denominator inversion operates
on bounded chunks and drops dead accumulations before extension. The default
sourced candidate and pristine verifier remain separate.

Validation: existing Stwo/framework tests and all three browser proofs match
baseline bytes and pass unchanged native verification and tamper tests. The
smoke requested allocation peak is unchanged from the sourced profile; these
runs do not establish a memory improvement. No prepared challenge workload,
native allocator, page advice or protocol constants were imported.
