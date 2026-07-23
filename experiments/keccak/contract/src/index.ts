// Keccak experiment package surface: the generated contract module, its
// compiled-contract binding, deploy flow, and the bench plan the integration
// tests drive.

import { fileURLToPath } from "node:url";

import type { WalletFacade } from "@midnightntwrk/wallet-sdk-facade";

import {
  createEmptyPrivateState,
  deployWithFacade,
  makeVacantCompiledContract,
  type AccountKeys,
  type BenchCircuitSpec,
  type EmptyPrivateState,
  type NetworkId,
} from "@midnight-experiments/lib";

import { Contract as KeccakContract } from "./managed/keccak/contract/index.js";

export * as Keccak from "./managed/keccak/contract/index.js";

export type KeccakCircuitId = keyof InstanceType<typeof KeccakContract>["provableCircuits"] & string;
export const KECCAK_PRIVATE_STATE_ID = "exp-keccak";
export type KeccakPrivateStateId = typeof KECCAK_PRIVATE_STATE_ID;

export const keccakManagedPath = fileURLToPath(new URL("./managed/keccak", import.meta.url));

export const keccakCompiledContract = makeVacantCompiledContract<
  KeccakContract<EmptyPrivateState>,
  EmptyPrivateState
>("keccak", KeccakContract, keccakManagedPath);

/** Deploy the keccak contract through an already-open facade. */
export async function deployKeccak(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(facade, keys, networkId, keccakCompiledContract, createEmptyPrivateState());
}

// Deterministic non-zero payloads. The tail bytes are deliberately NON-ZERO:
// runtimes before 0.18.100 trimmed trailing zero bytes from JS-side keccak
// preimages (fixed via toBinaryRepr, see the compact CHANGELOG), and a
// zero-suffixed payload would mask that class of divergence.
const bytes = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (i % 251) + 1);

const DATA64 = bytes(64);
const DATA128 = bytes(128);
const DATA256 = bytes(256);

/** The measured circuits and their call arguments. */
export const keccakBenchPlan: BenchCircuitSpec[] = [
  { circuit: "c64", args: () => [DATA64] },
  { circuit: "c128", args: () => [DATA128] },
  { circuit: "c256", args: () => [DATA256] },
  { circuit: "p64", args: () => [DATA64] },
  { circuit: "p128", args: () => [DATA128] },
  { circuit: "p256", args: () => [DATA256] },
  { circuit: "k64", args: () => [DATA64] },
  { circuit: "k128", args: () => [DATA128] },
  { circuit: "k256", args: () => [DATA256] },
];
