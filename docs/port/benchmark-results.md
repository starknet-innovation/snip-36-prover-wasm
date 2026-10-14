# Measured browser memory/time tradeoff

The final sourced candidate passed all 36 attempts and the registered stability gate, but failed the time acceptance gate on every workload. It is not eligible for promotion under this plan. No source-native performance ratios were transferred.

| Workload | Baseline proof time | Candidate proof time | Paired time ratio | Requested Rust peak (baseline → candidate) | Linear memory (baseline → candidate) |
|---|---:|---:|---:|---:|---:|
| balance | 51.33s | 76.84s | 1.496 | 13.829 → 4.912GB | 14.100 → 5.948GB |
| coinflip-heads | 54.13s | 79.24s | 1.467 | 13.826 → 4.912GB | 14.367 → 5.939GB |
| coinflip-tails | 63.48s | 88.64s | 1.396 | 13.826 → 4.912GB | 14.367 → 5.944GB |

Times and memory values are per-role medians; ratios are medians of paired candidate/baseline measurements. GB is decimal. Requested Rust peak ratios are 0.3552; linear-memory ratios are 0.413–0.422. Prove-time ratios are 1.396–1.496. All measured time CVs are below 0.56%, against the declared 5% gate. Acceptance required time ≤ 1.05 and requested/linear memory ≤ 0.85; the memory gates pass, the time gate fails.

Initialization medians fall from 3.98–4.03s to 1.74–1.76s. Fresh-Worker totals rise from 55.49/58.29/67.57s to 78.74/81.13/90.51s for balance/heads/tails. Module load includes fetch, hash, compilation and instantiation. Exact additional medians and paired ratios are in [benchmark-results.json](benchmark-results.json).

The campaign registered one warmup pair plus five measured pairs per workload, alternating role order, fresh Worker and child browser per attempt, twenty-minute proof timeout, all-attempt success and 5% time-CV gates. All 36 attempts passed independent native verification plus proof/statement tamper rejection, loaded the declared module bytes, and produced baseline-identical proof hashes. The stopped initial campaign retains both warmup attempts and its interruption reason; no ratios are reported for it.

Host: ARM64 macOS, 32 GiB RAM, low-power mode 0. Rust nightly-2026-01-15 (1.94 nightly 86a49fd71), LLVM 21.1.8, Node 24.18.1, Chromium 153.0.8010.12, Playwright 1.63.0. Build flags, source/patch digests, dependency identities, host/power records and corpus hashes are captured in registration/source identities. Source-built baseline SHA: `dc87c868e66f4ba4aa331a010076f6cd6fe9ab8e02a13354d9eda7a208b4b184`; candidate SHA: `41a6f536d5d24ba7bb8ccb416d937e87f2a90abb88b43a644c67a4d65ad39db6`.

Requested allocations exclude allocator overhead, fragmentation, JavaScript and transient underlying realloc storage. Peaks are cumulative per fresh instance, not separate init/proving peaks. Linear memory does not shrink on free. Process data is 500ms sampled summed Chromium-family RSS, may double-count shared pages and miss transient peaks; it is not private memory or a hard peak.

Scope is three retained authenticated balance/CoinFlip executions on one host/browser. The larger upstream privacy fixture is smaller in steps than balance; no independently expected larger Sepolia input was available. Two successful same-instance proofs around malformed input return to the same live-byte count and, in the final run, same linear size; an earlier lifecycle run grew linear memory by 67MB, so long-run stability is not established. Malformed PIE fails before ownership transfer; a proving-stage WASM trap requires Worker termination.

D and E remain independently built and locally verified profiles. Their smoke runs do not establish isolated stable gains. D has the same requested peak as C on this corpus. Current dense backend Merkle retention, coefficient-regrowth openings, one-column source sampling and temporary initial stripe retention are remaining performance limitations. These are selected portable adaptations, not the entire native frontier tree.

Existing CI checks and new fresh preparation/resolution checks pass on the draft stack. Native mathematical/unit suites, candidate recursive-proof validation and these paired measurements are local evidence. Human final review, candidate recursive-proof CI, live Sepolia acceptance and release promotion remain outstanding. Assets/checksums and protocol pins are unchanged.

See [EVIDENCE.md](EVIDENCE.md) for raw artifacts and exact commands.
