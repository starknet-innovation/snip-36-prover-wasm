The PR #8 review identified an unsupported-input regression: the optimized mask
accepted a zero hash word at difficulty above 32, while the original u32
`trailing_zeros()` comparison always rejects it. `grind_mask` now returns `None`
above 32 before constructing the digest prefix. Difficulty 32 retains an exact
all-bits mask; the pinned public `pow_bits <= 32` assertion remains unchanged.
Production difficulty, transcript, nonce ordering and protocol pins are unchanged.

Four deterministic regression tests compare SIMD masks to scalar semantics at
0, 1, 31, 32, 33, 64 and u32::MAX; reject unsupported internal calls before
reading the digest; and exercise the existing public guard for both BLAKE2s
output variants. Native parallel/serial and exact-byte browser validation are
recorded in the downstream evidence PR. Historical validation identities remain
attached to their original modules; they are not measurements of this correction.

The source ledger now identifies the implemented subsets from 69b8b037 and
74cca4d4 within this PR. Review execution uses GPT-6 agents; the source's consented
human credits and messages remain unchanged. Math review confirms equivalence to
the original u32 grinding predicate; human review and release remain outstanding.
