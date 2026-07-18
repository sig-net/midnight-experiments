// End-to-end proof that THIS repo's stack really does in-circuit secp256k1
// ECDSA verification on a live Midnight network: deploy the attestation
// contract with a pinned secp256k1 key → sign a message hash off-chain
// (@noble/curves, RFC 6979) → call postAttestation under REAL ZKIR v3 proving
// → observe the authenticated record on the ledger.
//
// The chain of custody:
//   • The ONLY way `attestations` gains an entry is through postAttestation,
//     whose in-circuit asserts (key pin + secp256k1EcdsaVerify) are part of
//     the ZK-proven transcript. So a stored record IS on-chain proof that the
//     proving stack (zkir v3 keys, proof server, node verification) handled
//     the secp256k1 foreign-field circuits.
//   • The negative case never reaches the chain: an invalid signature fails
//     the local circuit execution before a proof is even requested.
//
// Env-gated exactly like the xcontract-events e2e: skips entirely unless
// RUN_INTEGRATION_TESTS is set, so the offline `yarn test` stays green. Needs
// a running node + indexer + proof server (the deploy package's Midnight node
// config env) and a funded DEPLOYER_SEED wallet. One file on purpose: vitest
// runs same-file tests sequentially and the steps feed each other through the
// `env` accumulator (set ECDSA_CONTRACT_ADDRESS to resume against an
// already-deployed contract).

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
import type { Secp256k1Point } from "@midnight-ntwrk/compact-runtime";
import { afterAll, describe, expect, it } from "vitest";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import {
  buildEcdsaProviders,
  createEcdsaPrivateState,
  deployEcdsa,
  Ecdsa,
  ecdsaCompiledContract,
  ECDSA_PRIVATE_STATE_ID,
} from "@midnight-experiments/ecdsa-contract";

const MINUTE = 60_000;

// Seeded from the real environment; populated by the setup steps.
const env: NodeJS.ProcessEnv = { ...process.env };

const bytesToBigIntBE = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
};

const bigIntTo32BytesLE = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number((value >> BigInt(8 * i)) & 0xffn);
  return bytes;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

// The "MPC" keypair for this run, fixed so a resumed run against an
// already-deployed contract (ECDSA_CONTRACT_ADDRESS set) still signs with the
// pinned key.
const MPC_SECRET_KEY = Uint8Array.from(
  Buffer.from("a3b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1", "hex"),
);
const MPC_PUBLIC_KEY_UNCOMPRESSED = secp256k1.getPublicKey(MPC_SECRET_KEY, false);
const MPC_PUBLIC_KEY: Secp256k1Point = {
  x: bytesToBigIntBE(MPC_PUBLIC_KEY_UNCOMPRESSED.slice(1, 33)),
  y: bytesToBigIntBE(MPC_PUBLIC_KEY_UNCOMPRESSED.slice(33, 65)),
  identity: false,
};

// A per-run message hash: attestations are keyed by msgHash and first-write-
// wins, so a rerun against a kept contract must attest a FRESH hash for the
// count to move. The entropy comes from the wall clock, which is fine here:
// this is a live e2e, not a reproducible fixture.
const MSG_HASH: Uint8Array = keccak_256(new TextEncoder().encode(`ecdsa experiment attestation ${Date.now()}`));
const SIGNATURE = secp256k1.Signature.fromBytes(
  secp256k1.sign(MSG_HASH, MPC_SECRET_KEY, { prehash: false }),
  "compact",
);

/** Assert a prior step (or the environment) populated `name`. */
function requireEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set; did the step that derives it run?`);
  return value;
}

function logSkip(step: string, reason: string): void {
  console.log(`SKIPPED: ${step}: ${reason}`);
}

async function assertHttpReachable(label: string, url: string): Promise<void> {
  try {
    await fetch(url, { method: "GET" });
  } catch (cause) {
    throw new Error(`${label} not reachable at ${url}`, { cause });
  }
}

/** Read + decode the contract's ledger from raw indexer state. */
async function queryLedger(pdp: PublicDataProvider, address: string): Promise<ReturnType<typeof Ecdsa.ledger>> {
  const state = await pdp.queryContractState(address);
  if (!state) throw new Error(`no contract state found at ${address}`);
  return Ecdsa.ledger(state.data);
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("ecdsa e2e", () => {
  const nodeConfig = () => getMidnightNodeConfig(env);

  // A fresh indexer public-data provider for reading raw ledger state.
  let sharedPdp: PublicDataProvider | undefined;
  const publicDataProvider = (): PublicDataProvider => {
    if (!sharedPdp) {
      const cfg = nodeConfig();
      sharedPdp = indexerPublicDataProvider({ queryURL: cfg.indexerUrl, subscriptionURL: cfg.indexerWsUrl });
    }
    return sharedPdp;
  };

  // Deployer wallet, opened once and reused across the call steps.
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
    "deploy the attestation contract with the MPC key pinned",
    async () => {
      if (env.ECDSA_CONTRACT_ADDRESS) {
        logSkip("deploy", `ECDSA_CONTRACT_ADDRESS is set (${env.ECDSA_CONTRACT_ADDRESS})`);
        return;
      }
      const { contractAddress } = await deployEcdsa(MPC_PUBLIC_KEY, env);
      env.ECDSA_CONTRACT_ADDRESS = contractAddress;
      console.log(`deployed ecdsa-experiment at ${contractAddress}`);
    },
    10 * MINUTE,
  );

  it(
    "an INVALID signature never reaches the chain: local circuit execution rejects before proving",
    async () => {
      const contractAddress = requireEnv("ECDSA_CONTRACT_ADDRESS");
      const { facade, keys } = await wallet();
      const providers = buildEcdsaProviders(facade, keys, nodeConfig());
      const contract = await findDeployedContract(providers, {
        contractAddress,
        compiledContract: ecdsaCompiledContract,
        privateStateId: ECDSA_PRIVATE_STATE_ID,
        initialPrivateState: createEcdsaPrivateState(),
      });

      await expect(
        contract.callTx.postAttestation(MSG_HASH, { r: SIGNATURE.r + 1n, s: SIGNATURE.s }, MPC_PUBLIC_KEY),
      ).rejects.toThrow("Invalid attestation signature");
    },
    5 * MINUTE,
  );

  it(
    "post a VALID attestation under real ZKIR v3 proving → authenticated record lands on the ledger",
    async () => {
      const contractAddress = requireEnv("ECDSA_CONTRACT_ADDRESS");
      const pdp = publicDataProvider();

      // Baseline: the attestation count before the call.
      const before = await queryLedger(pdp, contractAddress);
      console.log(`attestationCount before: ${before.attestationCount}`);
      expect(hex(before.mpcPubKeyHash)).toBe(hex(Ecdsa.pureCircuits.mpcKeyHash(MPC_PUBLIC_KEY)));

      const { facade, keys } = await wallet();
      const providers = buildEcdsaProviders(facade, keys, nodeConfig());
      const contract = await findDeployedContract(providers, {
        contractAddress,
        compiledContract: ecdsaCompiledContract,
        privateStateId: ECDSA_PRIVATE_STATE_ID,
        initialPrivateState: createEcdsaPrivateState(),
      });

      const result = await contract.callTx.postAttestation(
        MSG_HASH,
        { r: SIGNATURE.r, s: SIGNATURE.s },
        MPC_PUBLIC_KEY,
      );
      console.log(`postAttestation finalised in tx ${result.public.txId}`);

      // The ledger moved: only possible if the proven call landed on-chain,
      // i.e. the whole stack handled the secp256k1 circuits.
      const after = await queryLedger(pdp, contractAddress);
      console.log(`attestationCount after: ${after.attestationCount}`);
      expect(after.attestationCount).toBe(before.attestationCount + 1n);
      expect(after.attestations.member(MSG_HASH)).toBe(true);
      const stored = after.attestations.lookup(MSG_HASH);
      expect(hex(stored.r)).toBe(hex(bigIntTo32BytesLE(SIGNATURE.r)));
      expect(hex(stored.s)).toBe(hex(bigIntTo32BytesLE(SIGNATURE.s)));
    },
    15 * MINUTE,
  );
});
