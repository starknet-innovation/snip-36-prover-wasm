import { loadMemory64 } from "./sequencer-memory64.mjs";
self.onmessage = async ({ data: { id, pie } }) => {
  const start = performance.now(),
    send = (data) => self.postMessage({ id, ...data });
  try {
    if (!(pie instanceof ArrayBuffer) || !pie.byteLength)
      throw Error("Missing browser-generated PIE");
    const api = await loadMemory64(
      "./sequencer-prover.wasm",
      (message) => send({ kind: "panic", message }),
      (stage) => send({ kind: "stage", ...stage }),
    );
    let t = performance.now();
    api.init();
    const init_ms = performance.now() - t;
    send({ kind: "phase", phase: "recursive proving" });
    t = performance.now();
    const result = api.prove(new Uint8Array(pie)),
      prove_ms = performance.now() - t;
    const sha = async (b) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", b)),
        (x) => x.toString(16).padStart(2, "0"),
      ).join("");
    send({
      kind: "proof",
      ok: true,
      proof: Array.from(result.proof),
      output_preimage: result.output_preimage,
      report: {
        runtime: "browser Worker memory64",
        userAgent: navigator.userAgent,
        pie_sha256: await sha(pie),
        proof_sha256: await sha(result.proof),
        proof_bytes: result.proof.length,
        init_ms,
        prove_ms,
        total_ms: performance.now() - start,
        ...api.memory(),
        scope:
          "Sequencer transaction-service 3035dd recursive proving; native verification separate",
      },
    });
  } catch (error) {
    send({
      kind: "error",
      ok: false,
      error: String(error),
      stack: error.stack,
    });
  }
};
