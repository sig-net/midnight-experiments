// ATTEST benchmark: deploy the simulated signet attestation contract and
// measure mapOnly (workload floor), verifyOnly (ECDSA over a supplied
// digest), shaVerify and keccakVerify (in-circuit digest + ECDSA + map
// write). The circuits assert the signatures, so a passing run also proves
// the off-chain digest/signature conventions match the in-circuit ones.
// Gated by RUN_INTEGRATION_TESTS; needs a running local stack and
// `yarn compile:zk` output.

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  Attest,
  ATTEST_PRIVATE_STATE_ID,
  attestBenchPlan,
  attestCompiledContract,
  attestManagedPath,
  deployAttest,
  REQUEST_ID,
} from "@midnight-experiments/attest-contract";

import {
  activeCircuits,
  benchContract,
  BENCH_REPS,
  openBenchSession,
  timedDeploy,
  type BenchSession,
} from "@midnight-experiments/test-harness-benchmark";

// The full plan, or the BENCH_CIRCUITS subset (single-experiment runs).
const plan = activeCircuits(attestBenchPlan);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("attest benchmarks", () => {
  let session: BenchSession;
  let contractAddress: string;

  beforeAll(async () => {
    session = await openBenchSession(inject("benchRunId"));
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the attest contract", async () => {
    const deployment = await timedDeploy(session.recorder, "attest", "attest", () =>
      deployAttest(session.facade, session.keys, session.config.networkId),
    );
    contractAddress = deployment.contractAddress;
  });

  it("drives every attest circuit through the instrumented prover", async () => {
    const txIds = await benchContract({
      session,
      experiment: "attest",
      contractAddress,
      compiledContract: attestCompiledContract,
      privateStateId: ATTEST_PRIVATE_STATE_ID,
      storePrefix: "exp-attest",
      managedPaths: [attestManagedPath],
      plan,
    });
    expect(txIds).toHaveLength(plan.length * BENCH_REPS);
  });

  it("sanity: the ledger reflects every finalized call", async () => {
    const state = await session.publicDataProvider.queryContractState(contractAddress);
    if (!state) throw new Error(`no contract state at ${contractAddress}`);
    const ledger = Attest.ledger(state.data);
    // Every circuit bumps callCount; the contract is fresh this run.
    expect(ledger.callCount).toBe(BigInt(plan.length * BENCH_REPS));
    // Every circuit marks the fixture request verified.
    expect(ledger.verified.member(REQUEST_ID)).toBe(true);
    expect(ledger.verified.lookup(REQUEST_ID)).toBe(true);
  });
});
