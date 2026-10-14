# Compute commitments and compatible composition in stripes

Commit eligible columns in smaller evaluation blocks, retain a sufficient
polynomial representation, compose compatible components in blocks, and regrow
values needed for sampling, quotients and openings. Nonzero mask offsets keep
whole-domain access. Preserve target optional lifting sizes, proof-of-work,
logup batching, disabled components and the original arithmetic/FFT kernels.

Validation: 255 Stwo and 16 framework tests; CPU differential composition with
positive/negative masks; mixed-size roots, samples, boundary/repeated openings
and forced omitted layers; three
recursive browser proofs per checkpoint byte-identical to the original pinned
prover, accepted by the pristine native verifier with tamper rejection. Raw
single-run time and allocation/memory/RSS observations are retained. Stable
paired measurements, CI, review and release remain separate gates.
