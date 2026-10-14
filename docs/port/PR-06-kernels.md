# Evaluate portable arithmetic kernels in an independent profile

Add `prover-kernels`, built under `build/kernels`, for BLAKE2s compression in two
eight-lane groups, grind-prefix reuse, IFFT normalization fused into the final
pass, and deferred quotient reduction in groups of four products. Retain target
channel selection, proof-of-work parameters, transcript and FFT ordering.

These are selected mechanisms from 69b8b037 and 74cca4d4. Full fused commitment
layers, broader FFT changes and native allocator/page mechanisms are outside
this profile. The source's native AVX register argument does not establish a
WASM benefit. The retained disassembly confirms lowering to v128/i32x4/i64x2
instructions; wider portable vectors lower to multiple WASM operations.

Validation (before the PoW correction in review-pow-fix.md): 255 Stwo and 16
framework tests, plus three real browser recursive
proofs matching the pinned baseline bytes and accepted by the pristine 3035dd
verifier with tamper rejection. Raw browser smoke times are retained, but they
are not paired stable measurements and establish no isolated kernel gain.
CI, review and release remain outstanding. Exact source credit is retained in
the provenance ledger without copying model author trailers into this port.

After the PoW correction, the scoped kernel test run passed 257 tests; the final
module's browser and native validation is recorded in the evidence PR
(`validation-kernels-final.json`).
