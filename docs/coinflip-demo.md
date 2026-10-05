# Browser CoinFlip demo

Based on `apps/coinflip` and `tests/contracts/src/lib.cairo` from
`starknet-innovation/snip-36-prover-backend` at
`4c8dfb1d0d63c47284e5da0ee1068415d47f9f78` (Apache-2.0).
The CoinFlip contract interface and implementation are preserved in
`contracts/coinflip/src/lib.cairo`. Scarb 2.15.2 bundles Cairo 2.15.0.

The default demo offers heads and tails for one fixed, recorded Sepolia round.
Both signed requests call `play(seed, player, bet)` against the same deployed
contract, player, and block. The executor acquires authenticated state, checks
account validation, executes Cairo, and produces a PIE. The recursive prover
runs in a separate memory64 Worker. No private key is delivered to the browser.

The contract emits a virtual L2-to-L1 message to placeholder address `0x1`:
`[player, seed, bet, outcome, won]`. The UI checks its sender and destination,
compares the inputs to the executed calldata, independently recomputes
`pedersen(seed, player) mod 2`, checks the match flag, and recomputes the
Poseidon message commitment in the virtual OS public output. An animated coin
is only presentation; it never determines the outcome.

This is a deterministic proof demonstration. A fixed public seed can be
inspected before choosing a side. The static site does not reproduce the
backend's session service, commit/reveal ordering, wallet deposits, or
CoinFlipBank settlement. There are no deposits or payouts. It makes no claim
of unpredictable or fair randomness. Executing, generating a proof, verifying
that proof, and submitting it on-chain are separate operations.

The existing daily Sepolia test continues to use its restricted balance-query
transaction. Its receipt is labeled as separate pipeline evidence; it is not
presented as acceptance of a CoinFlip proof.

## Reproduce

1. Build with Scarb 2.15.2: `scarb build` in `contracts/coinflip`.
2. Declare/deploy on Sepolia with the configured sncast account and record the
   public deployment in `evidence/coinflip-deployment.json`.
3. Set `STARKNET_ACCOUNT_ADDRESS` and `STARKNET_PRIVATE_KEY` only in a local
   process environment, then run `node scripts/capture-coinflip.mjs`.
   This prepares public signed inputs and launches Chromium with an explicit
   environment that excludes the key. It saves both execution captures under
   `fixtures/coinflip` without private signing material.
4. `npm run demo:build && npm run serve`.
5. `npm run demo:test` executes both recorded choices in actual Chromium and
   checks the Cairo PIE hashes and the displayed match results.

The fixture signatures authorize only the recorded virtual calls; do not reuse
stale requests as fresh network submissions. For live acquisition, prepare a
fresh signed CoinFlip request and its fixed block using your local account.
