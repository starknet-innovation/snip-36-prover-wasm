import {
  discoverWallets,
  connectWallet,
  invokeWallet,
  assertWallet,
} from "./wallet-client.mjs";
import {
  CHAIN,
  STRK,
  RPC,
  hex,
  selector,
  units,
  amount,
  newRound,
  validateRound,
  matchGame,
  readGame,
  rpc,
  virtualRequest,
  proofMaterial,
  depositCalls,
  revealCalls,
  settleCalls,
  outcome,
} from "./live-core.mjs";
import { PublicRunController } from "./public-run-controller.mjs";
const $ = (s) => document.querySelector(s);
let config,
  connection,
  round,
  currentGame,
  proof,
  choice = 0,
  busy = false,
  head = 0,
  refreshTask,
  timer,
  started,
  db;
const urls = [];
const storageKey = () => `snip36-live:${config.bank}:${connection.address}`;
function saved() {
  return JSON.parse(localStorage.getItem(storageKey()) || "[]");
}
function persist() {
  const entries = saved().filter((r) => r.id !== round.id);
  entries.unshift(round);
  localStorage.setItem(storageKey(), JSON.stringify(entries));
  if (!saved().some((r) => r.id === round.id))
    throw Error("Could not save recovery data");
}
const message = (text) => {
  $("#live-status").textContent = text;
  $("#action-status").textContent = text;
};
function downloadable(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  urls.push(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.textContent = "↓ " + name;
  $("#live-downloads").append(a);
}
async function proofDB(mode, value) {
  db ??= await new Promise((resolve, reject) => {
    const r = indexedDB.open("snip36-coinflip", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("proofs");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "proofs",
        mode === "get" ? "readonly" : "readwrite",
      ),
      store = tx.objectStore("proofs");
    const r =
      mode === "get"
        ? store.get(config.bank + round.id)
        : store.put(value, config.bank + round.id);
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
  });
}
function render() {
  const state = currentGame?.state ?? 0;
  $("#connect").disabled = busy;
  $("#connect").textContent = connection ? "Reconnect" : "Connect";
  $("#wallets").disabled = busy;
  $("#restore").disabled = busy;
  $("#live-state").textContent = busy
    ? "WORKING"
    : ([
        "READY",
        "DEPOSITED",
        "SEED LOCKED",
        "REVEALED",
        "SETTLED",
        "REFUNDED",
        "EXPIRED",
      ][state] ?? "UNKNOWN");
  $("#backup").disabled = !round;
  $("#new-round").disabled =
    busy || !round || round.pendingWallet || ![0, 4, 5, 6].includes(state);
  for (const n of ["heads", "tails"])
    $("#pick-" + n).disabled = !!round || busy;
  $("#stake").disabled = !!round || busy;
  $("#round-details").textContent = round
    ? JSON.stringify(
        {
          id: round.id,
          player: round.player,
          stake: units(round.amount),
          game: currentGame,
          transactions: round.transactions,
        },
        null,
        2,
      )
    : "No active round.";
  const stages = [state >= 2, state >= 3, !!proof, state === 4];
  for (let i = 1; i <= 4; i++)
    $("#live-step-" + i).className = stages[i - 1] ? "done" : "";
  let label = "Commit & deposit",
    enabled = !!connection?.proofVersion && $("#ready").checked && !busy;
  if (state === 1) {
    label = "Refund unmatched deposit";
    enabled &&= Date.now() / 1000 >= currentGame.deadline;
  }
  if (state === 2) {
    label =
      head >= currentGame.seed_block + 10
        ? "Reveal choice"
        : "Waiting for seed block";
    const expired = Date.now() / 1000 >= currentGame.deadline;
    if (expired) label = "Close expired round";
    enabled &&= expired || head >= currentGame.seed_block + 10;
    $("#seed-status").textContent =
      `Seed block ${currentGame.seed_block}; reveal from block ${currentGame.seed_block + 10}. Current closed block: ${head}. Reveal deadline: ${new Date(currentGame.deadline * 1000).toLocaleString()}.`;
  }
  if (state === 3) {
    label = proof ? "Settle with wallet" : "Generate browser proof";
    $("#seed-status").textContent = "Seed locked: " + currentGame.seed;
  }
  if ([4, 5, 6].includes(state)) {
    label = "Round complete";
    enabled = false;
  }
  if (!connection) label = "Connect a compatible wallet";
  else if (!connection.proofVersion) label = "Wallet proof support required";
  if (round?.pendingWallet) {
    label = "Check pending wallet transaction";
    enabled = false;
  }
  let stakeError = "";
  if (!round) {
    try {
      amount($("#stake").value);
    } catch (e) {
      stakeError = e.message;
    }
  }
  $("#stake").setAttribute("aria-invalid", String(!!stakeError));
  $("#stake-error").textContent = stakeError;
  if (stakeError) enabled = false;
  let hint = "";
  if (!connection) hint = "Connect your Starknet wallet on Sepolia first.";
  else if (!connection.proofVersion)
    hint =
      "Your wallet does not advertise proof submission support. Deposits are disabled.";
  else if (round?.pendingWallet)
    hint =
      "A wallet request is pending. Open your wallet to review it, or use Refresh status. Do not submit it again.";
  else if (busy)
    hint =
      "Working. Follow the status below; the wallet may ask you to confirm.";
  else if (stakeError) {
    hint = stakeError;
    label = "Enter a valid stake";
  } else if (!$("#ready").checked && ![4, 5, 6].includes(state)) {
    hint = "Check “I can finish this round” above to enable this button.";
    label = "Check the acknowledgement above";
  } else if (!enabled && state === 2)
    hint =
      "Waiting for the seed block. The button enables automatically when it is available.";
  else if (!enabled && state === 1)
    hint =
      "The unmatched deposit can be refunded after " +
      new Date(currentGame.deadline * 1000).toLocaleString() +
      ".";
  $("#action-hint").textContent = hint;
  $("#next").textContent = label;
  $("#next").disabled = !enabled;
  if (state === 4) {
    const result = outcome(currentGame),
      won = result === currentGame.choice;
    $("#live-coin").textContent = result === 0 ? "H" : "T";
    $("#result").textContent = won
      ? `Matched. ${units(BigInt(round.amount) * 2n)} test STRK paid to your wallet.`
      : "No match. The test-token pool receives this round’s stakes.";
  }
  renderHistory();
}
function renderHistory() {
  if (!connection || !config) return;
  const root = $("#history");
  root.replaceChildren();
  for (const r of saved()) {
    const row = document.createElement("div");
    row.className = "history-row";
    const info = document.createElement("div");
    info.textContent = `${r.choice === 0 ? "Heads" : "Tails"} · ${units(r.amount)} test STRK`;
    const sub = document.createElement("small");
    sub.textContent = r.id.slice(0, 16) + "…";
    info.append(sub);
    row.append(info);
    const b = document.createElement("button");
    b.textContent = "Resume";
    b.disabled = busy;
    b.onclick = () =>
      run(async () => {
        round = validateRound(r, connection.address, config.bank);
        proof = null;
        try {
          proof = await proofDB("get");
        } catch {}
        await refresh();
        if (proof) downloadable("coinflip-proof.json", proof);
      });
    row.append(b);
    for (const [name, t] of Object.entries(r.transactions ?? {})) {
      if (!t.hash) continue;
      const a = document.createElement("a");
      a.href = "https://sepolia.voyager.online/tx/" + hex(t.hash);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = name + " ↗";
      row.append(a);
    }
    root.append(row);
  }
  if (!root.childNodes.length)
    root.textContent = "No saved rounds for this wallet.";
}
async function refresh() {
  if (!config) return;
  if (refreshTask) return refreshTask;
  refreshTask = refreshState().finally(() => {
    refreshTask = null;
  });
  return refreshTask;
}
async function refreshState() {
  head = await rpc("starknet_blockNumber", []);
  const liquidity = await rpc("starknet_call", {
    block_id: "latest",
    request: {
      contract_address: config.bank,
      entry_point_selector: selector("liquidity"),
      calldata: [],
    },
  });
  $("#liquidity").textContent =
    "Bank available: " +
    units(BigInt(liquidity[0]) + (BigInt(liquidity[1]) << 128n)) +
    " test STRK";
  if (round) {
    currentGame = await readGame(config, round.id);
    matchGame(round, currentGame);
    if (round.pendingWallet && round.transactions[round.pendingWallet]?.hash) {
      try {
        const receipt = await rpc("starknet_getTransactionReceipt", {
          transaction_hash: round.transactions[round.pendingWallet].hash,
        });
        if (receipt.block_hash) {
          round.transactions[round.pendingWallet].receipt = receipt;
          round.pendingWallet = null;
          persist();
          if (receipt.execution_status !== "SUCCEEDED")
            message("Transaction reverted. Review the round before retrying.");
        }
      } catch (e) {
        if (e.code !== 29) throw e;
      }
    }
    if (round.pendingWallet) {
      const threshold = {
        deposit: 2,
        reveal: 3,
        settle: 4,
        refund: 5,
        expire: 6,
      }[round.pendingWallet];
      if (currentGame.state >= threshold) {
        round.pendingWallet = null;
        persist();
      }
    }
    round.last_state = currentGame.state;
    persist();
  }
  render();
}
async function run(fn) {
  if (busy) return;
  busy = true;
  render();
  try {
    await fn();
  } catch (e) {
    message(e.message || String(e));
  } finally {
    busy = false;
    render();
  }
}
async function walletTx(name, calls, material) {
  await assertWallet(connection);
  round.pendingWallet = name;
  persist();
  render();
  message("Confirm " + name + " in your wallet.");
  let response;
  try {
    response = await invokeWallet(connection, calls, material);
  } catch (e) {
    if (
      [113, 4001].includes(e.code) ||
      /refus|reject|denied/i.test(e.message ?? "")
    ) {
      round.pendingWallet = null;
      persist();
    }
    throw e;
  }
  const hash = hex(response.transaction_hash);
  round.transactions[name] = { hash };
  persist();
  message("Submitted. Waiting for a closed-block receipt: " + hash);
  for (let i = 0; i < 100; i++) {
    try {
      const r = await rpc("starknet_getTransactionReceipt", {
        transaction_hash: hash,
      });
      if (
        r.block_hash &&
        ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"].includes(r.finality_status)
      ) {
        round.transactions[name].receipt = r;
        round.pendingWallet = null;
        persist();
        if (r.execution_status !== "SUCCEEDED")
          throw Error("Transaction reverted: " + (r.revert_reason ?? hash));
        await refresh();
        return r;
      }
    } catch (e) {
      if (e.code !== 29) throw e;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw Error(
    "Still pending. Use Refresh status; do not send another transaction.",
  );
}
const controller = new PublicRunController({
  save: async (receipt) => {
    if (receipt.kind === "execution") {
      downloadable("coinflip-execution.json", receipt);
      message("Execution finished. Generating the recursive proof…");
    } else {
      proofMaterial(receipt, config, round, currentGame);
      proof = receipt;
      downloadable("coinflip-proof.json", receipt);
      try {
        await proofDB("put", receipt);
      } catch {
        message(
          "Proof generated, but browser storage is full. Download it before leaving.",
        );
      }
    }
  },
  onStatus: (data) => {
    if (data.kind === "error") {
      clearInterval(timer);
      busy = false;
      $("#stop").disabled = true;
      $("#live-coin").classList.remove("spinning");
      message(data.error);
      render();
    } else if (data.kind === "cancelled") {
      clearInterval(timer);
      busy = false;
      $("#stop").disabled = true;
      $("#live-coin").classList.remove("spinning");
      message(
        "Proving stopped. Your on-chain round is unchanged; resume when ready.",
      );
      render();
    } else if (data.phase) message(data.phase);
  },
  onComplete: (receipt) => {
    clearInterval(timer);
    busy = false;
    $("#stop").disabled = true;
    $("#live-coin").classList.remove("spinning");
    $("#live-proof-size").textContent =
      (receipt.report.proof_bytes / 1024).toFixed(1) + " KB";
    message(
      "Proof generated locally. Review and submit settlement in your wallet.",
    );
    render();
  },
});
async function prove() {
  const header = await rpc("starknet_getBlockWithTxHashes", {
      block_id: "latest",
    }),
    nonce = await rpc("starknet_getNonce", {
      block_id: { block_hash: header.block_hash },
      contract_address: config.executor,
    });
  const request = virtualRequest(config, currentGame, nonce);
  busy = true;
  proof = null;
  $("#stop").disabled = false;
  $("#live-coin").classList.add("spinning");
  started = performance.now();
  timer = setInterval(
    () =>
      ($("#live-elapsed").textContent =
        ((performance.now() - started) / 1000).toFixed(0) + " s"),
    1000,
  );
  controller.start(request, {
    endpoint: RPC,
    block_id: { block_hash: header.block_hash },
  });
  render();
}
$("#next").onclick = () =>
  run(async () => {
    message("Checking your wallet account and network…");
    await assertWallet(connection);
    message("Checking the round on Sepolia…");
    await refresh();
    if (round?.pendingWallet)
      throw Error(
        "A wallet submission is unresolved. Refresh its status before continuing.",
      );
    if (!round) {
      round = newRound(
        connection.address,
        config.bank,
        choice,
        $("#stake").value,
      );
      persist();
      downloadable("coinflip-recovery.json", round);
      currentGame = { state: 0 };
    }
    const state = currentGame?.state ?? 0;
    $("#connect").disabled = busy;
    $("#wallets").disabled = busy;
    $("#restore").disabled = busy;
    if (state === 0) {
      await walletTx("deposit", depositCalls(round));
      message(
        "Commitment deposited and stake matched. Wait for the future seed block.",
      );
    } else if (state === 1) {
      await walletTx("refund", [
        {
          contract_address: config.bank,
          entry_point: "refund_unmatched",
          calldata: [round.id],
        },
      ]);
    } else if (state === 2 && Date.now() / 1000 >= currentGame.deadline) {
      await walletTx("expire", [
        {
          contract_address: config.bank,
          entry_point: "expire_unrevealed",
          calldata: [round.id],
        },
      ]);
      message("Expired round closed. Its test stakes remain in the bank pool.");
    } else if (state === 2) {
      await walletTx("reveal", revealCalls(round));
      message("Choice revealed. You can now generate the proof.");
    } else if (state === 3 && proof) {
      const material = proofMaterial(proof, config, round, currentGame);
      if (head < proof.anchor.header.block_number + 10)
        throw Error(
          "Wait until block " +
            (proof.anchor.header.block_number + 10) +
            " before submitting this proof.",
        );
      await walletTx("settle", settleCalls(round, currentGame), material);
      message("Settlement confirmed on Sepolia.");
    } else if (state === 3) {
      await prove();
    }
  }).then(() => {
    if (controller.active) {
      busy = true;
      render();
    }
  });
$("#stop").onclick = () => controller.cancel();
$("#ready").onchange = render;
$("#stake").oninput = render;
$("#refresh").onclick = () => run(refresh);
$("#new-round").onclick = () => {
  round = null;
  proof = null;
  currentGame = null;
  $("#live-coin").textContent = "?";
  $("#result").textContent = "Choose a side for a new round.";
  $("#seed-status").textContent = "";
  $("#live-downloads").replaceChildren();
  urls.splice(0).forEach(URL.revokeObjectURL);
  render();
};
for (const [name, side] of [
  ["heads", 0],
  ["tails", 1],
])
  $("#pick-" + name).onclick = () => {
    choice = side;
    $("#pick-heads").setAttribute("aria-pressed", String(side === 0));
    $("#pick-tails").setAttribute("aria-pressed", String(side === 1));
  };
$("#backup").onclick = () => {
  downloadable("coinflip-recovery.json", round);
  $("#live-downloads a:last-child").click();
};
$("#restore").onchange = () =>
  run(async () => {
    if (!connection)
      throw Error("Connect the wallet that owns the round first");
    const f = $("#restore").files[0];
    if (!f || f.size > 1024 * 1024) throw Error("Recovery file too large");
    round = validateRound(
      JSON.parse(await f.text()),
      connection.address,
      config.bank,
    );
    persist();
    proof = null;
    try {
      proof = await proofDB("get");
    } catch {}
    await refresh();
    message("Round restored.");
  });
let wallets = [];
$("#connect").onclick = () =>
  run(async () => {
    const wallet = wallets[Number($("#wallets").value)];
    if (!wallet)
      throw Error(
        "No Starknet wallet found. Install a wallet with proof-bearing transaction support.",
      );
    message("Connecting to " + wallet.name + "…");
    connection = await connectWallet(wallet);
    round = null;
    currentGame = null;
    proof = null;
    $("#wallet-status").textContent =
      connection.address.slice(0, 12) +
      "… · " +
      (connection.proofVersion
        ? "Proof API " + connection.proofVersion
        : "Proof submission unsupported; deposits disabled");
    if (!connection.proofVersion)
      message(
        "Update your wallet or choose one that supports Wallet API 0.10.3+ proof submission.",
      );
    else
      message(
        "Wallet connected on Sepolia. Choose a side and review the stake.",
      );
    await refresh();
  });
async function init() {
  try {
    const response = await fetch("./live-config.json");
    if (!response.ok) throw Error("Live contracts are not configured");
    config = await response.json();
    if (
      config.chain_id !== CHAIN ||
      hex(await rpc("starknet_chainId", [])) !== CHAIN
    )
      throw Error("Sepolia configuration mismatch");
    const bankConfig = await rpc("starknet_call", {
      block_id: "latest",
      request: {
        contract_address: config.bank,
        entry_point_selector: selector("get_config"),
        calldata: [],
      },
    });
    if (
      hex(bankConfig[1]) !== hex(config.coinflip) ||
      hex(bankConfig[2]) !== STRK
    )
      throw Error("On-chain bank configuration mismatch");
    for (const key of ["bank", "executor"])
      if (
        hex(
          await rpc("starknet_getClassHashAt", {
            block_id: "latest",
            contract_address: config[key],
          }),
        ) !== hex(config[key + "_class_hash"])
      )
        throw Error("Contract class mismatch");
    for (const [label, key] of [
      ["Bank", "bank"],
      ["CoinFlip", "coinflip"],
      ["Public executor", "executor"],
    ]) {
      const a = document.createElement("a");
      a.href = "https://sepolia.voyager.online/contract/" + config[key];
      a.textContent = label + " ↗";
      $("#contract-links").append(a);
    }
    wallets = await discoverWallets();
    $("#wallets").replaceChildren();
    if (!wallets.length) {
      const o = new Option("No wallet detected", "");
      $("#wallets").append(o);
    }
    wallets.forEach((w, i) =>
      $("#wallets").append(new Option(w.name, String(i))),
    );
    await refresh();
    if (!connection && !busy)
      message("Connect a proof-capable Starknet wallet on Sepolia.");
    setInterval(() => {
      if (!busy && !document.hidden) refresh().catch((e) => message(e.message));
    }, 10000);
  } catch (e) {
    message(e.message);
  }
}
window.coinflipLive = {
  get state() {
    return { round, currentGame, proof, busy };
  },
};
init();
