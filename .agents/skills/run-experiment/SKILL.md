---
name: run-experiment
description: Run one experiment (or all of them) against the local docker stack,
  from a cold clone to a green suite, including zk key generation, benchmark
  subsets and report refresh. Use whenever asked to run, re-run or debug an
  experiment in this repository, e.g. `/run-experiment hashing` or
  `/run-experiment` to be guided through the choice.
---

# run-experiment

Run everything from the repo root. If no experiment name was given, list the
current experiments (the directories under `experiments/`) with the one-line
"what it answers" from each `experiments/<name>/README.md` and ask which to
run. There are two kinds and they run differently:

- **benchmark experiments** (`baseline`, `events`, `hashing`, `xcall`): run
  via `yarn bench:<name>`, record JSONL observations, and feed `yarn report`.
- **feature experiments** (`xcall-with-payment`, `xcontract-events`): run via
  their dedicated script (`yarn test:xcall-payment-atomic`,
  `yarn bench:xcall-payment`, `yarn test:integration:xcontract-events`).

## Cold start (zero to green)

```sh
corepack enable                # yarn 4 via the packageManager field
yarn install                   # NEVER from inside a member package
docker compose up -d           # node :9944, indexer :8088, proof server :6300
yarn compile:zk:<name>         # proving keys for ONE experiment (seconds to minutes)
yarn bench:<name>              # or the feature experiment's script
```

- If another matched Midnight stack is already running with the same
  container names (`midnight-node`, `midnight-indexer`,
  `midnight-proof-server`, e.g. from sig-net/midnight-examples), REUSE it; do
  not start this compose file on top.
- `compact` toolchain: the contracts need compactc 0.33.0 (language 0.25).
  Check with `compact compile --version`. A bare `compact update` may install
  a mismatched stable; if the version is wrong the compile fails with a
  `language version ... mismatch` error.
- The full `yarn compile:zk` (every contract) takes ~3 minutes;
  `yarn bench` (every benchmark experiment) takes ~15-45 minutes. BACKGROUND
  anything that may zk-compile or bench (`> run.log 2>&1 &`) and watch the
  log; never sit on a short foreground timeout.

## Running

- One benchmark experiment: `yarn bench:<name>` (fresh deploy every run).
- One circuit: `yarn bench:<experiment>-<circuit>`
  (e.g. `yarn bench:hashing-control32`); any subset:
  `BENCH_CIRCUITS=a,b yarn bench:<name>`.
- Everything: `yarn bench` (all benchmark experiments, grouped under one
  BENCH_RUN_ID), then the feature scripts separately.
- After benchmark runs: `yarn report` rewrites `reports/REPORT.md` composing
  each circuit's most recent measurement; it needs `yarn compile:zk` output
  for the static columns.
- Knobs: `BENCH_REPS` (default 2), `DEPLOYER_SEED` (defaults to the dev
  chain's genesis mint wallet), `MIDNIGHT_NODE_*` endpoint overrides.
- Offline check first when in doubt: `yarn compile && yarn build && yarn test`
  must be green without any stack (live suites skip unless
  RUN_INTEGRATION_TESTS is set by the run scripts).

## Reading failures

- `... not reachable at ...`: the stack is not up (or the wrong ports).
  `docker compose up -d`, then check `docker ps`.
- `ENOENT ... managed/... keys` or zk-config errors at deploy/prove time: the
  experiment was compiled without keys. Run `yarn compile:zk:<name>` (NOT
  plain `compile`, which is `--skip-zk`).
- `circuit '<x>' not found on the deployed contract's callTx`: the compiled
  binding and the bench plan disagree; recompile (`yarn compile:zk:<name>`)
  and rerun so a fresh contract is deployed.
- `BENCH_CIRCUITS names unknown circuit(s)`: the filter names circuits the
  experiment does not have; the error lists the valid ones.
- Wallet sync hanging or `Insufficient funds ... Dust`: the deployer wallet's
  NIGHT has not generated spendable DUST yet, or the chain was restarted
  while a stale level-db cache exists. Delete the package's
  `midnight-level-db/` directory and rerun; dust accrues on its own.
- Proof server `ECONNREFUSED :6300` mid-run with the container `Exited (137)`:
  OOM-killed. `docker restart midnight-proof-server` and rerun the experiment
  (each run deploys fresh, nothing to resume).
- The xcall-with-payment rejection test failing at its `REJECTS` step means
  the runtime STARTED supporting callee Zswap ops: that is a finding, not an
  infra failure. Report it; the experiment README says what to flip.
