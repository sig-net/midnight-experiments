// EVENTS benchmark: the shared workload plus 0/1/2/4 Misc events per call.
// Also reads the events back off the indexer to confirm every emitted event
// was actually published (event volume = what we think we measured).

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deployEvents,
  Events,
  EVENTS_PRIVATE_STATE_ID,
  eventsBenchPlan,
  eventsCompiledContract,
  eventsManagedPath,
  EXPECTED_EVENT_COUNTS,
} from "@midnight-experiments/events-contract";

import { activeCircuits, benchContract, timedDeploy } from "../src/run-bench.ts";
import { BENCH_REPS, openBenchSession, type BenchSession } from "../src/session.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The full plan, or the BENCH_CIRCUITS subset (single-experiment runs).
const plan = activeCircuits(eventsBenchPlan);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("events benchmarks", () => {
  let session: BenchSession;
  let contractAddress: string;

  beforeAll(async () => {
    session = await openBenchSession(inject("benchRunId"));
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the events contract", async () => {
    const deployment = await timedDeploy(session.recorder, "events", "events", () =>
      deployEvents(session.facade, session.keys, session.config.networkId),
    );
    contractAddress = deployment.contractAddress;
  });

  it("drives every events circuit through the instrumented prover", async () => {
    const txIds = await benchContract({
      session,
      experiment: "events",
      contractAddress,
      compiledContract: eventsCompiledContract,
      privateStateId: EVENTS_PRIVATE_STATE_ID,
      storePrefix: "exp-events",
      managedPaths: [eventsManagedPath],
      plan,
    });
    expect(txIds).toHaveLength(plan.length * BENCH_REPS);
  });

  it("all emitted events are published on-chain (indexer read-back)", async () => {
    const expectedTotal =
      BENCH_REPS * plan.reduce((sum, spec) => sum + (EXPECTED_EVENT_COUNTS[spec.circuit] ?? 0), 0);

    // Event indexing lags block finalization — poll until the count settles.
    const deadline = Date.now() + 60_000;
    let events: Awaited<ReturnType<typeof session.publicDataProvider.queryContractEvents>> = [];
    while (Date.now() < deadline) {
      events = await session.publicDataProvider.queryContractEvents({ contractAddress, types: ["Misc"] });
      if (events.length >= expectedTotal) break;
      await sleep(1000);
    }
    expect(events).toHaveLength(expectedTotal);

    // Every event carries the fixed-size 256-byte payload.
    for (const event of events) {
      if (event.eventType !== "Misc") continue;
      const payloadHex = event.payload.startsWith("0x") ? event.payload.slice(2) : event.payload;
      expect(payloadHex).toHaveLength(256 * 2);
    }
  });

  it("sanity: the ledger reflects every finalized call", async () => {
    const state = await session.publicDataProvider.queryContractState(contractAddress);
    if (!state) throw new Error(`no contract state at ${contractAddress}`);
    const ledger = Events.ledger(state.data);
    expect(ledger.callCount).toBe(BigInt(plan.length * BENCH_REPS));
  });
});
