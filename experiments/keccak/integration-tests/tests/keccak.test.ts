// KECCAK benchmark: deploy the experiment contract and measure the controls
// (c64/c128/c256, input size only), persistentHash (p64/p128/p256, SHA-256)
// and keccak256 (k64/k128/k256) over identical payloads. Gated by
// RUN_INTEGRATION_TESTS; needs a running local stack and `yarn compile:zk`
// output.

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  Keccak,
  KECCAK_PRIVATE_STATE_ID,
  keccakBenchPlan,
  keccakCompiledContract,
  keccakManagedPath,
  deployKeccak,
} from "@midnight-experiments/keccak-contract";

import {
  activeCircuits,
  benchContract,
  BENCH_REPS,
  openBenchSession,
  timedDeploy,
  type BenchSession,
} from "@midnight-experiments/test-harness-benchmark";

// The full plan, or the BENCH_CIRCUITS subset (single-experiment runs).
const plan = activeCircuits(keccakBenchPlan);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("keccak benchmarks", () => {
  let session: BenchSession;
  let contractAddress: string;

  beforeAll(async () => {
    session = await openBenchSession(inject("benchRunId"));
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the keccak contract", async () => {
    const deployment = await timedDeploy(session.recorder, "keccak", "keccak", () =>
      deployKeccak(session.facade, session.keys, session.config.networkId),
    );
    contractAddress = deployment.contractAddress;
  });

  it("drives every keccak circuit through the instrumented prover", async () => {
    const txIds = await benchContract({
      session,
      experiment: "keccak",
      contractAddress,
      compiledContract: keccakCompiledContract,
      privateStateId: KECCAK_PRIVATE_STATE_ID,
      storePrefix: "exp-keccak",
      managedPaths: [keccakManagedPath],
      plan,
    });
    expect(txIds).toHaveLength(plan.length * BENCH_REPS);
  });

  it("sanity: the ledger reflects every finalized call", async () => {
    const state = await session.publicDataProvider.queryContractState(contractAddress);
    if (!state) throw new Error(`no contract state at ${contractAddress}`);
    const ledger = Keccak.ledger(state.data);
    // Every circuit bumps callCount; the contract is fresh this run.
    expect(ledger.callCount).toBe(BigInt(plan.length * BENCH_REPS));
    // Any hashing circuit in the plan leaves a non-zero digest behind.
    if (plan.some((spec) => spec.circuit.startsWith("p") || spec.circuit.startsWith("k"))) {
      expect([...ledger.digest].some((b) => b !== 0)).toBe(true);
    }
  });
});
