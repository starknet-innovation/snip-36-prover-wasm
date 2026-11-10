# Review corrections

Review-fix work started at local SHA `e91865dbb51ee925e93cb2c35171764e701f55de`.
The stack remains draft. Protocol pins, release assets and the installed default
sourced module (`41a6f536…`) are unchanged.

## Findings and changes

- PR #3: source preparation exposes optional profiles only when their patches
  exist; an unreceipted source tree must be pristine before any patches apply.
  Baseline identities enumerate receipt trees and record actual Cargo-resolved
  Git circuit packages instead of hashing a missing checkout. Missing source
  directories fail identity generation.
- PR #3: browser metadata in CI and documented commands now uses
  `--no-default-features`, matching the source build. Locked baseline/candidate
  graphs still match, and the native verifier remains on pristine Git sources.
- PR #3: shared proof/verification budgets give each child 31 minutes: 20 for
  the Worker, three 120-second native checks, and five minutes of overhead.
  The campaign checks its declared proof budget against the harness.
- PR #8: unsupported private BLAKE grinding difficulties above 32 return no
  solution before digest access. The existing public assertion remains intact.
  The source ledger identifies the implemented kernel subsets in this PR.
- PR #9: a verifier panic (exit 101 or panic stderr) and signal termination fail
  boundary checks. Missing output parents are created; existing final output
  directories remain exclusive and cannot be overwritten.
- PR #9: missing, empty or incomplete evidence roots fail before creating output.
  Required artifacts include benchmark registration/attempts/summary, all three
  final proofs and receipts, and all three boundary manifests/journals/results.

Testing also exposed two issues during this correction. The kernel patch had
unrelated hunks reverting the striped foundation's checked FFT contracts,
serial fallbacks and block tests; those hunks are removed while retaining the
IFFT scaling kernel. Packaging live logs could make index hashes disagree with
archived bytes; each archive entry and its digest now use one byte snapshot.

## Local validation

- Fresh pinned kernel preparation, warm receipt reuse and locked Cargo graph
  comparison pass with actual build feature selection.
- Stwo parallel and serial release suites each pass all 265 tests, including the
  four new grinding boundary tests and preserved transposed-block FFT test.
- Seven Python prover guard/identity/packaging tests, 66 JavaScript tests, eight
  executor manifest tests and Worker security tests pass.
- Native helper unit tests cover panic/signal/ordinary-error classification and
  exclusive nested output creation. All three real-proof boundary suites pass
  535 cases each: three accepted positive controls and 1,602 rejected negative
  cases, with no panics or signals. The verifier SHA remains `2b987807…`.
- Scoped agent math review approves the exact original u32 grinding predicate
  and preservation of the foundation FFT invariants. This is not human review.

Exact candidate identity, real PIE browser verification and raw artifact hashes
are recorded in [review-fixes.json](review-fixes.json). This correction is not a
new paired performance campaign. Historical module measurements and the failed
baseline-versus-sourced time gate retain their original identities and conclusions.

Raw logs retain the initial rustup sandbox failure, initial native invocation
that selected zero tests without the prover feature, the serial compile errors
before preservation of the foundation hunks, the successful intermediate module
build, and the initial archive snapshot inconsistency. These are superseded by
the correctly selected native suites, final build and snapshot-safe package check;
they are not silently counted as successful final validation.

## Additional double-check

A second pass found the same panic-as-rejection weakness in the offline browser
harness's two native tamper controls. Its shared `isOrdinaryVerifierRejection`
predicate now rejects exit 101, panic stderr, signals, killed processes, missing
executables and invalid exit statuses. Regression tests cover these cases.
Nine fresh native verifier calls (three positive controls and six negative
controls) pass with the stricter classification. The earlier controls all exited
normally with code 1; their recorded rejection evidence remains valid.

The second pass also revalidated every member size and digest in both retained
evidence archives, all three proof binaries against the original baseline, the
candidate/default module and verifier identities, and the fresh prepared source
receipt. Seven Python prover tests and all 67 JavaScript tests pass. No prover
source or module bytes changed in this additional correction. See
[double-check.json](double-check.json) for the fresh controls and artifact checks.
