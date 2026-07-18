// XCALL-WITH-PAYMENT experiment: can OWNERSHIP of a shielded coin be passed
// across a cross-contract call, with the CALLEE taking custody? The caller's
// `callOnce(coin)` forwards the coin to the target's `notify(coin)`, whose
// `receiveShielded` would take custody and record it in the target's
// `treasury` ledger.
//
// FINDING (compact-runtime 0.18.0-rc.0 / midnight-js 5.0.0-beta.3): NO.
// Zswap coin operations are unsupported in cross-contract CALLEES — the
// runtime's `setupCallContext` (compact-runtime dist/contract.js) explicitly
// sets `currentZswapLocalState = undefined` for sub-calls (the same "not yet
// supported for non-root contracts" category as witnesses), so the callee's
// `receiveShielded` throws "Zswap local state is undefined" during local
// circuit execution, before anything is proven or submitted. Coin custody
// ops must live in the ROOT contract of a call — e.g. the caller
// `receiveShielded`s itself and `sendShielded`s to the target's address.
//
// This test pins that behavior: deploys succeed, the call fails with exactly
// that error, and the target's treasury stays untouched. If a runtime upgrade
// ever adds callee Zswap support, the rejection assertion here fails — the
// signal to flip this experiment over to asserting the deposit lands.

import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CALLER_PRIVATE_STATE_ID,
  callerCompiledContract,
  callerManagedPath,
  deployCaller,
  deployTarget,
  makePaymentCoin,
  Target,
  targetManagedPath,
} from "@midnight-experiments/xcall-with-payment-contract";

import { benchContract, timedDeploy } from "../src/run-bench.ts";
import { openBenchSession, type BenchSession } from "../src/session.ts";

/** All messages in an error's `cause` chain, joined — the runtime failure is nested two causes deep. */
function causeChainMessages(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" <- ");
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("xcall with payment", () => {
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
    const deployment = await timedDeploy(session.recorder, "xcall-payment", "target", () =>
      deployTarget(session.facade, session.keys, session.config.networkId),
    );
    targetAddress = deployment.contractAddress;
  });

  it("deploys the caller referencing the target", async () => {
    const deployment = await timedDeploy(session.recorder, "xcall-payment", "caller", () =>
      deployCaller(session.facade, session.keys, session.config.networkId, targetAddress),
    );
    callerAddress = deployment.contractAddress;
  });

  it("REJECTS the callee's receiveShielded: Zswap ops are unsupported in sub-calls", async () => {
    const attempt = benchContract({
      session,
      experiment: "xcall-payment",
      contractAddress: callerAddress,
      compiledContract: callerCompiledContract,
      privateStateId: CALLER_PRIVATE_STATE_ID,
      storePrefix: "exp-xcall-payment",
      // Proof provider must span the WHOLE call tree: caller (root) + target.
      managedPaths: [callerManagedPath, targetManagedPath],
      plan: [{ circuit: "callOnce", args: () => [makePaymentCoin()] }],
      reps: 1,
    });

    const error = await attempt.then(
      () => {
        throw new Error(
          "callOnce SUCCEEDED — the runtime now supports Zswap ops in cross-contract callees; " +
            "rewrite this experiment to assert the deposit lands in the target's treasury",
        );
      },
      (thrown: unknown) => thrown,
    );
    expect(causeChainMessages(error)).toMatch(/Zswap local state is undefined for contract/);
  });

  it("the target's treasury was never written", async () => {
    const state = await session.publicDataProvider.queryContractState(targetAddress);
    expect(state).not.toBeNull();
    if (!state) throw new Error("unreachable: asserted above");

    const treasury = Target.ledger(state.data).treasury;
    expect(treasury.value).toBe(0n);
  });
});
