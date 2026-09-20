import { fileURLToPath } from "node:url";

import { findDeployedContract } from "@midnight-ntwrk/midnight-js/contracts";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type { WalletFacade } from "@midnightntwrk/wallet-sdk-facade";

import {
  buildExperimentProviders,
  createCrossContractProofServerProvider,
  createEmptyPrivateState,
  deployWithFacade,
  makeVacantCompiledContract,
  type AccountKeys,
  type EmptyPrivateState,
  type MidnightNodeConfig,
  type NetworkId,
} from "@midnight-experiments/lib";
import { contractAddressFromHex } from "@sig-net/midnight";

import { Contract as BreakContract } from "./managed/break/contract/index.js";

export * as Break from "./managed/break/contract/index.js";

export type BreakCircuitId = keyof InstanceType<typeof BreakContract>["provableCircuits"] & string;
export const BREAK_PRIVATE_STATE_ID = "exp-break-break";
export type BreakPrivateStateId = typeof BREAK_PRIVATE_STATE_ID;

export const breakManagedPath = fileURLToPath(new URL("./managed/break", import.meta.url));

// The published signet contract's compiled output (keys/, zkir/). Must be the
// build deployed at SIGNET_CONTRACT_ADDRESS, as the proof provider matches each
// call to a compiled contract by verifier key.
const signetContractManagedPath = fileURLToPath(
  new URL("./managed", import.meta.resolve("@sig-net/midnight-contract")),
);

export const breakCompiledContract = makeVacantCompiledContract<
  BreakContract<EmptyPrivateState>,
  EmptyPrivateState
>("break-break", BreakContract, breakManagedPath);

/** Address the break contract seals as its `SignetSigner` reference. */
export const SIGNET_CONTRACT_ADDRESS = "0xb37b9ce8bb468e60159504e502f6400cb5184e681e642003f4a23322839bc68b";

/** Deploy the break contract through an already-open facade, sealing {@link SIGNET_CONTRACT_ADDRESS}. */
export async function deployBreak(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(
    facade,
    keys,
    networkId,
    breakCompiledContract,
    createEmptyPrivateState(),
    contractAddressFromHex(SIGNET_CONTRACT_ADDRESS),
  );
}

/**
 * The midnight-js provider set for the break contract, proving across break
 * and the signet contract it calls.
 *
 * @param facade - A started (and synced) wallet facade that pays for the calls.
 * @param keys - The key material of the same wallet.
 * @param config - The Midnight network endpoints to run against.
 */
export function buildBreakProviders(facade: WalletFacade, keys: AccountKeys, config: MidnightNodeConfig) {
  const breakZkConfigProvider = new NodeZkConfigProvider<BreakCircuitId>(breakManagedPath);
  return buildExperimentProviders<BreakCircuitId, BreakPrivateStateId>(
    facade,
    keys,
    config,
    "exp-break",
    breakZkConfigProvider,
    // Must list a zk-config provider for every contract a break circuit calls into.
    createCrossContractProofServerProvider(config.proofServerUrl, [
      breakZkConfigProvider,
      new NodeZkConfigProvider<string>(signetContractManagedPath),
    ]),
  );
}

/**
 * Find the deployed break contract, ready for `callTx.<circuit>(...)`.
 *
 * @param providers - From {@link buildBreakProviders}.
 * @param contractAddress - Where {@link deployBreak} put the contract.
 */
export async function findDeployedBreak(providers: ReturnType<typeof buildBreakProviders>, contractAddress: string) {
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract: breakCompiledContract,
    privateStateId: BREAK_PRIVATE_STATE_ID,
    initialPrivateState: createEmptyPrivateState(),
  });
}
