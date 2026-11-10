# Architecture and provenance

The browser's wasm32 executor authenticates the captured header hash, Patricia nodes/paths, contract leaves, storage reads and class commitments, compiles Sierra with the pinned Cairo compiler, and invokes pinned Blockifier/virtual OS code. Missing cache entries produce explicit demand reads; unknown state never becomes an assumed zero. Every live read and storage proof uses one block hash. Captures have canonical SHA256 identities and support offline replay.

Execution, witnesses and PIE are generated in a browser Worker. The PIE moves to a separate memory64 Worker running `privacy_recursive_prove`. This includes the privacy bootloader, Cairo proof, recursive circuit construction/proof, upstream blinding, version prefix and compression. Portability changes replace a temporary file with an in-memory sink, avoid native thread-pool wrappers in Wasm, and provide an explicit memory64 ABI with bounded views. No remote/native prover supplies browser proving work.

`pins.json` identifies backend v1.4.0 / deps-v15, sequencer `148de44521`, and its transaction-service prover from `starkware-libs/proving` at `e0035ffc8`. V2 uses the upstream monorepo circuit and blinding defaults. Browser patches handle transport and target portability; the former V1 memory-pool patch is removed. The native diagnostic verifier uses the unpatched same V2 revision.

V2 proof bytes start with the upstream 2.4.0 version and 32-byte preprocessed circuit root. Browser signing paths check this header, `PROOF2`, and virtual-OS program `0x1c7be3225dfb33359b3ba9ffbe1542b7da27879b6d89f47b967e512463fd324`. Header checks establish profile compatibility; proof verification remains a separate operation. CoinFlip deposits require matching configured and on-chain bank profiles.

Historical provenance: the V1 backend at `4c8dfb1d` called a sequencer at `e6b6fd2e` using proving-utils `3035dd`. Its standalone utility used `0a97f45`; the recorded V1 network test rejected that profile while accepting `3035dd`. Those receipts remain historical evidence and do not apply to V2.

The executor patches also preserve the native64 Sierra fallthrough sentinel when compiling for wasm32. Ordinary indices use checked conversion. Source package layering is explicit and pinned; the fixed public-scalar fixture patch is test-only and is not the daily signing account. The native verifier example wraps the unchanged V2 verifier and accepts a V2 proof with its bootloader output preimage.

The web controller terminates Workers on cancellation and ignores stale messages/errors, including races during receipt persistence. The test suite covers anchored/mixed inputs, corrupted classes/storage/captures, missing state, cancellation, signing hash extension, and proof program identity. The daily live run adds actual account validation, invalid signature, offline replay and network acceptance.
