// Live proof for the serde-builtin experiment. The offline tests already pin
// the byte layout against the compiled circuits in the JS simulator; this e2e
// closes the last gap by running checkRoundtrip under REAL proving:
//
//   deploy → submit checkRoundtrip(bytes) where `bytes` were encoded entirely
//   OFF-CHAIN by the TypeScript twin (compactSerialize) → the circuit
//   deserializes them, re-serializes, asserts byte equality, and bumps the
//   `checks` counter. A finalized transaction plus the counter increment is
//   on-chain evidence the zk circuit accepts TS-encoded bytes.
//
// Env-gated exactly like the other experiments: skips entirely unless
// RUN_INTEGRATION_TESTS is set. Needs a running node + indexer + proof server
// and a funded DEPLOYER_SEED wallet. Set SERDE_CONTRACT_ADDRESS to resume
// against an already-deployed contract.

import {
  deriveAccountKeys,
  getDeployConfig,
  getMidnightNodeConfig,
  initialiseWalletFacade,
  type WalletFacade,
} from "@sig-net/midnight-contract-deploy";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js/contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildSerdeProviders,
  compactSerialize,
  createSerdePrivateState,
  deploySerde,
  SERDE_PRIVATE_STATE_ID,
  serdeCompiledContract,
  SerdeBuiltin,
  type CompactType,
} from "@midnight-experiments/serde-builtin-contract";

const MINUTE = 60_000;

// Seeded from the real environment; populated by the setup steps.
const env: NodeJS.ProcessEnv = { ...process.env };

/** Assert a prior step (or the environment) populated `name`. */
function requireEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set — did the step that derives it run?`);
  return value;
}

function logSkip(step: string, reason: string): void {
  console.log(`SKIPPED: ${step} — ${reason}`);
}

async function assertHttpReachable(label: string, url: string): Promise<void> {
  try {
    await fetch(url, { method: "GET" });
  } catch (cause) {
    throw new Error(`${label} not reachable at ${url}`, { cause });
  }
}

// The Mixed struct descriptor, mirroring serde-builtin.compact.
const MIXED: CompactType = {
  kind: "struct",
  fields: [
    { name: "flag", type: { kind: "boolean" } },
    { name: "amount", type: { kind: "uint", bits: 128 } },
    { name: "small", type: { kind: "uint", bits: 8 } },
    { name: "tag", type: { kind: "bytes", length: 32 } },
  ],
};

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("serde-builtin e2e", () => {
  const nodeConfig = () => getMidnightNodeConfig(env);

  let sharedPdp: PublicDataProvider | undefined;
  const publicDataProvider = (): PublicDataProvider => {
    if (!sharedPdp) {
      const cfg = nodeConfig();
      sharedPdp = indexerPublicDataProvider({ queryURL: cfg.indexerUrl, subscriptionURL: cfg.indexerWsUrl });
    }
    return sharedPdp;
  };

  let sharedWallet: { facade: WalletFacade; keys: ReturnType<typeof deriveAccountKeys> } | undefined;
  async function wallet() {
    if (!sharedWallet) {
      const cfg = getDeployConfig(env);
      const keys = deriveAccountKeys(cfg.deployerSeed, cfg.midnightNodeConfig.networkId);
      setNetworkId(cfg.midnightNodeConfig.networkId);
      const facade = await initialiseWalletFacade(keys, cfg.midnightNodeConfig);
      await facade.start(keys.shieldedSecretKeys, keys.dustSecretKey);
      await facade.waitForSyncedState();
      sharedWallet = { facade, keys };
    }
    await sharedWallet.facade.waitForSyncedState();
    return sharedWallet;
  }

  afterAll(async () => {
    await sharedWallet?.facade.stop().catch(() => {});
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Read the `checks` counter straight off the indexer's raw ledger state.
   * Indexing lags block finalization, so poll until the state appears.
   */
  async function readChecks(address: string): Promise<bigint> {
    const deadline = Date.now() + MINUTE;
    for (;;) {
      const state = await publicDataProvider().queryContractState(address);
      if (state) return SerdeBuiltin.ledger(state.data).checks;
      if (Date.now() > deadline) throw new Error(`no contract state found at ${address}`);
      await sleep(1_000);
    }
  }

  it(
    "environment: midnight node, indexer and proof server reachable",
    async () => {
      const cfg = nodeConfig();
      await assertHttpReachable("midnight node", new URL("/health", cfg.nodeUrl).href);
      await assertHttpReachable("indexer", cfg.indexerUrl);
      await assertHttpReachable("proof server", cfg.proofServerUrl);
    },
    MINUTE,
  );

  it(
    "deploy the serde-builtin contract",
    async () => {
      if (env.SERDE_CONTRACT_ADDRESS) {
        logSkip("deploy", `SERDE_CONTRACT_ADDRESS is set (${env.SERDE_CONTRACT_ADDRESS})`);
        return;
      }
      const { contractAddress } = await deploySerde(env);
      env.SERDE_CONTRACT_ADDRESS = contractAddress;
    },
    10 * MINUTE,
  );

  it(
    "checkRoundtrip proves the zk circuit accepts TS-encoded bytes",
    async () => {
      const address = requireEnv("SERDE_CONTRACT_ADDRESS");
      const before = await readChecks(address);
      console.log(`checks before: ${before}`);

      // Encoded entirely off-chain by the TypeScript twin.
      const bytes = compactSerialize(
        MIXED,
        { flag: true, amount: 123456789n, small: 42n, tag: new Uint8Array(32).fill(0x5e) },
        128,
      );

      const { facade, keys } = await wallet();
      const providers = buildSerdeProviders(facade, keys, nodeConfig());
      const contract = await findDeployedContract(providers, {
        contractAddress: address,
        compiledContract: serdeCompiledContract,
        privateStateId: SERDE_PRIVATE_STATE_ID,
        initialPrivateState: createSerdePrivateState(),
      });

      const result = await contract.callTx.checkRoundtrip(bytes);
      console.log(`checkRoundtrip finalized in tx ${result.public.txId}`);

      const after = await readChecks(address);
      console.log(`checks after: ${after}`);
      expect(after).toBe(before + 1n);
    },
    10 * MINUTE,
  );
});
