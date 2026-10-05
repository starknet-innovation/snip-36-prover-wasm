# Daily Sepolia E2E

The `daily-sepolia.yml` workflow runs at06:00UTC and can be manually dispatched frommain. Its `sepolia` GitHub environment must restrict deployment branches to `main`, with:

- Environment variable `STARKNET_ACCOUNT_ADDRESS`: an existing compatible funded Sepolia account.
- Environment secret `STARKNET_PRIVATE_KEY`: its signing key, stored only as an encrypted GitHub Actions secret.

The repository's initial setup uses the sncast account explicitly authorized by the user. No private key or account store belongs in Git, release assets, browser inputs or workflow artifacts. Key injection is limited to the two local signing steps; the browser and submission steps reject a key-bearing environment. Never enable this workflow on pull requests or use `pull_request_target` to run untrusted checkout code with these credentials.

Run manually with `gh workflow run daily-sepolia.yml --ref main`. Watch the run until a receipt is saved; a submitted hash alone is not success. Public RPC: `https://api.zan.top/public/starknet-sepolia/rpc/v0_10`; gateway: `https://alpha-sepolia.starknet.io/gateway/add_transaction`. The browser accesses the public RPC directly, and the submission script checks the chain is `SN_SEPOLIA`.

The fixed fee ceiling is25testnetSTRK, with resource-price limits twice the fresh block price. The gateway receives one proof-bearing balance query; no deployment or transfer path is implemented. Fund the account outside this workflow when its balance is insufficient. There is no automatic faucet or top-up.

## Nonces and failure recovery

Workflow concurrency serializes this repository's runs; GitHub concurrency does **not** span repositories. The06:00schedule is separated from the reference backend's08:00daily run. The account can still be used elsewhere. A pending nonce at preparation or a changed nonce during proving/before broadcast fails safely; it never silently re-signs a second transaction.

The signed transaction and expected hash are uploaded as a `submission-plan-*` artifact **before** broadcast. `submission-intent.json` is written before the single gateway request. On timeout or ambiguous transport failure, inspect that exact hash on Sepolia before any retry. Do not delete intent files and blindly rerun submission. A fresh daily run can use a later nonce; it does not repair or resubmit an ambiguous previous run automatically.

A successful receipt must be `SUCCEEDED`, included in a closed block, and `ACCEPTED_ON_L2` or `ACCEPTED_ON_L1`. Returned signed fields must match the submitted payload; the observed nonce and fee are checked. Balance delta equality is recorded separately because another legitimate transfer could affect a shared account. The current RPC's transaction-read schema may omit proof/proof_facts: linkage uses the signed SNIP-36 hash, saved payload, gateway response and receipt. Trace availability and L1 finality are not success requirements.

## Local automated use

```sh
npm ci --ignore-scripts
npm run assets
npx playwright install chromium
# Inject STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY using your local secret manager.
npm run e2e:prepare
# Remove STARKNET_PRIVATE_KEY from the environment before running the browser.
npm run e2e:browser
# Inject the key only for this local signing step.
npm run e2e:sign
# Preserve artifacts/run/submission-plan.json and signed-payload.json before broadcast.
# No key in the submit process:
npm run e2e:submit
```

A fresh `RUN_DIR` is required per attempt. Do not rerun preparation over an existing signed run. The full live E2E is intentionally separate from `npm test`.


## Live wallet CoinFlip test

After the balance-query test, the same workflow runs `scripts/live-e2e.mjs`. This additional test uses a Node Wallet API adapter backed by the protected account, and an explicit Chromium child environment without the signing key. It commits/deposits 0.001 test STRK, waits for the fixed future block, reveals, proves in browser Workers and submits the proof with settlement. Each transaction has a 25 test STRK maximum fee ceiling. No contract deployment or automatic bank top-up runs in CI.

The adapter journals signed intents before broadcasting and restricts browser requests to the expected bank/token calls for the current game. Live proof and receipt artifacts are uploaded separately. A successful adapter run does not establish compatibility with an installed wallet extension. See [live architecture and recovery](live-coinflip.md).
