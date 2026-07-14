// Baseline experiment package surface: the generated contract module, its
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

import { Contract as BaselineContract } from "./managed/baseline/contract/index.js";

export * as Baseline from "./managed/baseline/contract/index.js";

export type BaselineCircuitId = keyof InstanceType<typeof BaselineContract>["provableCircuits"] & string;
export const BASELINE_PRIVATE_STATE_ID = "exp-baseline";
export type BaselinePrivateStateId = typeof BASELINE_PRIVATE_STATE_ID;

export const baselineManagedPath = fileURLToPath(new URL("./managed/baseline", import.meta.url));

export const baselineCompiledContract = makeVacantCompiledContract<
  BaselineContract<EmptyPrivateState>,
  EmptyPrivateState
>("baseline", BaselineContract, baselineManagedPath);

/** Deploy the baseline contract through an already-open facade. */
export async function deployBaseline(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(facade, keys, networkId, baselineCompiledContract, createEmptyPrivateState());
}

const RECIPIENT = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const AMOUNT = 4242n;

/** The measured circuits and their call arguments. */
export const baselineBenchPlan: BenchCircuitSpec[] = [
  { circuit: "noop", args: () => [] },
  { circuit: "base", args: () => [RECIPIENT, AMOUNT] },
];
