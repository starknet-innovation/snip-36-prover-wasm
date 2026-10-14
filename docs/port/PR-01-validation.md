# Pin local circuit resolution and validate exact browser prover bytes offline

Browser proof receipts previously did not identify the loaded module, and source
preparation left circuit packages in Cargo's Git cache. Pin a local circuit
checkout with root overrides and a retained candidate lock, reject stale prepared
trees, preserve an isolated baseline build and unchanged native verifier graph,
and retain successful modules by SHA256.

Add an offline real-PIE harness that reexecutes committed captures, checks trusted
PIE/output identities, pins the exact bytes served and instantiated, verifies
against independently expected statements, and runs proof/statement tamper
controls. Module identity and checked memory64 ranges have negative tests.

Validation: 64 JS tests; eight executor-manifest tests; two preparation/resolution
guard tests; Chromium Worker and demo/UI checks; all three source-built baseline
and candidate-control recursive proofs verified natively with tamper rejection
and byte-identical differential results. Raw evidence and identities are under
`artifacts/port/`; summaries and exact commands are in `docs/port/`. CI is not yet
run. No asset manifest or release was changed.
