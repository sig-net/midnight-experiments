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

import { Contract as Break2Contract } from "./managed/break-2/contract/index.js";

export * as Break2 from "./managed/break-2/contract/index.js";

export type Break2CircuitId = keyof InstanceType<typeof Break2Contract>["provableCircuits"] & string;
export const BREAK_2_PRIVATE_STATE_ID = "exp-break-2";
export type Break2PrivateStateId = typeof BREAK_2_PRIVATE_STATE_ID;

export const break2ManagedPath = fileURLToPath(new URL("./managed/break-2", import.meta.url));

// The published signet contract's compiled output (keys/, zkir/). Must be the
// build deployed at SIGNET_CONTRACT_ADDRESS, as the proof provider matches each
// call to a compiled contract by verifier key.
const signetContractManagedPath = fileURLToPath(
  new URL("./managed", import.meta.resolve("@sig-net/midnight-contract")),
);

export const break2CompiledContract = makeVacantCompiledContract<
  Break2Contract<EmptyPrivateState>,
  EmptyPrivateState
>("break-2", Break2Contract, break2ManagedPath);

/** Address the break-2 contract seals as its `SignetSigner` reference. */
export const SIGNET_CONTRACT_ADDRESS = "0xb37b9ce8bb468e60159504e502f6400cb5184e681e642003f4a23322839bc68b";

/** Deploy the break-2 contract through an already-open facade, sealing {@link SIGNET_CONTRACT_ADDRESS}. */
export async function deployBreak2(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(
    facade,
    keys,
    networkId,
    break2CompiledContract,
    createEmptyPrivateState(),
    contractAddressFromHex(SIGNET_CONTRACT_ADDRESS),
  );
}

/**
 * The midnight-js provider set for the break-2 contract, proving across break-2
 * and the signet contract it calls.
 *
 * @param facade - A started (and synced) wallet facade that pays for the calls.
 * @param keys - The key material of the same wallet.
 * @param config - The Midnight network endpoints to run against.
 */
export function buildBreak2Providers(facade: WalletFacade, keys: AccountKeys, config: MidnightNodeConfig) {
  const break2ZkConfigProvider = new NodeZkConfigProvider<Break2CircuitId>(break2ManagedPath);
  return buildExperimentProviders<Break2CircuitId, Break2PrivateStateId>(
    facade,
    keys,
    config,
    "exp-break-2",
    break2ZkConfigProvider,
    // Must list a zk-config provider for every contract a break-2 circuit calls into.
    createCrossContractProofServerProvider(config.proofServerUrl, [
      break2ZkConfigProvider,
      new NodeZkConfigProvider<string>(signetContractManagedPath),
    ]),
  );
}

/**
 * Find the deployed break contract, ready for `callTx.<circuit>(...)`.
 *
 * @param providers - From {@link buildBreak2Providers}.
 * @param contractAddress - Where {@link deployBreak2} put the contract.
 */
export async function findDeployedBreak2(providers: ReturnType<typeof buildBreak2Providers>, contractAddress: string) {
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract: break2CompiledContract,
    privateStateId: BREAK_2_PRIVATE_STATE_ID,
    initialPrivateState: createEmptyPrivateState(),
  });
}
