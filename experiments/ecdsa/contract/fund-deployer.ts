// Fund a dedicated deployer wallet for the ecdsa e2e from the local genesis
// mint wallet, retrying through dust contention from concurrent suites on a
// shared stack (`yarn fund-deployer` with CHILD_SEED set; see the experiment
// README). The genesis wallet fails submissions with node Custom error 196
// (DustDoubleSpend) whenever another suite spends its dust concurrently; a
// dedicated funded seed makes the e2e immune after this one transfer lands.

import {
  fundChildFromRoot,
  GENESIS_MINT_WALLET_SEED,
  getMidnightNodeConfig,
  isFeeReady,
  readAccountFunding,
} from "@sig-net/midnight-contract-deploy";

const CHILD_SEED = process.env.CHILD_SEED;
if (!CHILD_SEED) throw new Error("CHILD_SEED is not set");

const config = getMidnightNodeConfig(process.env);

const existing = await readAccountFunding(config, CHILD_SEED);
if (isFeeReady(existing)) {
  console.log(`child already fee-ready: NIGHT ${existing.night}, DUST ${existing.dust}`);
  process.exit(0);
}

const root = await readAccountFunding(config, GENESIS_MINT_WALLET_SEED);
console.log(`root NIGHT ${root.night}, DUST ${root.dust}`);
const amount = root.night / 50n;

for (let attempt = 1; attempt <= 8; attempt++) {
  try {
    const funded = await fundChildFromRoot(config, GENESIS_MINT_WALLET_SEED, CHILD_SEED, amount);
    console.log(`child funded: NIGHT ${funded.night}, DUST ${funded.dust}`);
    process.exit(0);
  } catch (error) {
    console.log(`funding attempt ${attempt} failed: ${(error as Error).message}`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}
throw new Error("could not fund the child wallet after 8 attempts");
