# Wallet CoinFlip on Sepolia

Open `play.html` on GitHub Pages. The browser discovers wallets with the official `@starknet-io/get-starknet-core` package. Your wallet authorizes actual transactions; the site never receives its key. The bank is prefunded with test STRK, so matching a stake requires no online bank signer.

## Flow

1. Connect on Sepolia with a wallet advertising Wallet API 0.10.3 or later in the 0.10 series. The [Wallet API specification](https://github.com/starkware-libs/starknet-specs/blob/master/wallet-api/wallet_rpc.json) provides a proof attachment on `wallet_addInvokeTransaction`. Individual extensions may impose additional restrictions. The test adapter verifies the protocol path, not every wallet implementation.
2. Choose heads/tails and a stake up to 0.01 test STRK. The browser saves a random reveal nonce and Pedersen commitment before requesting a transaction. Approval is exactly the stake. Approval, deposit and matching execute atomically, so exhausted liquidity reverts the whole transaction.
3. The contract fixes a future block. After ten further blocks, reveal with the same wallet. The seed is Poseidon(session, future block hash). Reveal within 24 hours; otherwise the stake is forfeited. This is a public test demonstration, not a claim of unbiased gambling randomness or a security audit.
4. Generate a proof in the browser. A separate, permissionless executor allows only one call to the fixed CoinFlip contract, binary choice and zero fee prices on Sepolia. It has no key and cannot transfer tokens. Public zero signature placeholders satisfy the transport's nonempty signature shape; the real executor's on-chain validation still runs. No wallet signature is needed for this public computation.
5. Submit settlement with the wallet. The proof attachment contains bytes, output and proof facts. The bank checks the admitted proof's program, version, message sender, player, seed, choice and outcome. Matching choices pay twice the stake; otherwise the two stakes replenish the pool. A proofless settlement is rejected. Network fees are separate.

The CoinFlip computation preserves upstream `play(seed, player, bet)` and its virtual message to `0x1`. The virtual message is proof output; no actual L1 message transaction is needed. This bank differs from upstream's owner-authorized settlement by enforcing proof facts itself.

## Recovery

Download the recovery JSON after committing. It includes the reveal secret, not a signing key; keep it private until reveal. Local history is scoped to bank and wallet. Reconnect and select Resume, or restore the file. Proofs are cached in IndexedDB and downloadable. Storage loss can be recovered with the file and a fresh public proof. A revealed round has no settlement expiry in this demo.

A transaction hash is saved immediately when the wallet returns it. Pending submissions disable repeat actions across reloads; Refresh checks the receipt and authoritative game state. If the wallet never returns a hash, inspect its activity before taking further action. The application intentionally leaves ambiguous submissions blocked, except settlement: if the wallet does not answer a proof-bearing settlement within 5 minutes, the page unblocks and points to the command-line fallback below. A duplicate settlement can only revert, because the round is no longer revealed; it cannot pay twice. An unmatched standalone deposit can be refunded after one hour; normal UI deposits match atomically. Unrevealed matched rounds can be expired permissionlessly through `expire_unrevealed` after the deadline.

### Settling from the command line

Some wallets advertise Wallet API 0.10.3+ but never answer a proof-bearing invocation. Settlement is permissionless and always pays the recorded player, so any funded Sepolia account can submit the proof instead:

```sh
npm run settle -- coinflip-proof.json coinflip-recovery.json          # dry run: checks state and proof binding
SNCAST_ACCOUNT=<name> npm run settle -- coinflip-proof.json coinflip-recovery.json --send
```

It signs locally with the named sncast account (or `STARKNET_ACCOUNT_ADDRESS`/`STARKNET_PRIVATE_KEY`), caps the fee at 25 test STRK, journals the signed intent in `artifacts/settle/` to prevent rebroadcast, and waits for the receipt.

## Contracts and tests

Public addresses and class hashes: `web/live-config.json`. V2 deployment and accepted settlement: `evidence/v2-bank-deployment.json`. Historical V1 receipts: `evidence/live-deployment.json`. The bank uses Cairo/Scarb 2.18 for Sierra 1.8's proof-facts syscall. The public executor uses Scarb 2.15.2 / Cairo 2.15.0 for compatibility with the pinned browser compiler. The original recorded CoinFlip contract remains deployed unchanged.

`npm test` checks statement binding, recovery and amount boundaries. `npm run demo:test:live` runs browser checks for unsupported wallets, wrong networks and pending-transaction recovery, without submitting transactions.

`npm run e2e:coinflip` runs an actual funded Sepolia round through the UI and a test Wallet API adapter. It uses `STARKNET_ACCOUNT_ADDRESS` / `STARKNET_PRIVATE_KEY` in Node, or the local sncast account store when no key environment variable is present. Chromium receives an explicit environment without signing credentials. The adapter accepts only the expected bounded CoinFlip calls and journals signed intents before a single broadcast. This test is not evidence of an installed extension's compatibility. Set `NATIVE_VERIFIER` to the unchanged V2 `spike_native` binary for an additional native verification check. Never delete an ambiguous intent to rerun it blindly.

The daily workflow runs the live game after the existing balance-query test, at 06:00 UTC. Artifacts include round recovery, signed intents, browser proof and closed-block settlement receipt. Test funding is finite; exhaustion fails the test and requires manual replenishment. No automatic bank top-up or deployment occurs.

## V2 deployment

The default configuration uses the V2 bank at
[`0xa7326f4400c58184b197ff34a66a5b6d5acce50123d7133d85a88da482db9e`](https://sepolia.voyager.online/contract/0xa7326f4400c58184b197ff34a66a5b6d5acce50123d7133d85a88da482db9e).
It was declared/deployed with Scarb 2.18 from release commit `ca98c373`, funded
with 1 test STRK, and checked for its owner, fixed CoinFlip contract, token,
class hash and V2 proof profile. The original CoinFlip computation and public
executor remain deployed unchanged.

A funded 0.001-test-STRK round completed deposit/match, reveal, browser proving,
unchanged native verification and proof-bearing settlement in closed Sepolia
block **17,969,259**. A proofless settlement was rejected. The proved result was
a loss, so both stakes replenished the pool; this run does not exercise a winning
payout. [Public deployment, receipts and validation](../evidence/v2-bank-deployment.json).
The daily CoinFlip check is enabled by this compatible configuration.

## Legacy V1 rounds

[Recover an earlier V1 round](https://starknet-innovation.github.io/snip-36-prover-wasm/play.html?bank=v1)
loads `web/legacy-live-config.json` and the original bank's wallet-scoped saved
history. Restore files are still checked against that bank. New V1 deposits,
reveals and V2 proving/settlement are disabled there; refund and expiry actions
remain available where the on-chain state permits them. Return to the normal
page for new V2 games.

The pre-cutover scan at block **17,968,904** checked 38 deposited rounds and found
three revealed, unsettled V1 rounds (0.001 test STRK per stake; 0.006 test STRK in
combined escrow). They remain on the original bank without a settlement expiry;
no escrow or game state was migrated. Their public IDs and states are retained
in the V2 deployment evidence. Preserve recovery files and use compatible V1
proving/settlement tooling for these rounds; the current V2 prover cannot settle
them. The historical V1 source is retained at commit `397985e` and the V1 binary
release is `v0.1.0`. V1 network admission was not retested by this V2 deployment.
