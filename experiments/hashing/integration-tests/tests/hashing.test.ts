// HASHING benchmark: persistentHash / transientHash over 32/256/1024-byte
// inputs plus a Vector<8, Bytes<32>> structure, with no-hash controls that
// isolate the cost of merely having a large circuit input.

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deployHashing,
  Hashing,
  HASHING_PRIVATE_STATE_ID,
  hashingBenchPlan,
  hashingCompiledContract,
  hashingManagedPath,
} from "@midnight-experiments/hashing-contract";

import { activeCircuits, benchContract, timedDeploy } from "../src/run-bench.ts";
import { BENCH_REPS, openBenchSession, type BenchSession } from "../src/session.ts";

// The full plan, or the BENCH_CIRCUITS subset (single-experiment runs).
const plan = activeCircuits(hashingBenchPlan);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("hashing benchmarks", () => {
  let session: BenchSession;
  let contractAddress: string;

  beforeAll(async () => {
    session = await openBenchSession(inject("benchRunId"));
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the hashing contract", async () => {
    const deployment = await timedDeploy(session.recorder, "hashing", "hashing", () =>
      deployHashing(session.facade, session.keys, session.config.networkId),
    );
    contractAddress = deployment.contractAddress;
  });

  it("drives every hashing circuit through the instrumented prover", async () => {
    const txIds = await benchContract({
      session,
      experiment: "hashing",
      contractAddress,
      compiledContract: hashingCompiledContract,
      privateStateId: HASHING_PRIVATE_STATE_ID,
      storePrefix: "exp-hashing",
      managedPaths: [hashingManagedPath],
      plan,
    });
    expect(txIds).toHaveLength(plan.length * BENCH_REPS);
  });

  it("sanity: the ledger reflects every finalized call", async () => {
    const state = await session.publicDataProvider.queryContractState(contractAddress);
    if (!state) throw new Error(`no contract state at ${contractAddress}`);
    const ledger = Hashing.ledger(state.data);
    expect(ledger.callCount).toBe(BigInt(plan.length * BENCH_REPS));
  });
});
