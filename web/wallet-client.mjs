import { getStarknet } from "@starknet-io/get-starknet-core";
import { CHAIN, hex, proofApiVersion } from "./live-core.mjs";
export async function discoverWallets() {
  return getStarknet().getAvailableWallets();
}
export async function connectWallet(wallet, onStatus = () => {}) {
  // A successful account request is the wallet's connection authorization.
  // Do not gate it on a redundant wallet_getPermissions response.
  const enabled = wallet;
  let accounts = await enabled.request({
    type: "wallet_requestAccounts",
    params: { silent_mode: false },
  });
  if (!Array.isArray(accounts) || !accounts.length)
    throw Error("Wallet returned no account");
  let chain = await enabled.request({ type: "wallet_requestChainId" });
  if (hex(chain) !== CHAIN) {
    onStatus("Approve the switch to Starknet Sepolia in your wallet.");
    try {
      await enabled.request({
        type: "wallet_switchStarknetChain",
        params: { chainId: CHAIN },
      });
    } catch (cause) {
      throw new Error(
        "The wallet could not switch to Sepolia. Approve the network switch, or switch manually and reconnect.",
        { cause },
      );
    }
    chain = await enabled.request({ type: "wallet_requestChainId" });
    if (hex(chain) !== CHAIN)
      throw Error("Switch your wallet to Starknet Sepolia, then reconnect");
  }
  // Network changes can select a different account; read it after switching.
  accounts = await enabled.request({
    type: "wallet_requestAccounts",
    params: { silent_mode: true },
  });
  if (!Array.isArray(accounts) || !accounts.length)
    throw Error("Wallet returned no account");
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
