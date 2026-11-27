# Proving a caller-supplied virtual transaction

`scripts/browser-e2e.mjs` and `scripts/e2e.mjs` are tied to the repository's own Sepolia balance-query flow. Two generic scripts cover any other contract. They hold no key, sign nothing and send no transaction; the only network access is the browser's read-only RPC acquisition.

- `scripts/custom-input.mjs` writes `RUN_DIR/browser-input.json` (`{request, source}`) for one call or for raw account calldata.
- `scripts/custom-run.mjs` runs that request through the same page and Workers as the demo, in headless Chromium, and saves the results.

## Commands

```sh
npm ci --ignore-scripts
npm run demo:build                 # downloads the modules, builds the page runtime
npx playwright install chromium
export RUN_DIR=artifacts/my-run        # one fresh directory per attempt

# 1. Build the request (use a block a few blocks behind the head).
npm run custom:input -- --network sepolia --sender ACCOUNT --nonce NONCE \
  --block-hash BLOCK_HASH --to CONTRACT --function NAME --calldata 0x1,0x2

# 2. Check the trace size first, then prove.
npm run custom:run -- --execution-only
npm run custom:run -- --timeout-minutes 60
```

`custom:input` options:

| Option | Meaning |
| --- | --- |
| `--network sepolia\|mainnet` | Chain ID, fee tokens and endpoint allow-list. Default `sepolia`. |
| `--sender`, `--nonce` | Account that runs the virtual transaction and its nonce at the chosen block. |
| `--block-hash` or `--block-number` | The fixed block the proof is anchored to. Exactly one is required. |
| `--to`, `--function` or `--selector`, `--calldata` or `--calldata-file` | One call, encoded as an `Array<Call>` of length one: `[1, to, selector, len, ...calldata]`. |
| `--raw-calldata-file` | A JSON array holding the account's whole `__execute__` calldata, for several calls or a non-standard account. |
| `--signature` | Comma-separated felts. Default `0x0`: the executor rejects an empty signature even when the account does not check it. |
| `--l2-gas` | `l2_gas.max_amount`. Default 117,440,512, as in the repository's flows. The virtual OS caps the execute phase at 1,110,000,000 Sierra gas, so a larger value buys nothing. |
| `--endpoint` | One of the network's URLs accepted by `web/anchored-rpc.mjs`. Default: the first. |
| `--out`, `--force` | Target directory (default `RUN_DIR`, then `artifacts/run`); `--force` replaces an existing request. |

Felts are `0x` hex or decimal. Prices and tip are always zero, as the executor requires on input. `custom-input.mjs` also exports `buildInput()` and `callArray()` for use from another script. The account's `__validate__` runs as part of execution, so a request for an account that checks a signature needs a real one: sign the request yourself, outside these scripts, and pass it with `--signature`.

`custom:run` refuses to start when `STARKNET_PRIVATE_KEY` is set. `--timeout-minutes` bounds the whole browser run (default 20). When proving, it hashes `web/sequencer-prover.wasm`, serves exactly those bytes, and requires the proof receipt to name them (`PROVER_SHA256` pins an expected hash). It does not run the offline-replay or invalid-signature controls of `browser-e2e.mjs`: the second requires an account that rejects a bad signature, which a caller's account may not do. To replay a saved run offline, use `{"request": ..., "source": {"capture": ...}}` built from its `execution.json`.

## Outputs

Each run first deletes all of the files below from `RUN_DIR`, in either mode, so the directory never mixes the outputs of two requests: after `--execution-only`, or after a run that fails, no proof file is present.

| File | Content |
| --- | --- |
| `execution.json` | Execution receipt without the PIE bytes: request, RPC capture, anchor, executor report, virtual OS output. |
| `cairo-pie.zip` | The Cairo PIE; its SHA-256 is checked against the receipt. |
| `execution-resources.json` | `virtual_os`: steps, memory holes and builtin instance counts of the whole virtual OS run, which is what the prover's trace must hold. `transaction`: Blockifier's figures for the transaction alone, with gas and per-call builtin and syscall counts summed over validate, execute and inner calls. |
| `proof.json` | Proof receipt (not written with `--execution-only`). |
| `proof.base64` | The proof as one base64 string. |
| `proof-facts.txt` | Comma-separated proof facts, from `proofFacts()` in `scripts/transaction.mjs`. |

The last two are the files Starknet Foundry 0.60 or later accepts. Signing and sending remain a separate step that you run yourself:

```sh
sncast --account ACCOUNT invoke --network sepolia --contract-address CONTRACT \
  --function NAME --calldata ... \
  --proof-file $RUN_DIR/proof.base64 --proof-facts-file $RUN_DIR/proof-facts.txt
```

## Observed limits

Measured on one machine (Apple M3 Max, headless Chromium, low-memory V2 prover module) with one family of SHA-256-heavy contracts on Sepolia. They are observations, not guarantees, and other workloads will hit other limits first.

- Four executions of 1.2M to 1.5M Cairo steps proved in about 125 s each, using 4 to 5 GB, and their proofs were accepted on Sepolia.
- An execution of 1.77M steps with 769 SHA-256 blocks proved in 125 s with 5.25 GB of Wasm linear memory.
- An execution of 2.49M steps failed in the prover with `RuntimeError: unreachable` shortly after the "Generate the cairo proof" stage. This is consistent with the fixed 2^20-row per-component trace of the small proof profile, but the cause was not confirmed.
- Each `sha256_process_block` cost about 2,040 steps and about 226 bitwise builtin instances in the real trace.

Run `--execution-only` first and read `virtual_os` in `execution-resources.json` before spending minutes on a proof.

Mainnet requests can be built and their state read, but mainnet proving and acceptance have not been validated with these scripts. The executor compiles the Sierra classes it meets, so a contract compiled with a Cairo version newer than the pinned compiler fails during execution with a compiler error.
