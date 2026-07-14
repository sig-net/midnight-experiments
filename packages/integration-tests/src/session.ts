// One benchmark session per test file: preflight the stack, open + sync the
// deployer wallet facade once (reused for every deploy and call in the file),
// and construct the JSONL recorder all measurements append to.

import { fileURLToPath } from "node:url";

import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";

import {
  deriveAccountKeys,
  getDeployConfig,
  initialiseWalletFacade,
  Recorder,
  type AccountKeys,
  type MidnightNodeConfig,
  type WalletFacade,
} from "@midnight-experiments/lib";

/** Where every benchmark observation lands (repo-root reports/raw/). */
export const RECORDS_FILE = fileURLToPath(new URL("../../../reports/raw/records.jsonl", import.meta.url));

/** Repetitions per measured circuit (BENCH_REPS env, default 2). */
export const BENCH_REPS = Math.max(1, Number(process.env.BENCH_REPS ?? 2));

export interface BenchSession {
  config: MidnightNodeConfig;
  facade: WalletFacade;
  keys: AccountKeys;
  recorder: Recorder;
  publicDataProvider: PublicDataProvider;
  close(): Promise<void>;
}

async function assertHttpReachable(label: string, url: string): Promise<void> {
  try {
    await fetch(url, { method: "GET" });
  } catch (cause) {
    throw new Error(`${label} not reachable at ${url} — is the local stack up? (docker compose up -d)`, { cause });
  }
}

/**
 * Preflight the stack, then open a started-and-synced wallet facade for the
 * deployer (genesis mint wallet unless DEPLOYER_SEED is set).
 *
 * @param runId - The run id (from vitest's global setup) stamped into every record.
 * @returns The live session; call `close()` in afterAll.
 */
export async function openBenchSession(runId: string): Promise<BenchSession> {
  const deployConfig = getDeployConfig(process.env);
  const config = deployConfig.midnightNodeConfig;

  await assertHttpReachable("midnight node", new URL("/health", config.nodeUrl).href);
  await assertHttpReachable("indexer", config.indexerUrl);
  await assertHttpReachable("proof server", config.proofServerUrl);

  // midnight-js reads the network id from a process-global.
  setNetworkId(config.networkId);

  const keys = deriveAccountKeys(deployConfig.deployerSeed, config.networkId);
  const facade = await initialiseWalletFacade(keys, config);
  await facade.start(keys.shieldedSecretKeys, keys.dustSecretKey);
  await facade.waitForSyncedState();

  return {
    config,
    facade,
    keys,
    recorder: new Recorder(RECORDS_FILE, runId),
    publicDataProvider: indexerPublicDataProvider({
      queryURL: config.indexerUrl,
      subscriptionURL: config.indexerWsUrl,
    }),
    close: async () => {
      await facade.stop().catch(() => {});
    },
  };
}
