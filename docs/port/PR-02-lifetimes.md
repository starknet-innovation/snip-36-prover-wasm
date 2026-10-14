# Reduce simultaneous circuit preprocessing and witness residency

Keep circuit-only preprocessing and its commitment out of the Cairo leg. Transfer
finalized context values directly to the proof call and drop gates, Cairo proof
intermediates and unpacked BLAKE inputs after their last consumer. The circuit
prover drops owned values after writing the base trace. Repeated initialization
reuses the existing instance setup; failed proofs clear prior exported output.

Latency cost: circuit preprocessing and its commitment now run inside every proof
instead of once at initialization. A Worker that proves repeatedly pays that
setup each time (the final paired campaign shows init falling from about 4.0 s to
1.8 s, with that work moved into prove). The peak effect of transient wide views
for non-wide columns (qm31_ops holds eight at once) has not been measured
separately.

Build compact preprocessing directly with checked u32 storage, packed booleans,
formula-generated lookup tables and a wider fallback. Existing witness slice APIs
use component-local wide views; their transient expansion remains a limitation.
Target blinding then `finalize_context` remains in its original order. No global
value-handoff mutex, process-lifetime ManuallyDrop, allocator replacement or
native page advice is introduced.

Validation: four circuit-common tests, twelve circuit-prover tests including
sequential ownership/error isolation, and three exact-byte browser recursive
proofs. All match the baseline proof bytes and pass the pristine 3035dd verifier
and tamper controls. Single smoke timings are retained but do not satisfy the
preregistered benchmark campaign. Source participants and collaborators are
recorded in the provenance ledger. CI, review and release are outstanding.
