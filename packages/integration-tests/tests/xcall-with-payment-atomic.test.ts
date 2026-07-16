// ATOMIC CROSS-CONTRACT CALL + PAYMENT.
//
// Two earlier findings constrain the design (see xcall-with-payment.test.ts):
//   1. A cross-contract CALLEE cannot perform Zswap coin operations, so a
//      callee can never take custody of a shielded coin.
//   2. The ledger's effects check requires the contract RECEIVING a coin to
//      claim it (receiveShielded) somewhere in the SAME transaction — nobody
//      can claim on its behalf.
//
// The resolution tested here: put the cross-contract call and the payment in
// TWO ROOT CALLS of ONE transaction, composed with the ledger's atomic
// Transaction.merge (Zswap's atomic-swap primitive):
//
//   op 1 — caller.request(requestId)
//            └─ cross-contract call → target.confirmRequest(requestId)
//               (a state-only write, which IS supported in callees;
//                this is the on-chain proof that communication took place)
//
//   op 2 — target.pay(requestId, coin)
//            receiveShielded(coin) as a ROOT call — legal custody transfer;
//            the deployer wallet funds the coin during balancing.
//            pay only ever WRITES (never reads what op 1 wrote), so the two
//            ops compose in one transaction without stale-read conflicts.
//
// Both ops land atomically or not at all. The test then reads the target's
// public ledger: the request must be recorded as communicated AND paid, and
// the treasury must hold the exact coin.
//
// TWO HARD-WON MECHANICS both ops' transcripts depend on (found by chasing
// Transcript(Execution(OutOfGas)) rejections):
//   - Each transcript carries an EXACT gas budget computed against the state
//     it was built on. Op 2 must therefore be built against op 1's local
//     post-execution state (threaded below via the callee's contractState
//     from op 1's call results), not the on-chain state.
//   - Merged intents apply in SEGMENT-ID order, and segment ids are drawn
//     randomly per build — so op 2 is rebuilt until its segment sorts after
//     op 1's, making apply order match the state threading.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createUnprovenCallTx,
  createUnprovenCallTxFromInitialStates,
  findDeployedContract,
  getPublicStates,
  submitTx,
} from "@midnight-ntwrk/midnight-js/contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { ChargedState } from "@midnight-ntwrk/midnight-js-protocol/onchain-runtime";
import type { UnprovenTransaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { SucceedEntirely, type FinalizedTxData, type MidnightProviders } from "@midnight-ntwrk/midnight-js-types";

import {
  buildExperimentProviders,
  createCrossContractProofServerProvider,
  createEmptyPrivateState,
  deriveAccountKeys,
  getDeployConfig,
  initialiseWalletFacade,
  type AccountKeys,
  type EmptyPrivateState,
  type MidnightNodeConfig,
  type WalletFacade,
} from "@midnight-experiments/lib";

import {
  CALLER_PRIVATE_STATE_ID,
  callerCompiledContract,
  callerManagedPath,
  deployCaller,
  deployTarget,
  makePaymentCoin,
  PAYMENT_VALUE,
  Target,
  TARGET_PRIVATE_STATE_ID,
  targetCompiledContract,
  targetManagedPath,
  type CallerCircuitId,
  type CallerPrivateStateId,
  type PaymentCoin,
  type TargetCircuitId,
  type TargetPrivateStateId,
} from "@midnight-experiments/xcall-with-payment-contract";

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

const normalizeAddress = (address: string): string => address.replace(/^0x/, "").toLowerCase();

const showCost = (cost: { readTime: bigint; computeTime: bigint; bytesWritten: bigint } | undefined): string =>
  cost ? `read=${cost.readTime} compute=${cost.computeTime} written=${cost.bytesWritten}` : "(none)";

/** Dump every contract call in the transaction with its per-transcript gas budget. */
function logTransactionCalls(label: string, tx: UnprovenTransaction): void {
  for (const [segment, intent] of tx.intents ?? new Map()) {
    for (const action of intent.actions) {
      if (!("entryPoint" in action)) continue;
      const entryPoint = typeof action.entryPoint === "string" ? action.entryPoint : toHex(action.entryPoint);
      console.log(
        `  [${label}] segment ${segment} → ${String(action.address).slice(0, 8)}….${entryPoint}\n` +
          `      guaranteed gas: ${showCost(action.guaranteedTranscript?.gas)}\n` +
          `      fallible gas:   ${showCost(action.fallibleTranscript?.gas)}`,
      );
    }
  }
}

function randomRequestId(): Uint8Array {
  const id = new Uint8Array(32);
  crypto.getRandomValues(id);
  return id;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("atomic cross-contract call + payment", () => {
  let config: MidnightNodeConfig;
  let keys: AccountKeys;
  let facade: WalletFacade;
  let providersCaller: MidnightProviders<CallerCircuitId, CallerPrivateStateId, EmptyPrivateState>;
  let providersTarget: MidnightProviders<TargetCircuitId, TargetPrivateStateId, EmptyPrivateState>;
  let zkTarget: NodeZkConfigProvider<TargetCircuitId>;
  let targetAddress: string;
  let callerAddress: string;

  // The linking key between the two operations, and the coin the target is paid.
  const requestId = randomRequestId();
  const coin: PaymentCoin = makePaymentCoin();

  beforeAll(async () => {
    // One synced wallet (the local stack's pre-funded genesis account) pays
    // for everything: deploys, fees, and the shielded coin itself.
    const deployConfig = getDeployConfig(process.env);
    config = deployConfig.midnightNodeConfig;
    setNetworkId(config.networkId);
    keys = deriveAccountKeys(deployConfig.deployerSeed, config.networkId);
    facade = await initialiseWalletFacade(keys, config);
    await facade.start(keys.shieldedSecretKeys, keys.dustSecretKey);
    await facade.waitForSyncedState();

    // One provider set per contract (each needs its own compiled ZK assets),
    // sharing a proof provider that spans BOTH contracts — the merged
    // transaction carries proofs for the caller, its callee, and pay.
    const zkCaller = new NodeZkConfigProvider<CallerCircuitId>(callerManagedPath);
    zkTarget = new NodeZkConfigProvider<TargetCircuitId>(targetManagedPath);
    const proofProvider = createCrossContractProofServerProvider(config.proofServerUrl, [zkCaller, zkTarget]);
    providersCaller = buildExperimentProviders<CallerCircuitId, CallerPrivateStateId>(
      facade,
      keys,
      config,
      "exp-xcall-payment-atomic-caller",
      zkCaller,
      proofProvider,
    );
    providersTarget = buildExperimentProviders<TargetCircuitId, TargetPrivateStateId>(
      facade,
      keys,
      config,
      "exp-xcall-payment-atomic-target",
      zkTarget,
      proofProvider,
    );
  });

  afterAll(async () => {
    await facade?.stop().catch(() => {});
  });

  it("deploys the target (B), then the caller (A) sealing a reference to it", async () => {
    targetAddress = (await deployTarget(facade, keys, config.networkId)).contractAddress;
    callerAddress = (await deployCaller(facade, keys, config.networkId, targetAddress)).contractAddress;
  });

  it("joins both contracts (verifies deployment, seeds local private state)", async () => {
    await findDeployedContract(providersCaller, {
      contractAddress: callerAddress,
      compiledContract: callerCompiledContract,
      privateStateId: CALLER_PRIVATE_STATE_ID,
      initialPrivateState: createEmptyPrivateState(),
    });
    await findDeployedContract(providersTarget, {
      contractAddress: targetAddress,
      compiledContract: targetCompiledContract,
      privateStateId: TARGET_PRIVATE_STATE_ID,
      initialPrivateState: createEmptyPrivateState(),
    });
  });

  it("control: the cross-contract request alone works as a single-operation transaction", async () => {
    // The other leg in isolation: the xcall through the hand-rolled pipeline.
    const controlRequestId = randomRequestId();
    const opControlRequest = await createUnprovenCallTx(providersCaller, {
      compiledContract: callerCompiledContract,
      contractAddress: callerAddress,
      circuitId: "request",
      args: [controlRequestId],
      privateStateId: CALLER_PRIVATE_STATE_ID,
    });
    logTransactionCalls("control-request", opControlRequest.private.unprovenTx);
    const finalized: FinalizedTxData = await submitTx(providersCaller, {
      unprovenTx: opControlRequest.private.unprovenTx,
    });
    console.log(`  control request tx ${finalized.txId} → ${finalized.status}`);
    expect(finalized.status).toBe(SucceedEntirely);

    const state = await providersTarget.publicDataProvider.queryContractState(targetAddress);
    expect(state).not.toBeNull();
    if (!state) throw new Error("unreachable: asserted above");
    expect(Target.ledger(state.data).requests.member(controlRequestId)).toBe(true);
  });

  it("control: pay alone works as a single-operation transaction", async () => {
    // Before testing the atomic composition, prove the payment leg in
    // isolation: a ROOT call doing receiveShielded, built and submitted
    // through the same hand-rolled pipeline (minus the merge).
    const controlRequestId = randomRequestId();
    const controlCoin = makePaymentCoin();

    const opControlPay = await createUnprovenCallTx(providersTarget, {
      compiledContract: targetCompiledContract,
      contractAddress: targetAddress,
      circuitId: "pay",
      args: [controlRequestId, controlCoin],
      privateStateId: TARGET_PRIVATE_STATE_ID,
    });
    logTransactionCalls("control-pay", opControlPay.private.unprovenTx);
    const finalized: FinalizedTxData = await submitTx(providersTarget, {
      unprovenTx: opControlPay.private.unprovenTx,
    });
    console.log(`  control pay tx ${finalized.txId} → ${finalized.status}`);
    expect(finalized.status).toBe(SucceedEntirely);

    const state = await providersTarget.publicDataProvider.queryContractState(targetAddress);
    expect(state).not.toBeNull();
    if (!state) throw new Error("unreachable: asserted above");
    expect(Target.ledger(state.data).paidRequests.member(controlRequestId)).toBe(true);
  });

  it("submits the cross-contract call AND the payment as ONE atomic transaction", async () => {
    // Op 1 — root call on the CALLER: request(requestId) cross-calls
    // target.confirmRequest(requestId). Nothing is submitted yet; this only
    // builds the unproven transaction locally.
    const opRequest = await createUnprovenCallTx(providersCaller, {
      compiledContract: callerCompiledContract,
      contractAddress: callerAddress,
      circuitId: "request",
      args: [requestId],
      privateStateId: CALLER_PRIVATE_STATE_ID,
    });

    // Op 1's cross-contract call already wrote the target's state — locally,
    // unsubmitted. Op 2 must therefore be built against that POST-op-1 state,
    // not the on-chain state: at apply time op 1 lands first, and a transcript
    // built on stale state carries a too-small gas budget — the node rejects
    // the whole transaction with Transcript(Execution(OutOfGas)). (This
    // mirrors what midnight-js's scoped transactions do internally when
    // batching calls on ONE contract; here we thread the state across TWO.)
    const calleeEntry = opRequest.calls.find(
      (call) => normalizeAddress(String(call.contractAddress)) === normalizeAddress(targetAddress),
    );
    if (!calleeEntry) throw new Error("op 1 made no cross-contract call to the target");

    const { contractState, zswapChainState, ledgerParameters } = await getPublicStates(
      providersTarget.publicDataProvider,
      targetAddress,
    );
    contractState.data = new ChargedState(calleeEntry.public.contractState);

    // Op 2 — root call on the TARGET: pay(requestId, coin). receiveShielded
    // is legal here because pay is a ROOT call, not a callee.
    //
    // ORDERING: intents in a merged transaction apply in SEGMENT-ID order,
    // and each build draws a random segment id. Op 2 was built on op 1's
    // post-state, so op 1 must apply FIRST — otherwise op 1's transcript
    // absorbs op 2's writes and blows its gas budget (OutOfGas at the node).
    // Rebuild op 2 (a cheap local operation) until its segment id sorts
    // after op 1's.
    const segmentOf = (tx: UnprovenTransaction): number => {
      const segments = [...(tx.intents?.keys() ?? [])];
      if (segments.length !== 1) throw new Error(`expected exactly one intent, got ${segments.length}`);
      return segments[0] as number;
    };
    const requestSegment = segmentOf(opRequest.private.unprovenTx);

    const buildPay = () =>
      createUnprovenCallTxFromInitialStates(
        zkTarget,
        {
          compiledContract: targetCompiledContract,
          contractAddress: targetAddress,
          circuitId: "pay",
          args: [requestId, coin],
          coinPublicKey: providersTarget.walletProvider.getCoinPublicKey(),
          initialContractState: contractState,
          initialZswapChainState: zswapChainState,
          ledgerParameters,
          initialPrivateState: createEmptyPrivateState(),
        },
        providersTarget.walletProvider.getEncryptionPublicKey(),
      );

    let opPay = await buildPay();
    for (let attempt = 0; segmentOf(opPay.private.unprovenTx) < requestSegment && attempt < 32; attempt++) {
      opPay = await buildPay();
    }
    if (segmentOf(opPay.private.unprovenTx) < requestSegment) {
      throw new Error("could not draw a pay segment id sorting after the request's — rerun the test");
    }

    // The crux: merge the two operations into ONE transaction. From here on
    // they succeed or fail together.
    const atomicTx = opRequest.private.unprovenTx.merge(opPay.private.unprovenTx);
    logTransactionCalls("atomic-merged", atomicTx);

    // Prove every call in the merged transaction (request + confirmRequest +
    // pay), have the wallet fund the coin and the fees, and submit.
    const finalized: FinalizedTxData = await submitTx(providersCaller, { unprovenTx: atomicTx });
    console.log(`  atomic tx ${finalized.txId} → ${finalized.status}`);
    expect(finalized.status).toBe(SucceedEntirely);
  });

  it("the target records the communication, the payment, and holds the coin", async () => {
    const state = await providersTarget.publicDataProvider.queryContractState(targetAddress);
    expect(state).not.toBeNull();
    if (!state) throw new Error("unreachable: asserted above");
    const ledger = Target.ledger(state.data);

    // Written by op 1's CALLEE (the cross-contract call happened)...
    expect(ledger.requests.member(requestId)).toBe(true);
    // ...written by op 2's root call (the payment happened)...
    expect(ledger.paidRequests.member(requestId)).toBe(true);
    // ...and the target owns the exact coin we paid it.
    expect(ledger.treasury.value).toBe(PAYMENT_VALUE);
    expect(toHex(ledger.treasury.color)).toBe(toHex(coin.color));
    expect(toHex(ledger.treasury.nonce)).toBe(toHex(coin.nonce));
  });
});
