// BASELINE benchmark: deploy the control contract and measure `noop` (the
// proof-system floor) and `base` (the shared workload every other experiment
// adds constructs to). Gated by RUN_INTEGRATION_TESTS; needs a running local
// stack and `yarn compile:zk` output.

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  Baseline,
  BASELINE_PRIVATE_STATE_ID,
  baselineBenchPlan,
  baselineCompiledContract,
  baselineManagedPath,
  deployBaseline,
} from "@midnight-experiments/baseline-contract";

import { activeCircuits, benchContract, timedDeploy } from "../src/run-bench.ts";
import { BENCH_REPS, openBenchSession, type BenchSession } from "../src/session.ts";

// The full plan, or the BENCH_CIRCUITS subset (single-experiment runs).
const plan = activeCircuits(baselineBenchPlan);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("baseline benchmarks", () => {
  let session: BenchSession;
  let contractAddress: string;

  beforeAll(async () => {
    session = await openBenchSession(inject("benchRunId"));
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the baseline contract", async () => {
    const deployment = await timedDeploy(session.recorder, "baseline", "baseline", () =>
      deployBaseline(session.facade, session.keys, session.config.networkId),
    );
    contractAddress = deployment.contractAddress;
  });

  it("drives every baseline circuit through the instrumented prover", async () => {
    const txIds = await benchContract({
      session,
      experiment: "baseline",
      contractAddress,
      compiledContract: baselineCompiledContract,
      privateStateId: BASELINE_PRIVATE_STATE_ID,
      storePrefix: "exp-baseline",
      managedPaths: [baselineManagedPath],
      plan,
    });
    expect(txIds).toHaveLength(plan.length * BENCH_REPS);
  });

  it("sanity: the ledger reflects every finalized call", async () => {
    const state = await session.publicDataProvider.queryContractState(contractAddress);
    if (!state) throw new Error(`no contract state at ${contractAddress}`);
    const ledger = Baseline.ledger(state.data);
    // Both circuits bump callCount; the contract is fresh this run.
    expect(ledger.callCount).toBe(BigInt(plan.length * BENCH_REPS));
    if (plan.some((spec) => spec.circuit === "base")) {
      expect(ledger.lastAmount).toBe(4242n);
    }
  });
});
