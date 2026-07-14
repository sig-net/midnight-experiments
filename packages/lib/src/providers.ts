// Generic midnight-js provider-set builder for the experiment contracts.
// Every experiment contract here is witness-less (empty private state), so
// one parameterized builder replaces a per-package providers.ts. Modeled on
// the xcontract-events spike's buildVaultProviders: the proof provider spans
// EVERY contract a call tree can reach (the cross-contract gotcha), and here
// it is additionally the instrumented one so the benchmarks capture each
// /check + /prove round-trip.

import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { MidnightProviders, ProofProvider, ZKConfigProvider } from "@midnight-ntwrk/midnight-js/types";
import type { WalletFacade } from "@midnightntwrk/wallet-sdk-facade";

import { createWalletAndMidnightProvider } from "./midnight-providers.ts";
import type { MidnightNodeConfig } from "./midnight-node-config.ts";
import type { AccountKeys } from "./wallet.ts";

/** All experiment contracts carry no private state. */
export type EmptyPrivateState = Record<string, never>;
export const createEmptyPrivateState = (): EmptyPrivateState => ({});

/**
 * Build the provider set for driving one (witness-less) experiment contract.
 *
 * @param facade - A started (and synced) wallet facade.
 * @param keys - The key material of the same wallet, for balancing and signing.
 * @param config - The Midnight network endpoints to run against.
 * @param storePrefix - Namespace for the level-db private-state stores (one per experiment package).
 * @param zkConfigProvider - The ROOT contract's own zk-config provider.
 * @param proofProvider - The proof provider — must span every contract in the call tree.
 * @returns The provider set to hand to `findDeployedContract`.
 */
export function buildExperimentProviders<CID extends string, PSID extends string>(
  facade: WalletFacade,
  keys: AccountKeys,
  config: MidnightNodeConfig,
  storePrefix: string,
  zkConfigProvider: ZKConfigProvider<CID>,
  proofProvider: ProofProvider,
): MidnightProviders<CID, PSID, EmptyPrivateState> {
  const walletAndMidnightProvider = createWalletAndMidnightProvider(facade, keys);

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: `${storePrefix}-private-states`,
      signingKeyStoreName: `${storePrefix}-signing-keys`,
      accountId: walletAndMidnightProvider.getCoinPublicKey(),
      // Local-only store; the SDK enforces >= 3 character classes.
      privateStoragePasswordProvider: () => "Midnight-Experiments-2026-localOnly",
    }),

    publicDataProvider: indexerPublicDataProvider({
      queryURL: config.indexerUrl,
      subscriptionURL: config.indexerWsUrl,
    }),

    zkConfigProvider,
    proofProvider,

    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}
