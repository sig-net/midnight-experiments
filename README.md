# midnight-experiments

A place for agents and humans to try out Midnight blockchain features in
minimal, runnable experiments before moving them into other repositories.
Two kinds of experiment live here:

- **Benchmark experiments** measure how a Compact construct affects the three
  performance parameters of a Midnight contract: **circuit size**, **proof
  size** and **proving time**. They record JSONL observations and feed
  `yarn report`.
- **Feature experiments** prove or pin down behaviour (can a callee take coin
  custody? do cross-contract calls + MIP-0002 events work end to end?) with
  unit and integration tests, without recording measurements.

Toolchain (must match; pins copied from sig-net/midnight-erc20-vault-refactor):
compactc **0.33.0** / language 0.25.0 / compact-runtime 0.18.0-rc.1 /
midnight-js **5.0.0-beta.4** / ledger-v9 1.0.0-rc.3, against the local
standalone stack in [docker-compose.yaml](docker-compose.yaml).

## Layout

```
├── packages/                     # Shared plumbing, no experiment logic.
│   ├── lib/                      # @midnight-experiments/lib: runtime helpers every
│   │                             #   experiment imports (wallet facade, providers, deploy,
│   │                             #   instrumented proof provider, JSONL recorder, metrics).
│   ├── test-harness/             # @midnight-experiments/test-harness: test-only helpers:
│   │                             #   stack preflight + deployer wallet session lifecycle.
│   └── test-harness-benchmark/   # @midnight-experiments/test-harness-benchmark: the
│                                 #   benchmark harness on top of test-harness: bench session
│                                 #   (+ recorder), generic bench driver, shared vitest
│                                 #   config, and the `yarn report` renderer.
│
├── experiments/
│   └── <name>/
│       ├── README.md             # What the experiment shows/measures + how to run it.
│       ├── contract/             # @midnight-experiments/<name>-contract
│       │   ├── src/*.compact     # The contract(s) under test.
│       │   ├── src/index.ts      # Curated export surface (bindings, deploy fn, bench plan).
│       │   ├── src/managed/      # compactc output, gitignored; run compile first.
│       │   └── tests/            # Offline unit tests (simulator-level, no network).
│       └── integration-tests/    # @midnight-experiments/<name>-integration-tests
│           ├── tests/            # Live tests against the local stack, gated by
│           │                     #   RUN_INTEGRATION_TESTS (offline `yarn test` stays green).
│           └── vitest.config.ts  # Benchmark experiments reuse the shared bench config.
│
└── reports/                      # REPORT.md (generated), ANALYSIS.md (hand-written),
                                  #   raw/records.jsonl (committed raw bench observations,
                                  #   appended by every bench run).
```

Current experiments:

| Experiment | Type | What it answers |
|---|---|---|
| [baseline](experiments/baseline) | benchmark | The control every other benchmark is measured against, plus the proof-system floor (`noop`). |
| [events](experiments/events) | benchmark | Cost of firing 0/1/2/4 `Misc` events per call (payload fixed at `Bytes<256>`). |
| [hashing](experiments/hashing) | benchmark | Persistent vs transient hashing over 32/256/1024 B (+ controls isolating large-input cost). |
| [xcall](experiments/xcall) | benchmark | Cost of 0/1/2 cross-contract calls, a 256-byte call argument, and a callee that emits. |
| [xcall-with-payment](experiments/xcall-with-payment) | feature | Can a shielded coin cross a contract call? (No, plus the atomic two-root-call workaround that does work.) |
| [serde-builtin](experiments/serde-builtin) | feature | The exact byte layout of the builtin `serialize<T,N>`/`deserialize<T,N>` pair, pinned against a byte-identical TypeScript twin encoder. |
| [xcontract-events](experiments/xcontract-events) | feature | Cross-contract calls + MIP-0002 custom events, end to end, with a knowledge-base distilled from the spike. |

Every benchmark variant embeds the **identical base workload** (counter
increment + scalar ledger write + map insert), so any delta against the
control is attributable to the construct under test alone.

## Running

```bash
docker compose up -d      # node + indexer + proof server (ledger-9 line)
yarn install
yarn compile              # fast --skip-zk compile (typecheck prerequisite)
yarn build                # typecheck every workspace
yarn test                 # offline unit tests; live suites skip without RUN_INTEGRATION_TESTS

yarn compile:zk           # REQUIRED before live runs: generates proving keys (~3 min)
yarn bench                # every benchmark experiment, fresh deploys (~15-45 min)
yarn report               # writes reports/REPORT.md
```

### Running a single experiment

Every experiment (and every individual benchmark circuit) runs independently:
each run deploys a fresh contract, and `yarn report` composes results per
circuit (each row shows its most recent measurement):

```bash
yarn compile:zk:hashing            # keys for ONE experiment's contract (~seconds-minutes)
yarn bench:hashing                 # one benchmark experiment, all its circuits
yarn bench:hashing-control32       # ONE circuit (pattern: bench:<experiment>-<circuit>)
BENCH_CIRCUITS=control32,persistent32 yarn bench:hashing   # any subset

# feature experiments:
yarn test:xcall-payment-atomic         # the atomic cross-contract call + payment test
yarn test:integration:xcontract-events # the cross-contract + events e2e
```

Compile granularity is per CONTRACT package (`compile:zk:<experiment>`): a
`.compact` file compiles as one unit, so there is no per-circuit compile. The
full script list (including all 21 `bench:<experiment>-<circuit>` aliases) is
in [package.json](package.json).

Knobs: `BENCH_REPS` (default 2) repetitions per circuit; `BENCH_CIRCUITS`
(comma-separated circuit filter); `DEPLOYER_SEED` (defaults to the genesis
mint wallet of the dev chain); standard `MIDNIGHT_NODE_*` endpoint overrides
from lib.

> **TIP:** If you are using Claude Code you can ask it to run an experiment
> for you with the [run-experiment skill](.claude/skills/run-experiment/SKILL.md)
> (`/run-experiment hashing`); it brings the stack up, compiles keys, runs the
> suite and interprets failures for you.

## How the benchmark measurements work

- **Circuit size** (static): zkir instruction counts + prover/verifier key
  byte sizes read from each `managed/` dir after `yarn compile:zk`. NOTE:
  builtins like `persistentHash` expand inside *constraints*, not zkir
  instructions; prover key size is the honest size proxy (rows pad to the
  next power of two, visible as key-size tiers).
- **Proving time & proof size** (dynamic): an instrumented midnight-js proof
  provider times every `/check` + `/prove` round-trip to the local proof
  server and records the exact proof bytes returned. A cross-contract call
  proves once per contract in the call tree; each proof is recorded
  separately. The wallet's own fee/dust proving does not pass through this
  provider, so records isolate circuit proving exactly.
- Records land in `reports/raw/records.jsonl`; `yarn report` renders
  [reports/REPORT.md](reports/REPORT.md) (generated tables). The hand-written
  interpretation (what actually drives cost) is
  [reports/ANALYSIS.md](reports/ANALYSIS.md).

## Adding an experiment

Create `experiments/<name>/` with a `contract/` package (the `.compact`
source, an `index.ts` export surface, offline unit tests) and an
`integration-tests/` package (live tests gated by `RUN_INTEGRATION_TESTS`),
then add the matching `compile:zk:<name>` and run aliases to the root
[package.json](package.json). Copy the wiring of the closest existing
experiment: [baseline](experiments/baseline) is the minimal benchmark,
[xcontract-events](experiments/xcontract-events) the minimal feature
experiment. Benchmark experiments export a bench plan from the contract
package and reuse `defineBenchConfig()` +
`openBenchSession`/`benchContract` from
`@midnight-experiments/test-harness-benchmark`; feature experiments use
`openWalletSession` from `@midnight-experiments/test-harness` (or their own
wiring) and write a README stating the question the experiment answers.

> **TIP:** If you are using Claude Code you can ask it to scaffold all of this
> for you with the [add-experiment skill](.claude/skills/add-experiment/SKILL.md)
> (`/add-experiment my-new-experiment`); it creates both packages, the root
> aliases and the README skeleton for you.

## Reading list

The cross-contract + events groundwork (syntax, gotchas, proof-provider
wiring) is documented in
[experiments/xcontract-events/knowledge-base/](experiments/xcontract-events/knowledge-base/index.md).
