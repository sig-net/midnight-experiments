// midnight-js provider set + compiled-contract binding, modeled on the other
// single-contract experiments (witness-less setup).

import { fileURLToPath } from "node:url";

import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type { MidnightProviders } from "@midnight-ntwrk/midnight-js/types";
import type { WalletFacade } from "@midnightntwrk/wallet-sdk-facade";

import {
  createCrossContractProofServerProvider,
  createWalletAndMidnightProvider,
} from "@midnight-experiments/lib";
import {
  makeVacantCompiledContract,
  type AccountKeys,
  type MidnightNodeConfig,
} from "@sig-net/midnight-contract-deploy";

import { Contract as SerdeContract } from "./managed/serde-builtin/contract/index.js";
import { type SerdePrivateState } from "./witnesses.ts";

/** Provable circuit ids, straight from the generated contract. */
export type SerdeCircuitId = keyof InstanceType<typeof SerdeContract>["provableCircuits"] & string;

/** Private-state store key. */
export type SerdePrivateStateId = "serde-builtin";
export const SERDE_PRIVATE_STATE_ID: SerdePrivateStateId = "serde-builtin";

export type SerdeProviders = MidnightProviders<SerdeCircuitId, SerdePrivateStateId, SerdePrivateState>;

// Compiler output dir (contract/, keys/, zkir/), the zk-config root.
const serdeManagedPath = fileURLToPath(new URL("./managed/serde-builtin", import.meta.url));

/** Compiled-contract binding (witness-less, so vacant witnesses). */
export const serdeCompiledContract = makeVacantCompiledContract<
  SerdeContract<SerdePrivateState>,
  SerdePrivateState
>("serde-builtin", SerdeContract, serdeManagedPath);

/**
 * Build the midnight-js provider set for the deployed contract.
 *
 * @param facade - A started (and synced) wallet facade.
 * @param keys - The key material of the same wallet, for balancing and signing.
 * @param config - The Midnight network endpoints to run against.
 * @returns The provider set to hand to `findDeployedContract`.
 */
export function buildSerdeProviders(
  facade: WalletFacade,
  keys: AccountKeys,
  config: MidnightNodeConfig,
): SerdeProviders {
  const zkConfigProvider = new NodeZkConfigProvider<SerdeCircuitId>(serdeManagedPath);
  const walletAndMidnightProvider = createWalletAndMidnightProvider(facade, keys);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: "serde-builtin-private-states",
      signingKeyStoreName: "serde-builtin-signing-keys",
      accountId,
      privateStoragePasswordProvider: () => "&*(BHJqwe419-serdeBuiltin",
    }),

    publicDataProvider: indexerPublicDataProvider({
      queryURL: config.indexerUrl,
      subscriptionURL: config.indexerWsUrl,
    }),

    zkConfigProvider,

    proofProvider: createCrossContractProofServerProvider(config.proofServerUrl, [zkConfigProvider]),

    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}
