import { getStarknet } from "@starknet-io/get-starknet-core";
import { CHAIN, hex, proofApiVersion } from "./live-core.mjs";
export async function discoverWallets() {
  return getStarknet().getAvailableWallets();
}
export async function connectWallet(wallet) {
  const enabled = await getStarknet().enable(wallet);
  const accounts = await enabled.request({ type: "wallet_requestAccounts" });
  if (!accounts.length) throw Error("Wallet returned no account");
  const chain = await enabled.request({ type: "wallet_requestChainId" });
  if (hex(chain) !== CHAIN)
    throw Error("Switch your wallet to Starknet Sepolia, then reconnect");
  let versions = [];
  try {
    versions = await enabled.request({ type: "wallet_supportedWalletApi" });
  } catch {}
  return {
    wallet: enabled,
    address: hex(accounts[0]),
    proofVersion: proofApiVersion(versions),
  };
}
export async function assertWallet(connection) {
  const accounts = await connection.wallet.request({
    type: "wallet_requestAccounts",
    params: { silent_mode: true },
  });
  const chain = await connection.wallet.request({
    type: "wallet_requestChainId",
  });
  if (
    !accounts.length ||
    hex(accounts[0]) !== connection.address ||
    hex(chain) !== CHAIN
  )
    throw Error("Wallet account or network changed; reconnect on Sepolia");
}
export async function invokeWallet(connection, calls, proof) {
  await assertWallet(connection);
  if (!connection.proofVersion)
    throw Error(
      "This wallet does not advertise Wallet API 0.10.3+ proof support. Update it or use a compatible wallet before depositing.",
    );
  const params = {
    invoke_transaction: calls,
    api_version: connection.proofVersion,
  };
  if (proof) params.proof = proof;
  return connection.wallet.request({
    type: "wallet_addInvokeTransaction",
    params,
  });
}
