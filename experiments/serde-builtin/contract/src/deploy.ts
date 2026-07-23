// Deploy flow, using the generic plumbing in @sig-net/midnight-contract-deploy
// (same shape as the other experiments). Requires `yarn compile:zk` output
// (verifier keys) in src/managed/serde-builtin.

import {
  assertDeployerFunded,
  buildDeployTransaction,
  deriveAccountKeys,
  getDeployConfig,
  submitUnprovenTransaction,
  withSyncedWalletFacade,
  type TransactionIdentifier,
} from "@sig-net/midnight-contract-deploy";

import { serdeCompiledContract } from "./providers.ts";
import { createSerdePrivateState } from "./witnesses.ts";

/** The outcome of a successful deployment. */
export interface Deployment {
  /** Address of the deployed contract on Midnight. */
  contractAddress: string;
  /** Identifier of the submitted deploy transaction. */
  txId: TransactionIdentifier;
}

/**
 * Deploy the serde-builtin contract. No constructor args.
 *
 * @param env - Environment map providing `DEPLOYER_SEED` and the shared Midnight node config (see `getMidnightNodeConfig`).
 * @returns The deployed contract address and deploy transaction id.
 */
export async function deploySerde(env: Record<string, string | undefined> = process.env): Promise<Deployment> {
  const deployConfig = getDeployConfig(env);
  const { networkId } = deployConfig.midnightNodeConfig;
  const accountKeys = deriveAccountKeys(deployConfig.deployerSeed, networkId);

  console.log(`deploying serde-builtin to ${networkId} (${deployConfig.midnightNodeConfig.nodeUrl})`);

  const { contractAddress, txId } = await withSyncedWalletFacade(
    accountKeys,
    deployConfig.midnightNodeConfig,
    async (facade, state) => {
      assertDeployerFunded(state);
      const deployTransaction = await buildDeployTransaction(
        serdeCompiledContract,
        networkId,
        accountKeys.shieldedSecretKeys.coinPublicKey,
        createSerdePrivateState(),
      );
      console.log(`serde-builtin address (pre-submit): ${deployTransaction.contractAddress}`);
      const submittedTxId = await submitUnprovenTransaction(
        facade,
        accountKeys,
        deployTransaction.serializedTransaction,
      );
      return { contractAddress: deployTransaction.contractAddress, txId: submittedTxId };
    },
  );

  console.log(`deployed serde-builtin at ${contractAddress} (tx ${txId})`);
  return { contractAddress, txId };
}
