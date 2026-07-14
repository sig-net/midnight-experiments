# midnight-experiments

Yarn workspace benchmarking how Compact constructs affect the three
performance parameters of a Midnight contract: **circuit size**, **proof
size** and **proving time** (the last two being the most important).

Toolchain (must match — pins copied from sig-net/midnight-erc20-vault-refactor):
compactc **0.33.0** / language 0.25.0 / compact-runtime 0.18.0-rc.0 /
midnight-js **5.0.0-beta.3** / ledger-v9 1.0.0-rc.3, against the local
standalone stack in [docker-compose.yaml](docker-compose.yaml).

## Required investigations → where they live

| Investigation | Experiment package | Measured circuits |
|---|---|---|
| Firing events of different sizes (the `Misc` payload is FIXED at `Bytes<256>` in compactc 0.33, so "size" scales in 256-byte steps: 0/256/512/1024 B) | [packages/events-contract](packages/events-contract) | `base`, `emit1`, `emit2`, `emit4` |
| Cross-contract calls of different sizes (0/1/2 calls; a 256-byte call argument; a call whose callee fires an event) | [packages/xcall-contract](packages/xcall-contract) | `localBase`, `callOnce`, `callTwice`, `callBig`, `callEmit` |
| Hashing byte arrays / data structures of different sizes (persistent vs transient hash over 32/256/1024 B + a `Vector<8, Bytes<32>>`; no-hash controls isolate the cost of large circuit *inputs*) | [packages/hashing-contract](packages/hashing-contract) | `control*`, `persistent*`, `transient*`, `persistentVec8` |
| The control everything is measured against ("does some logic, mints something, some storage") | [packages/baseline-contract](packages/baseline-contract) | `noop`, `base` |

Every variant embeds the **identical base workload** (counter increment +
scalar ledger write + map insert), so any delta against the control is
attributable to the construct under test alone.

## Layout

```
└── packages/
    ├── lib/                  # @midnight-experiments/lib — shared runtime plumbing
    │   └── src/              #   (wallet facade, deploy, providers — ported from the
    │                         #    refactor repo) + bench.ts (instrumented proof
    │                         #    provider, JSONL recorder) + circuit-metrics.ts
    ├── baseline-contract/    # each experiment package: src/<x>.compact + index.ts
    ├── events-contract/      #   (compiled binding, deploy fn, bench plan)
    ├── hashing-contract/
    ├── xcall-contract/       # TWO contracts: caller seals a ref to target
    └── integration-tests/
        ├── src/              # session (facade + preflight), run-bench driver
        ├── tests/            # baseline / events / hashing / xcall benchmarks
        └── scripts/report.ts # renders reports/REPORT.md
```

## How the measurements work

- **Circuit size** (static): zkir instruction counts + prover/verifier key
  byte sizes read from each `managed/` dir after `yarn compile:zk`. NOTE:
  builtins like `persistentHash` expand inside *constraints*, not zkir
  instructions — prover key size is the honest size proxy (rows pad to the
  next power of two, visible as key-size tiers).
- **Proving time & proof size** (dynamic): an instrumented midnight-js proof
  provider times every `/check` + `/prove` round-trip to the local proof
  server and records the exact proof bytes returned. A cross-contract call
  proves once per contract in the call tree — each proof is recorded
  separately. The wallet's own fee/dust proving does not pass through this
  provider, so records isolate circuit proving exactly.
- Records land in `reports/raw/records.jsonl`; `yarn report` renders
  [reports/REPORT.md](reports/REPORT.md) (generated tables). The hand-written
  interpretation — what actually drives cost — is
  [reports/ANALYSIS.md](reports/ANALYSIS.md).

## Running

```bash
docker compose up -d      # node + indexer + proof server (ledger-9 line)
yarn install
yarn compile:zk           # REQUIRED before bench: generates proving keys (~3 min)
yarn build                # typecheck
yarn bench                # deploys fresh contracts + drives every circuit (~15-45 min)
yarn report               # writes reports/REPORT.md
```

### Running a single experiment

Every experiment (and every individual circuit) runs independently — each run
deploys a fresh contract, and `yarn report` composes results per circuit
(each row shows its most recent measurement):

```bash
yarn compile:zk:hashing            # keys for ONE contract (~seconds-minutes)
yarn bench:hashing                 # one experiment, all its circuits
yarn bench:hashing-control32      # ONE circuit (pattern: bench:<experiment>-<circuit>)
BENCH_CIRCUITS=control32,persistent32 yarn bench:hashing   # any subset
yarn report
```

Compile granularity is per CONTRACT (`compile:zk:baseline|events|hashing|xcall`)
— a `.compact` file compiles as one unit, so there is no per-circuit compile.
The full script list (all 21 `bench:<experiment>-<circuit>` aliases) is in
[package.json](package.json); the per-experiment run commands are also printed
above each table in [reports/REPORT.md](reports/REPORT.md).

Knobs: `BENCH_REPS` (default 2) repetitions per circuit; `BENCH_CIRCUITS`
(comma-separated circuit filter); `DEPLOYER_SEED` (defaults to the genesis
mint wallet of the dev chain); standard `MIDNIGHT_NODE_*` endpoint overrides
from lib.

## Reading list

The cross-contract + events groundwork (syntax, gotchas, proof-provider
wiring) is documented in the refactor repo:
`sig-net/midnight-erc20-vault-refactor/packages/xcontract-events/knowledge-base/`.
