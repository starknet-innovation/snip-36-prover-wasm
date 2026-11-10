# Regenerate preprocessed columns from compact owned sources

Eligible preprocessed columns retain compact sources instead of stripes.
Quotients regenerate at most sixteen source columns at once. Source ownership
is an explicit Arc; the proof owns its values. Source-aware transitions and
cleanup skip empty evaluations. Two initial browser failures exposed missing
empty-storage cases; both failures and their fixes are retained with regression
coverage of a complete sourced PCS proof.

Validation: original/regenerated columns, interpolated polynomials, roots, samples, quotients and openings compare equal. A complete sourced PCS proof covers empty-storage transitions and cleanup. Three recursive browser proofs match the original pinned proof bytes and pass unchanged native verification and proof/statement tamper tests. Raw failed attempts are retained. CI, review and release remain outstanding.
