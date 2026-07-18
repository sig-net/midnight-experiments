// midnight-js provider set + compiled-contract binding for the ECDSA
// experiment contract. Modeled on the xcontract-events providers (the
// witness-less single-contract shape); the proof provider spans just this one
// contract.

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

import { Contract as EcdsaContract } from "./managed/ecdsa/contract/index.js";
import { ecdsaWitnesses, type EcdsaPrivateState } from "./witnesses.ts";

/** Provable circuit ids, straight from the generated contract. */
export type EcdsaCircuitId = keyof InstanceType<typeof EcdsaContract>["provableCircuits"] & string;

/** Private-state store key (single-value union, one contract). */
export type EcdsaPrivateStateId = "ecdsa-experiment";
export const ECDSA_PRIVATE_STATE_ID: EcdsaPrivateStateId = "ecdsa-experiment";

export type EcdsaProviders = MidnightProviders<EcdsaCircuitId, EcdsaPrivateStateId, EcdsaPrivateState>;

// Compiler output dir (contract/, keys/, zkir/): the zk-config root.
const ecdsaManagedPath = fileURLToPath(new URL("./managed/ecdsa", import.meta.url));

/** Compiled-contract binding (witness-less → vacant witnesses). */
export const ecdsaCompiledContract = makeVacantCompiledContract<EcdsaContract<EcdsaPrivateState>, EcdsaPrivateState>(
  "ecdsa-experiment",
  EcdsaContract,
  ecdsaManagedPath,
);

// Bind the witness object so the found-contract handle's callTx carries real
// (empty) witnesses. makeVacantCompiledContract already binds vacant witnesses;
// referencing this keeps the import meaningful and documents intent.
void ecdsaWitnesses;

/**
 * Build the midnight-js provider set for the ECDSA experiment contract.
 *
 * @param facade - A started (and synced) wallet facade.
 * @param keys - The key material of the same wallet, for balancing and signing.
 * @param config - The Midnight network endpoints to run against.
 * @returns The provider set to hand to `findDeployedContract`.
 */
export function buildEcdsaProviders(
  facade: WalletFacade,
  keys: AccountKeys,
  config: MidnightNodeConfig,
): EcdsaProviders {
  const ecdsaZkConfigProvider = new NodeZkConfigProvider<EcdsaCircuitId>(ecdsaManagedPath);

  const walletAndMidnightProvider = createWalletAndMidnightProvider(facade, keys);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: "ecdsa-experiment-private-states",
      signingKeyStoreName: "ecdsa-experiment-signing-keys",
      accountId,
      privateStoragePasswordProvider: () => "&*(BHJqwe419-ecdsaExperiment",
    }),

    publicDataProvider: indexerPublicDataProvider({
      queryURL: config.indexerUrl,
      subscriptionURL: config.indexerWsUrl,
    }),

    zkConfigProvider: ecdsaZkConfigProvider,

    proofProvider: createCrossContractProofServerProvider(config.proofServerUrl, [ecdsaZkConfigProvider]),

    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}
