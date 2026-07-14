// Cross-contract experiment package surface: TWO contracts. The target (B,
// callee) deploys first with no constructor args; the caller (A) seals a
// reference to the deployed target (constructor arg { bytes: Uint8Array(32) }
// — NOT a hex string).

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

import { Contract as CallerContract } from "./managed/caller/contract/index.js";
import { Contract as TargetContract } from "./managed/target/contract/index.js";

export * as Caller from "./managed/caller/contract/index.js";
export * as Target from "./managed/target/contract/index.js";

export type CallerCircuitId = keyof InstanceType<typeof CallerContract>["provableCircuits"] & string;
export type TargetCircuitId = keyof InstanceType<typeof TargetContract>["provableCircuits"] & string;
export const CALLER_PRIVATE_STATE_ID = "exp-xcall-caller";
export type CallerPrivateStateId = typeof CALLER_PRIVATE_STATE_ID;

export const callerManagedPath = fileURLToPath(new URL("./managed/caller", import.meta.url));
export const targetManagedPath = fileURLToPath(new URL("./managed/target", import.meta.url));

export const callerCompiledContract = makeVacantCompiledContract<
  CallerContract<EmptyPrivateState>,
  EmptyPrivateState
>("xcall-caller", CallerContract, callerManagedPath);

export const targetCompiledContract = makeVacantCompiledContract<
  TargetContract<EmptyPrivateState>,
  EmptyPrivateState
>("xcall-target", TargetContract, targetManagedPath);

/** A deployed contract's address as the caller constructor wants its `Target` reference. */
export function contractAddressToReference(contractAddress: string): { bytes: Uint8Array } {
  const hex = contractAddress.startsWith("0x") ? contractAddress.slice(2) : contractAddress;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`expected a 32-byte hex contract address, got '${contractAddress}'`);
  }
  return { bytes: Uint8Array.from(Buffer.from(hex, "hex")) };
}

/** Deploy the target (B, the callee) through an already-open facade. */
export async function deployTarget(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(facade, keys, networkId, targetCompiledContract, createEmptyPrivateState());
}

/** Deploy the caller (A), sealing a reference to an already-deployed target. */
export async function deployCaller(
  facade: WalletFacade,
  keys: AccountKeys,
  networkId: NetworkId,
  targetContractAddress: string,
) {
  return deployWithFacade(
    facade,
    keys,
    networkId,
    callerCompiledContract,
    createEmptyPrivateState(),
    contractAddressToReference(targetContractAddress),
  );
}

const RECIPIENT = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const AMOUNT = 4242n;
const BIG = Uint8Array.from({ length: 256 }, (_, i) => (i * 7 + 13) % 256);

/** How many cross-contract calls each measured circuit makes (callee proves once per call). */
export const EXPECTED_CALLEE_CALLS: Record<string, number> = {
  localBase: 0,
  callOnce: 1,
  callTwice: 2,
  callBig: 1,
  callEmit: 1,
};

/** The measured circuits (all on the CALLER) and their call arguments. */
export const xcallBenchPlan: BenchCircuitSpec[] = [
  { circuit: "localBase", args: () => [RECIPIENT, AMOUNT] },
  { circuit: "callOnce", args: () => [RECIPIENT, AMOUNT] },
  { circuit: "callTwice", args: () => [RECIPIENT, AMOUNT] },
  { circuit: "callBig", args: () => [BIG] },
  { circuit: "callEmit", args: () => [RECIPIENT, AMOUNT] },
];
