// Break experiment: deploys the break contract, which seals a reference to
// the signet contract at a fixed address, then calls its circuits under real
// proving. Tests run in order and share the one deployment.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Break, deployBreak, findDeployedBreak } from "@midnight-experiments/break-contract";
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

  it("doNothing writes its argument to the ledger", async () => {
    const deployed = await findDeployedBreak(session.facade, session.keys, session.config, breakAddress);
    const result = await deployed.callTx.doNothing(42n);
    console.log(`doNothing finalized in tx ${result.public.txId}`);
    expect((await readLedger()).ledgerNothing).toBe(42n);
  });
});
