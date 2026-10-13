import { createHash } from "node:crypto";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const corpus = [
  ["balance", "fixtures/captured-execution.json"],
  ["coinflip-heads", "fixtures/coinflip/heads.json"],
  ["coinflip-tails", "fixtures/coinflip/tails.json"],
];
export function expectedPreimage(fixture, programHash) {
  // Single task, page size includes the two task header felts. Taken from the
  // committed executor fixture, never from the prover under test.
  if (!fixture.ok || fixture.kind !== "execution" || !Array.isArray(fixture.output))
    throw Error("Invalid recorded execution fixture");
  return ["0x1", `0x${(fixture.output.length + 2).toString(16)}`, programHash, ...fixture.output];
}
export function sameFelts(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((v, i) => BigInt(v) === BigInt(b[i]));
}
export function checkExecution(recorded, result, pie) {
  if (sha256(pie) !== recorded.report.pie_sha256 ||
      !sameFelts(recorded.output, result.output))
    throw Error("Offline execution differs from committed PIE/public output");
}
