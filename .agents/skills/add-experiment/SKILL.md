---
name: add-experiment
description: Scaffold a new experiment in this repository, e.g.
  `/add-experiment my-new-experiment`. Creates the contract and
  integration-tests packages under experiments/<name>/, wires the root
  aliases, and leaves runnable TODO-marked stubs. Use whenever asked to add,
  create or scaffold a new experiment.
---

# add-experiment

Input: the experiment name (kebab-case; it becomes the directory and package
names). If it was not given, ask for it, and ask ONE more question: is this a
**benchmark** experiment (measures circuit size / proof size / proving time,
feeds `yarn report`) or a **feature** experiment (proves or pins behaviour
with plain tests)? Everything else follows from that choice.

Ask what the experiment is trying to answer (one sentence). That sentence is
the first line of its README and drives the contract stub.

## Both kinds: the common scaffold

Create `experiments/<name>/` with two workspace packages (the root
`package.json` workspaces glob `experiments/*/*` picks them up; run
`yarn install` after creating the manifests):

```
experiments/<name>/
├── README.md                       # the question + how to run it
├── contract/                       # @midnight-experiments/<name>-contract
│   ├── package.json
│   ├── tsconfig.json               # extends ../../../tsconfig.base.json
│   ├── .gitignore                  # src/managed/
│   ├── src/<name>.compact
│   ├── src/index.ts                # curated export surface
│   └── tests/                      # offline unit tests (optional but encouraged)
└── integration-tests/              # @midnight-experiments/<name>-integration-tests
    ├── package.json
    ├── tsconfig.json               # extends ../../../tsconfig.base.json
    ├── vitest.config.ts
    └── tests/<name>.test.ts        # gated by RUN_INTEGRATION_TESTS
```

Copy the wiring of the closest existing experiment rather than writing
manifests from memory:

- benchmark: copy from `experiments/baseline/` (single contract) or
  `experiments/xcall/` (two contracts, cross-contract).
- feature: copy from `experiments/xcontract-events/`.

Rules that keep the workspace consistent:

- Package names are `@midnight-experiments/<name>-contract` and
  `@midnight-experiments/<name>-integration-tests`, both `"private": true`.
- The contract package exposes `"exports": { ".": "./src/index.ts" }`; tests
  and other packages import the package name, never `../src`.
- Contract scripts: `compile` (with `--skip-zk`), `compile:zk`, `build`
  (tsc), `test` (`vitest run --passWithNoTests`). Keep compile paths as
  `src/<x>.compact src/managed/<x>`.
- Integration-tests scripts: `build`, `test` (`vitest run
  --passWithNoTests`, so offline `yarn test` stays green), and the live
  script(s) prefixed `RUN_INTEGRATION_TESTS=1 vitest run ... --bail 1
  --disable-console-intercept`.
- `src/managed/` stays gitignored; never commit compiler output.
- Match the pinned dependency versions used by the experiment you copied
  from (midnight-js 5.0.0-beta.4 line); do not introduce new version lines.

## Benchmark experiments only

- The contract embeds the SHARED BASE WORKLOAD (see
  `experiments/baseline/contract/src/baseline.compact`: counter increment +
  scalar ledger write + map insert) in every measured circuit, so deltas
  against baseline isolate the construct under test.
- `src/index.ts` exports, like baseline's: the generated contract module,
  `makeVacantCompiledContract` binding, `<NAME>_PRIVATE_STATE_ID`, the
  managed path, a deploy function, and a `BenchCircuitSpec[]` bench plan.
- The live script is named exactly `bench` (that is what the root
  `yarn bench` foreach picks up), and the test drives the plan through
  `openBenchSession` + `timedDeploy` + `benchContract` from
  `@midnight-experiments/test-harness-benchmark`, asserting
  `plan.length * BENCH_REPS` transactions plus a ledger sanity read (copy
  `experiments/baseline/integration-tests/tests/baseline.test.ts`).
- `vitest.config.ts` is two lines: default-export
  `defineBenchConfig()` from
  `@midnight-experiments/test-harness-benchmark/vitest` (pass a file-order
  array only if the package has several test files).
- Root `package.json` additions: `compile:zk:<name>` and `bench:<name>`
  aliases, plus optional `bench:<name>-<circuit>` one-liners
  (`BENCH_CIRCUITS=<circuit> yarn bench:<name>`).
- If the report should show static metrics for the new contract, add its
  managed path and plan to `CONTRACTS` and `PLANS` in
  `packages/test-harness-benchmark/scripts/report.ts`.

## Feature experiments only

- No recorder, no bench plan. The live test opens a session with
  `openWalletSession` from `@midnight-experiments/test-harness` (or its own
  wiring when it needs something exotic), deploys via the contract package's
  deploy function, drives the behaviour, and asserts on ledger state.
- Name the live script `test:integration` and add a root alias
  `test:integration:<name>`. Do NOT name it `bench` (that would pull it into
  `yarn bench`).
- The README must state the QUESTION the experiment answers and, once run,
  the FINDING. A feature experiment whose finding is "no" should pin the
  failure in a test the way
  `experiments/xcall-with-payment/integration-tests/tests/xcall-with-payment.test.ts`
  does, so a behaviour change flips the test.

## Finish

1. `yarn install` (workspace registration), then `yarn compile`,
   `yarn build`, `yarn test`: all must be green offline with the stubs in
   place.
2. Add the experiment's row to the "Current experiments" table in the root
   `README.md`.
3. Write `experiments/<name>/README.md`: the question, the run commands, the
   layout note. Follow an existing experiment's README shape.
4. Offer to run it live (the run-experiment skill covers stack bring-up, zk
   keys and failure reading).
