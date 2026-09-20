// Break experiment: deploys the break contract, which seals a reference to
// the signet contract at a fixed address, then calls its circuits under real
// proving. Tests run in order and share the one deployment.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Break, deployBreak, findDeployedBreak } from "@midnight-experiments/break-contract";
import {
  evmAddressAbiWord,
  MPCDestination,
  MPCSignatureAlgorithm,
  numericAbiWord,
  TxParamType,
} from "@sig-net/midnight";
import { openWalletSession, type WalletSession } from "@midnight-experiments/test-harness";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("break", () => {
  let session: WalletSession;
  let breakAddress: string;

  async function readLedger(): Promise<Break.Ledger> {
    const state = await session.publicDataProvider.queryContractState(breakAddress);
    if (!state) throw new Error(`no contract state at ${breakAddress}`);
    return Break.ledger(state.data);
  }

  beforeAll(async () => {
    session = await openWalletSession(process.env);
  });

  afterAll(async () => {
    await session?.close();
  });

  it("deploys the break contract", async () => {
    const deployment = await deployBreak(session.facade, session.keys, session.config.networkId);
    breakAddress = deployment.contractAddress;
    console.log(`break deployed at ${breakAddress}`);
  });

  it("requestSignature stores the request and notifies the signet contract", async () => {
    const deployed = await findDeployedBreak(session.facade, session.keys, session.config, breakAddress);

    const schema = new TextEncoder().encode('[{"name":"success","type":"bool"}]');
    const path = new Uint8Array(32).fill(0x07);
    const txParams = {
      chainId: 11155111n,
      nonce: 0n,
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
          words: [evmAddressAbiWord(new Uint8Array(20).fill(0xbb)), numericAbiWord(1234n)],
        },
      },
      accessListEntryCount: 0n,
      accessList: [],
    };

    const result = await deployed.callTx.requestSignature(
      0n, // requestNonce
      1n, // keyVersion
      path,
      MPCSignatureAlgorithm.ecdsa,
      MPCDestination.unused,
      new Uint8Array(64),
      TxParamType.evmType2,
      txParams,
      new Uint8Array(32).fill(0x01), // caip2Id
      schema,
      schema,
      1n, // requestsPathDepth: signBidirectionalEventMap is ledger index 0
      [0n, 0n, 0n, 0n],
    );
    const requestId = result.private.result;
    console.log(`requestSignature finalized in tx ${result.public.txId}`);

    const stored = (await readLedger()).signBidirectionalEventMap.lookup(requestId);
    expect(stored.path).toEqual(path);
    expect(stored.txParams.calldata.value.words[1]).toEqual(numericAbiWord(1234n));
  });
});
