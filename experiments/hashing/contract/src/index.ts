// Hashing experiment package surface.

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

import { Contract as HashingContract } from "./managed/hashing/contract/index.js";

export * as Hashing from "./managed/hashing/contract/index.js";

export type HashingCircuitId = keyof InstanceType<typeof HashingContract>["provableCircuits"] & string;
export const HASHING_PRIVATE_STATE_ID = "exp-hashing";
export type HashingPrivateStateId = typeof HASHING_PRIVATE_STATE_ID;

export const hashingManagedPath = fileURLToPath(new URL("./managed/hashing", import.meta.url));

export const hashingCompiledContract = makeVacantCompiledContract<
  HashingContract<EmptyPrivateState>,
  EmptyPrivateState
>("hashing", HashingContract, hashingManagedPath);

/** Deploy the hashing contract through an already-open facade. */
export async function deployHashing(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(facade, keys, networkId, hashingCompiledContract, createEmptyPrivateState());
}

const bytes = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i * 7 + 13) % 256);

/** The measured circuits and their call arguments. */
export const hashingBenchPlan: BenchCircuitSpec[] = [
  { circuit: "control32", args: () => [bytes(32)] },
  { circuit: "control256", args: () => [bytes(256)] },
  { circuit: "control1024", args: () => [bytes(1024)] },
  { circuit: "persistent32", args: () => [bytes(32)] },
  { circuit: "persistent256", args: () => [bytes(256)] },
  { circuit: "persistent1024", args: () => [bytes(1024)] },
  { circuit: "persistentVec8", args: () => [Array.from({ length: 8 }, () => bytes(32))] },
  { circuit: "transient32", args: () => [bytes(32)] },
  { circuit: "transient256", args: () => [bytes(256)] },
  { circuit: "transient1024", args: () => [bytes(1024)] },
];
