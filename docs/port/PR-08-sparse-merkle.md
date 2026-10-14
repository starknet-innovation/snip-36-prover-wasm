# Omit the lowest Merkle layers in the memory profile

Measuring first: [peak_profile.rs](../../native/peak_profile.rs) records the
requested-heap peak inside every tracing span of a native, single-threaded
proof. On balance it reproduces the browser candidate's peak (4.913 vs 4.912 GB)
and proof hash, so it is a 70-second memory and byte-identity check.

The profile put the memory profile's 4.91 GB peak in the circuit proof's FRI
commit, with every commitment tree still holding all its Merkle layers (about
512 MiB per tree at lifting size 2^23), and each striped commit transiently
holding stripe and merged layers (+1.07 GB).

The SIMD backend now implements `build_layers_sparse`: the leaves and the four
inner layers above them are each dropped once the next layer is built, so trees
keep about 1/32 of their hashes. The prover already recomputes omitted hashes
at decommitment (striped trees included); FRI layer decommits now pass their
columns so packed FRI trees can too. This is the fork's sparse-layer mechanism
(`FUSED_LEVELS = 5`, from c38b7e27), adapted without its fused tiling. Roots,
openings and proof bytes are unchanged; no verifier, channel or protocol code
changes.

Of frontier f2498dc7 (66670df), its headline change, eight blocks per stripe
for striped commits, was measured and not kept: circuit commits fell from 1.85
to 1.44 GB but the global peak did not move and proving was about 8% slower.
Its other mechanisms (circuit lookup narrowing, composition window, striped FRI,
Cairo tuple narrowing) were not ported; see the profile for where the peak now
sits.

Validation: 260 stwo and 9 framework tests, including a new SIMD-vs-CPU test of
sparse roots, openings and hash witnesses. All three native and browser proofs
match the baseline bytes, pass the pristine 3035dd verifier and reject proof and
statement tampering.

Paired campaign (`benchmark-sparse-merkle-01.json`, 36/36 attempts passed,
baseline `40d01657…`, candidate `036597e8…`):

| Workload | Prove time ratio | Rust requested peak | Linear memory |
|---|---:|---:|---:|
| balance | 1.458 | 13.83 → 2.31 GB (0.167) | 14.10 → 3.25 GB (0.230) |
| coinflip-heads | 1.428 | 13.83 → 2.31 GB (0.167) | 14.37 → 3.31 GB (0.230) |
| coinflip-tails | unstable | 13.83 → 2.31 GB | 14.37 → 3.36 GB |

coinflip-tails failed the 5% time-CV gate on both roles (about 17.5%): from its
fourth measured pair both roles slowed 20–40% while Spotlight indexing ran on the
host, so the plan reports no ratios for it. Memory gates pass everywhere; the
time gate fails as for the previous candidate, so this remains an opt-in profile.
Compared with the previous memory profile, the requested peak falls from 4.91 to
2.31 GB and linear memory from about 5.9 to 3.3 GB at the same proving time.
