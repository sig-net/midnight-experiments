// Deploy flow for the ECDSA experiment contract, using the generic plumbing in
// @sig-net/midnight-contract-deploy (same shape as the xcontract-events deploy
// flows). Requires `yarn compile:zk` output (verifier keys) in
// src/managed/ecdsa. The constructor pins the MPC attestation key, so the
// caller must pass the secp256k1 public key the contract should accept.

import type { Secp256k1Point } from "@midnight-ntwrk/compact-runtime";

import {
  assertDeployerFunded,
  buildDeployTransaction,
  deriveAccountKeys,
  getDeployConfig,
  submitUnprovenTransaction,
  withSyncedWalletFacade,
  type TransactionIdentifier,
} from "@sig-net/midnight-contract-deploy";

import { ecdsaCompiledContract } from "./providers.ts";
import { createEcdsaPrivateState } from "./witnesses.ts";

/** The outcome of a successful deployment. */
export interface Deployment {
  /** Address of the deployed contract on Midnight. */
  contractAddress: string;
  /** Identifier of the submitted deploy transaction. */
  txId: TransactionIdentifier;
}

/**
 * Deploy the ECDSA experiment contract, sealing the attestation key's hash as
 * its constructor argument.
 *
 * @param mpcPk - The secp256k1 public key whose signatures the contract will accept.
 * @param env - Environment map providing `DEPLOYER_SEED` and the shared Midnight node config (see `getMidnightNodeConfig`).
 * @returns The deployed contract address and deploy transaction id.
 */
export async function deployEcdsa(
  mpcPk: Secp256k1Point,
  env: Record<string, string | undefined> = process.env,
): Promise<Deployment> {
  const deployConfig = getDeployConfig(env);
  const { networkId } = deployConfig.midnightNodeConfig;
  const accountKeys = deriveAccountKeys(deployConfig.deployerSeed, networkId);

  console.log(`deploying ecdsa-experiment to ${networkId} (${deployConfig.midnightNodeConfig.nodeUrl})`);

  const { contractAddress, txId } = await withSyncedWalletFacade(
    accountKeys,
    deployConfig.midnightNodeConfig,
    async (facade, state) => {
      assertDeployerFunded(state);
      const deployTransaction = await buildDeployTransaction(
        ecdsaCompiledContract,
        networkId,
        accountKeys.shieldedSecretKeys.coinPublicKey,
        createEcdsaPrivateState(),
        mpcPk,
      );
      console.log(`ecdsa-experiment address (pre-submit): ${deployTransaction.contractAddress}`);
      const submittedTxId = await submitUnprovenTransaction(facade, accountKeys, deployTransaction.serializedTransaction);
      return { contractAddress: deployTransaction.contractAddress, txId: submittedTxId };
    },
  );

  console.log(`deployed ecdsa-experiment at ${contractAddress} (tx ${txId})`);
  return { contractAddress, txId };
}
