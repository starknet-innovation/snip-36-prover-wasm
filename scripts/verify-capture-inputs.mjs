import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { replayProvider, canonical, felt } from "../web/anchored-rpc.mjs";
const equal = (a, b, label) => {
  if (canonical(a) !== canonical(b))
    throw Error(label + " differs from RPC capture");
};
export async function validateCaptureForExecution(execution) {
  const { capture, proof_input: input, class_input: classes } = execution;
  const rpc = await replayProvider(capture),
    discovery = capture.records.find(
      (r) => r.method === "starknet_getBlockWithTxHashes",
    );
  if (!discovery) throw Error("Missing captured discovery");
  await rpc.resolve(discovery.params.block_id);
  equal(rpc.anchor, execution.anchor, "Anchor");
  equal(rpc.anchor.header, input.header, "Header");
  if (
    felt(input.block_hash) !== felt(rpc.anchor.header.block_hash) ||
    felt(input.state_root) !== felt(rpc.anchor.header.new_root)
  )
    throw Error("Input root/anchor differs");
  if (felt(execution.request.captured_chain_id) !== felt(rpc.anchor.chain_id))
    throw Error("Request chain differs");
  equal(
    (await rpc.getStorageProof(input.query)).proof,
    input.proof,
    "Patricia proof",
  );
  for (const read of input.storage_reads) {
    const actual = await rpc.read({
      kind: "storage",
      address: read.address,
      key: read.key,
    });
    if (felt(actual.value) !== felt(read.value))
      throw Error("Storage read differs from capture");
  }
  for (const item of classes)
    equal(await rpc.getClass(item.class_hash), item.class, "Class");
  return {
    capture_digest_checked: true,
    execution_inputs_match_capture: true,
    chain_id: rpc.anchor.chain_id,
    block_hash: rpc.anchor.header.block_hash,
    scope:
      "Recorded RPC provenance and exact replay; cryptographic authentication is a separate native check",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const receipt = JSON.parse(await readFile(process.argv[2], "utf8"));
  console.log(
    JSON.stringify(await validateCaptureForExecution(receipt), null, 2),
  );
}
