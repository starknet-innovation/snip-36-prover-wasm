// Backend v1.4.0 / deps-v15 transaction-service profile. Keep pins.json in sync.
export const BACKEND_RELEASE = "v1.4.0";
export const SEQUENCER_REVISION = "148de44521b49e32c5a675e287572768932cc99e";
export const PROVING_REVISION = "e0035ffc8e08da270b8cb4a71f3708af70c2c775";
export const PROGRAM =
  "0x1c7be3225dfb33359b3ba9ffbe1542b7da27879b6d89f47b967e512463fd324";
export const PROOF_VERSION = "0x50524f4f4632"; // PROOF2
// Upstream privacy_common 2.4.0: version bytes followed by the circuit root.
export const PROOF_HEADER = Object.freeze(
  "020400098446bd35fd2272efe19bf43aac7037b3b7e25e86d94170d95198245bbb8dc7"
    .match(/../g).map((byte) => Number.parseInt(byte, 16)),
);

export function assertProofProfile(bytes) {
  if (!bytes || bytes.length <= PROOF_HEADER.length ||
      !PROOF_HEADER.every((byte, i) => bytes[i] === byte))
    throw Error("Proof does not use the pinned V2 circuit");
}

export function supportsProverProfile(config) {
  return config?.proof_version === PROOF_VERSION && config?.program_hash === PROGRAM;
}
