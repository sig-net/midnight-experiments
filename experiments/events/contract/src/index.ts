// Events experiment package surface.

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

import { Contract as EventsContract } from "./managed/events/contract/index.js";

export * as Events from "./managed/events/contract/index.js";

export type EventsCircuitId = keyof InstanceType<typeof EventsContract>["provableCircuits"] & string;
export const EVENTS_PRIVATE_STATE_ID = "exp-events";
export type EventsPrivateStateId = typeof EVENTS_PRIVATE_STATE_ID;

export const eventsManagedPath = fileURLToPath(new URL("./managed/events", import.meta.url));

export const eventsCompiledContract = makeVacantCompiledContract<
  EventsContract<EmptyPrivateState>,
  EmptyPrivateState
>("events", EventsContract, eventsManagedPath);

/** Deploy the events contract through an already-open facade. */
export async function deployEvents(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(facade, keys, networkId, eventsCompiledContract, createEmptyPrivateState());
}

const RECIPIENT = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const AMOUNT = 4242n;

/** How many Misc events each measured circuit emits (for the indexer read-back check). */
export const EXPECTED_EVENT_COUNTS: Record<string, number> = {
  base: 0,
  emit1: 1,
  emit2: 2,
  emit4: 4,
};

/** The measured circuits and their call arguments. */
export const eventsBenchPlan: BenchCircuitSpec[] = [
  { circuit: "base", args: () => [RECIPIENT, AMOUNT] },
  { circuit: "emit1", args: () => [RECIPIENT, AMOUNT] },
  { circuit: "emit2", args: () => [RECIPIENT, AMOUNT] },
  { circuit: "emit4", args: () => [RECIPIENT, AMOUNT] },
];
