import { PublicRunController } from "./public-run-controller.mjs";
const $ = (s) => document.querySelector(s);
let timer,
  started,
  sequence = 0;
const urls = [];
const size = (n) => (n ? `${(n / 1024).toFixed(1)} KB` : "—");
const step = (name, state) => {
  $("#step-" + name).className = state;
};
function finish(label) {
  clearInterval(timer);
  $("#state").textContent = label;
  $("#run").disabled = false;
  $("#cancel").disabled = true;
}
function download(name, data, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  urls.push(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.textContent = "↓ " + name;
  $("#downloads").append(a);
}
const controller = new PublicRunController({
  save: async (data) => {
    window.receipts.push(data);
    if (window.saveReceipt) await window.saveReceipt(data);
    if (data.kind === "execution") {
      step("state", "done");
      step("execution", "done");
      $("#pie-size").textContent = size(data.report.pie_bytes);
      download("execution.json", JSON.stringify(data));
      download("cairo-pie.zip", new Uint8Array(data.pie), "application/zip");
    } else {
      step("proof", "done");
      $("#proof-size").textContent = size(data.report.proof_bytes);
      download("proof.json", JSON.stringify(data));
      download(
        "proof.bin",
        new Uint8Array(data.proof),
        "application/octet-stream",
      );
    }
  },
  onStatus: (data) => {
    if (data.kind === "error") {
      window.runError = data.error;
      finish("ERROR");
      $("#status").textContent =
        data.error +
        " Check the input, RPC availability, browser support, and available memory.";
    } else if (data.kind === "cancelled") {
      finish("CANCELLED");
      $("#status").textContent = "Worker stopped. You can start a new run.";
    } else {
      $("#status").textContent =
        data.phase ||
        data.message ||
        (data.kind === "stage"
          ? "Recursive prover is working…"
          : "Loading Wasm…");
      if (data.phase?.includes("virtual")) step("execution", "active");
      if (data.phase?.includes("recursive") || data.kind === "stage")
        step("proof", "active");
    }
  },
  onComplete: (data) => {
    window.runComplete = data;
    finish("COMPLETE");
    $("#details").textContent = JSON.stringify(
      { anchor: data.anchor, report: data.report, output: data.output },
      null,
      2,
    );
    $("#status").textContent =
      data.kind === "execution"
        ? "Execution complete. Signature and state witnesses checked; Cairo PIE ready. No recursive proof was requested."
        : "Recursive proof generated locally. Download it for verification or signing and submission with the CLI. This run has not been submitted on-chain.";
  },
});
window.startRun = (request, source, options = {}) => {
  window.runError = null;
  window.runComplete = null;
  window.receipts = [];
  urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  $("#downloads").replaceChildren();
  ["state", "execution", "proof"].forEach((n) => step(n, ""));
  step("state", "active");
  $("#pie-size").textContent = "—";
  $("#proof-size").textContent = "—";
  $("#details").textContent = "Running…";
  const id = controller.start(request, source, options);
  if (controller.active) {
    $("#state").textContent = "RUNNING";
    $("#run").disabled = true;
    $("#cancel").disabled = false;
    started = performance.now();
    clearInterval(timer);
    timer = setInterval(
      () =>
        ($("#elapsed").textContent =
          ((performance.now() - started) / 1000).toFixed(1) + " s"),
      1000,
    );
  }
  return id;
};
$("#mode").onchange = () => {
  $("#advanced").hidden = $("#mode").value !== "live";
  $("#source-note").textContent =
    $("#mode").value === "replay"
      ? "Replays historical state, not today's account balance. Nothing is submitted to the network."
      : "Fetches public witnesses from Sepolia for your signed request at a fixed block. Signing and submission happen separately.";
};
$("#full-proof").onchange = () => {
  $("#run").innerHTML = $("#full-proof").checked
    ? "Execute & prove <span>↗</span>"
    : "Run execution <span>↗</span>";
};
$("#run").onclick = async () => {
  const generation = ++sequence;
  $("#run").disabled = true;
  $("#cancel").disabled = false;
  $("#status").textContent = "Preparing inputs…";
  try {
    let request, source;
    if ($("#mode").value === "replay") {
      const response = await fetch("./demo-data/sample.json");
      if (!response.ok) throw Error("Could not load the Sepolia sample");
      ({ request, source } = await response.json());
    } else {
      const input = $("#request").value;
      if (/private.?key|mnemonic|seed.?phrase/i.test(input))
        throw Error(
          "Private keys and recovery phrases must never be entered here",
        );
      request = JSON.parse(input);
      if (BigInt(request.captured_chain_id) !== 0x534e5f5345504f4c4941n)
        throw Error("Only Sepolia requests are supported");
      const endpoint = new URL($("#endpoint").value);
      if (endpoint.protocol !== "https:")
        throw Error("Use an HTTPS RPC endpoint");
      const raw = $("#block").value;
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
        throw Error(
          "Enter the fixed block number used to prepare your request",
        );
      source = {
        endpoint: endpoint.href,
        block_id: { block_number: Number(raw) },
      };
    }
    if (generation !== sequence) return;
    window.startRun(request, source, {
      executionOnly: !$("#full-proof").checked,
    });
  } catch (e) {
    if (generation !== sequence) return;
    window.runError = String(e);
    finish("ERROR");
    $("#status").textContent = String(e);
  }
};
$("#cancel").onclick = () => {
  sequence++;
  controller.cancel();
  finish("CANCELLED");
  $("#status").textContent = "Run cancelled. Workers stopped.";
};
$("#check-chain").onclick = async () => {
  const button = $("#check-chain");
  button.disabled = true;
  $("#chain-status").textContent = "Reading the receipt from Sepolia…";
  try {
    const e = await fetch("./demo-data/evidence.json");
    if (!e.ok) throw Error("Evidence unavailable");
    const evidence = await e.json();
    const rpc = async (method, params) => {
      const r = await fetch(
        "https://api.zan.top/public/starknet-sepolia/rpc/v0_10",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!r.ok) throw Error("RPC HTTP " + r.status);
      const j = await r.json();
      if (j.error) throw Error(j.error.message);
      return j.result;
    };
    const chain = await rpc("starknet_chainId", []);
    if (BigInt(chain) !== 0x534e5f5345504f4c4941n)
      throw Error("Unexpected network");
    const receipt = await rpc("starknet_getTransactionReceipt", {
      transaction_hash: evidence.onchain.transaction_hash,
    });
    if (
      receipt.transaction_hash !== evidence.onchain.transaction_hash ||
      receipt.execution_status !== "SUCCEEDED" ||
      !["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"].includes(receipt.finality_status)
    )
      throw Error("Receipt does not confirm successful acceptance");
    $("#chain-status").textContent =
      `Live RPC confirmation: ${receipt.execution_status} · ${receipt.finality_status} · block ${receipt.block_number.toLocaleString()}.`;
  } catch (e) {
    $("#chain-status").textContent =
      "Live check unavailable: " +
      e.message +
      ". The recorded receipt and explorer link remain available.";
  } finally {
    button.disabled = false;
  }
};
const supported =
  typeof WebAssembly === "object" &&
  typeof Worker === "function" &&
  !!globalThis.crypto?.subtle;
$("#compatibility").textContent = supported
  ? "Execution supported. For full proving, use recent desktop Chromium with memory64 support and sufficient RAM."
  : "This browser lacks required WebAssembly, Worker, or secure-context support.";
if (!supported) $("#run").disabled = true;
