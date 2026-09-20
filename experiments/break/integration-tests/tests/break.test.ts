// Break experiment: reproduces the MPC's "fallible singleton calls are
// unsupported" skip with one deploy and one call. requestSignature makes
// REQUEST_COUNT signet calls in one transaction, enough for the ledger's
// transcript partitioning to put every call in the fallible section. Tests
// run in order and share the one deployment.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUnprovenCallTx } from "@midnight-ntwrk/midnight-js/contracts";

import {
  Break,
  BREAK_PRIVATE_STATE_ID,
  breakCompiledContract,
  buildBreakProviders,
  deployBreak,
  findDeployedBreak,
} from "@midnight-experiments/break-contract";
import {
  evmAddressAbiWord,
  MPCDestination,
  MPCSignatureAlgorithm,
  numericAbiWord,
  TxParamType,
} from "@sig-net/midnight";
import { openWalletSession, type WalletSession } from "@midnight-experiments/test-harness";

// Must equal the vector length requestSignature takes in break.compact. 16 is
// the smallest count that goes fallible on the local stack: 15 stays guaranteed.
const REQUEST_COUNT = 16;

// signBidirectionalEventMap is ledger index 0.
const REQUESTS_PATH_DEPTH = 1n;
const REQUESTS_PATH = [0n, 0n, 0n, 0n];

const schema = new TextEncoder().encode('[{"name":"success","type":"bool"}]');

const breakRequest = (requestNonce: bigint, amount: bigint): Break.BreakRequest => ({
  requestNonce,
  keyVersion: 1n,
  path: new Uint8Array(32).fill(0x07),
  algo: MPCSignatureAlgorithm.ecdsa,
  dest: MPCDestination.unused,
  params: new Uint8Array(64),
  txParamType: TxParamType.evmType2,
  txParams: {
    chainId: 11155111n,
    nonce: requestNonce,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    gasLimit: 100_000n,
    to: new Uint8Array(20).fill(0xaa),
    value: 0n,
    calldata: {
      is_some: true,
      value: {
        selector: Uint8Array.from([0xa9, 0x05, 0x9c, 0xbb]), // transfer(address,uint256)
        noWords: 2n,
        words: [evmAddressAbiWord(new Uint8Array(20).fill(0xbb)), numericAbiWord(amount)],
      },
    },
    accessListEntryCount: 0n,
    accessList: [],
  },
  outputDeserializationSchema: schema,
  respondSerializationSchema: schema,
});

const breakRequests = Array.from({ length: REQUEST_COUNT }, (_, i) => breakRequest(BigInt(i), 1234n + BigInt(i)));

type Transcript = { gas: { readTime: bigint; computeTime: bigint } } | undefined;
type CallLike = { address: string; entryPoint: unknown; guaranteedTranscript: Transcript; fallibleTranscript: Transcript };

/** Log which section the ledger's transcript partitioning put each contract call in. */
function logCallSections(tx: { intents?: Map<number, { actions: unknown[] }> }): CallLike[] {
  const calls = [...(tx.intents?.values() ?? [])]
    .flatMap((intent) => intent.actions)
    .filter((action): action is CallLike => typeof action === "object" && action !== null && "entryPoint" in action);
  for (const call of calls) {
    const sections = [
      ["guaranteed", call.guaranteedTranscript] as const,
      ["fallible", call.fallibleTranscript] as const,
    ].flatMap(([name, transcript]) =>
      transcript ? [`${name} (${transcript.gas.readTime + transcript.gas.computeTime} ps)`] : [],
    );
    console.log(`  ${call.address}.${String(call.entryPoint)}: ${sections.join(" + ")}`);
  }
  return calls;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("break", () => {
  let session: WalletSession;
  let providers: ReturnType<typeof buildBreakProviders>;
  let breakAddress: string;

  async function readLedger(): Promise<Break.Ledger> {
    const state = await session.publicDataProvider.queryContractState(breakAddress);
    if (!state) throw new Error(`no contract state at ${breakAddress}`);
    return Break.ledger(state.data);
  }

  beforeAll(async () => {
    session = await openWalletSession(process.env);
    providers = buildBreakProviders(session.facade, session.keys, session.config);
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the break contract", async () => {
    const deployment = await deployBreak(session.facade, session.keys, session.config.networkId);
    breakAddress = deployment.contractAddress;
    console.log(`break deployed at ${breakAddress}`);
  });

  it("dry run: reports the partition of requestSignature without proving", async () => {
    // Registers the contract's private state, which createUnprovenCallTx reads.
    await findDeployedBreak(providers, breakAddress);
    const unproven = await createUnprovenCallTx(providers, {
      compiledContract: breakCompiledContract,
      contractAddress: breakAddress,
      circuitId: "requestSignature",
      privateStateId: BREAK_PRIVATE_STATE_ID,
      args: [breakRequests, REQUESTS_PATH_DEPTH, REQUESTS_PATH],
    });
    console.log("dry run partition:");
    logCallSections(unproven.private.unprovenTx);
  });

  it.skipIf(!!process.env.BREAK_DRY_RUN_ONLY)("requestSignature stores every request and notifies the signet contract", async () => {
    const deployed = await findDeployedBreak(providers, breakAddress);

    const result = await deployed.callTx.requestSignature(breakRequests, REQUESTS_PATH_DEPTH, REQUESTS_PATH);
    const requestIds = result.private.result;
    console.log(`requestSignature finalized in tx ${result.public.txId}`);
    const calls = logCallSections(result.public.tx);

    const signetCalls = calls.filter((call) => String(call.entryPoint) === "signBidirectional");
    expect(signetCalls).toHaveLength(REQUEST_COUNT);
    for (const call of signetCalls) {
      expect(call.fallibleTranscript).toBeDefined();
      expect(call.guaranteedTranscript).toBeUndefined();
    }

    expect(requestIds).toHaveLength(REQUEST_COUNT);

    const { signBidirectionalEventMap } = await readLedger();
    expect(signBidirectionalEventMap.size()).toBe(BigInt(REQUEST_COUNT));
    requestIds.forEach((requestId, i) => {
      const stored = signBidirectionalEventMap.lookup(requestId);
      expect(stored.requestNonce).toBe(breakRequests[i].requestNonce);
      expect(stored.txParams.calldata.value.words).toEqual(breakRequests[i].txParams.calldata.value.words);
    });
  });
});
