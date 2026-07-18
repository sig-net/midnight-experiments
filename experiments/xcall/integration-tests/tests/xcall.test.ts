// XCALL benchmark: cross-contract calls. Deploys the target (callee) first,
// then the caller sealing a reference to it, and measures 0/1/2 calls, a
// Bytes<256> call argument, and a call whose callee fires an event. The
// instrumented proof provider records the caller's and callee's proofs
// separately (one prove() per contract in the call tree).

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  Caller,
  CALLER_PRIVATE_STATE_ID,
  callerCompiledContract,
  callerManagedPath,
  deployCaller,
  deployTarget,
  EXPECTED_CALLEE_CALLS,
  Target,
  targetManagedPath,
  xcallBenchPlan,
} from "@midnight-experiments/xcall-contract";

import { activeCircuits, benchContract, timedDeploy } from "../src/run-bench.ts";
import { BENCH_REPS, openBenchSession, type BenchSession } from "../src/session.ts";

// The full plan, or the BENCH_CIRCUITS subset (single-experiment runs).
const plan = activeCircuits(xcallBenchPlan);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("xcall benchmarks", () => {
  let session: BenchSession;
  let targetAddress: string;
  let callerAddress: string;

  beforeAll(async () => {
    session = await openBenchSession(inject("benchRunId"));
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the target (callee)", async () => {
    const deployment = await timedDeploy(session.recorder, "xcall", "target", () =>
      deployTarget(session.facade, session.keys, session.config.networkId),
    );
    targetAddress = deployment.contractAddress;
  });

  it("deploys the caller referencing the target", async () => {
    const deployment = await timedDeploy(session.recorder, "xcall", "caller", () =>
      deployCaller(session.facade, session.keys, session.config.networkId, targetAddress),
    );
    callerAddress = deployment.contractAddress;
  });

  it("drives every caller circuit through the instrumented prover", async () => {
    const txIds = await benchContract({
      session,
      experiment: "xcall",
      contractAddress: callerAddress,
      compiledContract: callerCompiledContract,
      privateStateId: CALLER_PRIVATE_STATE_ID,
      storePrefix: "exp-xcall",
      // Proof provider must span the WHOLE call tree: caller (root) + target.
      managedPaths: [callerManagedPath, targetManagedPath],
      plan,
    });
    expect(txIds).toHaveLength(plan.length * BENCH_REPS);
  });

  it("sanity: the callee's ledger counted every cross-contract call", async () => {
    const expectedCalleeCalls =
      BENCH_REPS * plan.reduce((sum, spec) => sum + (EXPECTED_CALLEE_CALLS[spec.circuit] ?? 0), 0);

    const targetState = await session.publicDataProvider.queryContractState(targetAddress);
    if (!targetState) throw new Error(`no contract state at ${targetAddress}`);
    expect(Target.ledger(targetState.data).callCount).toBe(BigInt(expectedCalleeCalls));

    const callerState = await session.publicDataProvider.queryContractState(callerAddress);
    if (!callerState) throw new Error(`no contract state at ${callerAddress}`);
    expect(Caller.ledger(callerState.data).callCount).toBe(BigInt(plan.length * BENCH_REPS));
  });
});
