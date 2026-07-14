# Compact performance study — circuit size, proof size, proving time

Generated 2026-07-14T11:28:04.765Z from 4 recorded benchmark run(s)
(latest: `2026-07-14T11:26:55.378Z`; reps per circuit: 2). Each circuit
row shows its MOST RECENT measurement, so single-experiment runs (see the
"run it" lines above each table) refresh one row without invalidating the rest.

**Toolchain:** compactc 0.33.0 / language 0.25.0 / compact-runtime 0.18.0-rc.0 /
midnight-js 5.0.0-beta.3 / ledger-v9 1.0.0-rc.3 — local standalone stack
(node 2.0.0-rc.3, contract-events indexer 4.4.0-pre-alpha.16, proof-server 9.0.0-rc.3).

## Methodology

- **Circuit size** = instruction count of the compiled `zkir` program (plus
  prover/verifier key byte sizes) read from each contract's `managed/` output.
- **Proving time** = wall-clock of each `/prove` round-trip to the local proof
  server, measured inside an instrumented midnight-js proof provider. A
  cross-contract call proves once per contract in the call tree; per-callee
  rows are listed separately.
- **Proof size** = exact byte length returned by `/prove` for each call proof.
- **callTx** = end-to-end wall time of `contract.callTx.<circuit>(...)`:
  state resolution + check + prove + wallet balancing (fee proving) +
  submission + finalization. It includes ~6s block cadence noise; the prove
  column is the clean signal.
- Every circuit repeats 2× on freshly deployed contracts; all
  variants share an identical base workload (counter + scalar write + map
  insert), so deltas against the control isolate the construct under test.


## Experiment: baseline

Run it (stack up — `docker compose up -d` — and keys compiled):

- compile keys: `yarn compile:zk:baseline` — per CONTRACT: a `.compact` file compiles as one unit, so there is no per-circuit compile.
- run every circuit: `yarn bench:baseline`
- run one circuit: `yarn bench:baseline-<circuit>`, e.g. `yarn bench:baseline-base` — deploys a fresh contract and drives just that circuit. Any subset: `BENCH_CIRCUITS=noop,base yarn bench:baseline`.
- refresh this report: `yarn report` (updates only the rows you re-ran).

| circuit | zkir instrs | prover key | verifier key | prove (mean, all proofs) | proof bytes (total) | check (mean) | callTx e2e (mean) | n |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `noop` | 15 | 14,071 B | 1,351 B | 0.20s | 2,940 B | 0.01s | 18.06s | 2 |
| `base` | 59 | 146,922 B | 1,351 B | 0.24s | 2,940 B | 0.01s | 18.13s | 2 |

## Experiment: events

Run it (stack up — `docker compose up -d` — and keys compiled):

- compile keys: `yarn compile:zk:events` — per CONTRACT: a `.compact` file compiles as one unit, so there is no per-circuit compile.
- run every circuit: `yarn bench:events`
- run one circuit: `yarn bench:events-<circuit>`, e.g. `yarn bench:events-emit4` — deploys a fresh contract and drives just that circuit. Any subset: `BENCH_CIRCUITS=base,emit1 yarn bench:events`.
- refresh this report: `yarn report` (updates only the rows you re-ran).

| circuit | zkir instrs | prover key | verifier key | prove (mean, all proofs) | proof bytes (total) | check (mean) | callTx e2e (mean) | n |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `base` | 59 | 146,922 B | 1,351 B | 0.12s | 2,940 B | 0.01s | 17.40s | 2 |
| `emit1` | 337 | 33,732,171 B | 1,351 B | 6.71s | 2,940 B | 0.10s | 27.50s | 2 |
| `emit2` | 539 | 67,405,774 B | 1,351 B | 14.49s | 2,940 B | 0.19s | 35.51s | 2 |
| `emit4` | 943 | 67,484,124 B | 1,351 B | 12.37s | 2,940 B | 0.21s | 33.51s | 2 |

## Experiment: hashing

Run it (stack up — `docker compose up -d` — and keys compiled):

- compile keys: `yarn compile:zk:hashing` — per CONTRACT: a `.compact` file compiles as one unit, so there is no per-circuit compile.
- run every circuit: `yarn bench:hashing`
- run one circuit: `yarn bench:hashing-<circuit>`, e.g. `yarn bench:hashing-transient1024` — deploys a fresh contract and drives just that circuit. Any subset: `BENCH_CIRCUITS=control32,control256 yarn bench:hashing`.
- refresh this report: `yarn report` (updates only the rows you re-ran).

| circuit | zkir instrs | prover key | verifier key | prove (mean, all proofs) | proof bytes (total) | check (mean) | callTx e2e (mean) | n |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `control32` | 17 | 146,618 B | 1,351 B | 0.12s | 2,940 B | 0.01s | 18.01s | 2 |
| `control256` | 24 | 1,069,855 B | 1,351 B | 0.29s | 2,940 B | 0.01s | 18.11s | 2 |
| `control1024` | 49 | 4,227,357 B | 1,351 B | 0.79s | 2,940 B | 0.02s | 18.11s | 2 |
| `persistent32` | 37 | 2,817,122 B | 2,119 B | 0.62s | 4,508 B | 0.01s | 18.12s | 2 |
| `persistent256` | 44 | 5,203,587 B | 2,119 B | 1.05s | 4,508 B | 0.02s | 18.14s | 2 |
| `persistent1024` | 69 | 19,449,292 B | 2,119 B | 3.95s | 4,508 B | 0.06s | 23.47s | 2 |
| `persistentVec8` | 51 | 5,203,860 B | 2,119 B | 1.01s | 4,508 B | 0.02s | 18.14s | 2 |
| `transient32` | 37 | 146,892 B | 1,351 B | 0.13s | 2,940 B | 0.01s | 18.11s | 2 |
| `transient256` | 44 | 1,070,405 B | 1,351 B | 0.28s | 2,940 B | 0.02s | 18.12s | 2 |
| `transient1024` | 69 | 4,228,584 B | 1,351 B | 0.73s | 2,940 B | 0.02s | 18.11s | 2 |

## Experiment: xcall

Run it (stack up — `docker compose up -d` — and keys compiled):

- compile keys: `yarn compile:zk:xcall` — per CONTRACT (compiles both caller and target): a `.compact` file compiles as one unit, so there is no per-circuit compile.
- run every circuit: `yarn bench:xcall`
- run one circuit: `yarn bench:xcall-<circuit>`, e.g. `yarn bench:xcall-callEmit` — deploys a fresh contract and drives just that circuit. Any subset: `BENCH_CIRCUITS=localBase,callOnce yarn bench:xcall`.
- refresh this report: `yarn report` (updates only the rows you re-ran).

| circuit | zkir instrs | prover key | verifier key | prove (mean, all proofs) | proof bytes (total) | check (mean) | callTx e2e (mean) | n |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `localBase` | 59 | 146,947 B | 1,351 B | 0.12s | 2,940 B | 0.01s | 18.04s | 2 |
| `callOnce` | 85 | 279,686 B | 1,351 B | 0.27s | 5,880 B | 0.01s | 17.45s | 2 |
| `callTwice` | 139 | 543,821 B | 1,351 B | 0.45s | 8,820 B | 0.01s | 18.11s | 2 |
| `callBig` | 91 | 1,070,871 B | 1,351 B | 0.74s | 5,880 B | 0.02s | 18.11s | 2 |
| `callEmit` | 85 | 279,686 B | 1,351 B | 5.34s | 5,880 B | 0.05s | 24.13s | 2 |

### xcall: per-proof breakdown (multi-proof transactions)

| circuit | proved circuit | proofs/call | prove (mean) | proof bytes | preimage bytes |
| --- | --- | --- | --- | --- | --- |
| `callOnce` | `deposit` | 1 | 0.13s | 2,940 B | 356 B |
| `callOnce` | `callOnce` | 1 | 0.15s | 2,940 B | 590 B |
| `callTwice` | `deposit` | 2 | 0.10s | 2,940 B | 356 B |
| `callTwice` | `callTwice` | 1 | 0.24s | 2,940 B | 890 B |
| `callBig` | `depositBig` | 1 | 0.37s | 2,940 B | 524 B |
| `callBig` | `callBig` | 1 | 0.37s | 2,940 B | 819 B |
| `callEmit` | `callEmit` | 1 | 0.18s | 2,940 B | 590 B |
| `callEmit` | `depositEmit` | 1 | 5.17s | 2,940 B | 463 B |

## Computed comparisons (construct cost = to − from)

| construct | circuits | zkir instrs | prove time | proof bytes |
| --- | --- | --- | --- | --- |
| 1 event (256 B) | `base` → `emit1` | 59 → 337 (5.71×) | 0.12s → 6.71s (57.12×) | 2,940 B → 2,940 B |
| 2 events (512 B) | `base` → `emit2` | 59 → 539 (9.14×) | 0.12s → 14.49s (123.44×) | 2,940 B → 2,940 B |
| 4 events (1024 B) | `base` → `emit4` | 59 → 943 (15.98×) | 0.12s → 12.37s (105.35×) | 2,940 B → 2,940 B |
| 1 xcontract call | `localBase` → `callOnce` | 59 → 85 (1.44×) | 0.12s → 0.27s (2.21×) | 2,940 B → 5,880 B |
| 2 xcontract calls | `localBase` → `callTwice` | 59 → 139 (2.36×) | 0.12s → 0.45s (3.65×) | 2,940 B → 8,820 B |
| xcall w/ 256 B arg | `callOnce` → `callBig` | 85 → 91 (1.07×) | 0.27s → 0.74s (2.69×) | 5,880 B → 5,880 B |
| xcall + callee event | `callOnce` → `callEmit` | 85 → 85 (1.00×) | 0.27s → 5.34s (19.56×) | 5,880 B → 5,880 B |
| persistentHash 32 B | `control32` → `persistent32` | 17 → 37 (2.18×) | 0.12s → 0.62s (5.29×) | 2,940 B → 4,508 B |
| persistentHash 256 B | `control256` → `persistent256` | 24 → 44 (1.83×) | 0.29s → 1.05s (3.68×) | 2,940 B → 4,508 B |
| persistentHash 1024 B | `control1024` → `persistent1024` | 49 → 69 (1.41×) | 0.79s → 3.95s (4.99×) | 2,940 B → 4,508 B |
| transientHash 32 B | `control32` → `transient32` | 17 → 37 (2.18×) | 0.12s → 0.13s (1.07×) | 2,940 B → 2,940 B |
| transientHash 256 B | `control256` → `transient256` | 24 → 44 (1.83×) | 0.29s → 0.28s (0.99×) | 2,940 B → 2,940 B |
| transientHash 1024 B | `control1024` → `transient1024` | 49 → 69 (1.41×) | 0.79s → 0.73s (0.92×) | 2,940 B → 2,940 B |
| vector vs flat 256 B | `persistent256` → `persistentVec8` | 44 → 51 (1.16×) | 1.05s → 1.01s (0.96×) | 4,508 B → 4,508 B |

## Deploys (most recent per contract)

| experiment | contract | time | address |
| --- | --- | --- | --- |
| baseline | baseline | 19.93s | `71c7d28e975ddb43c4aad427f112e69c92193786ee26fd2331dbf9c84eaf581f` |
| events | events | 21.38s | `b7ee99a8361eed8bb2847847ba49ba7ff5968a677781fd93b691ca2268c1be5a` |
| hashing | hashing | 16.56s | `5246c55ec6108be9059d89947181a7c0eb6e802281a9cc57c621be424929eb55` |
| xcall | target | 19.76s | `752f3f2f2c5314cd58dcb65f446a2b8a82864daa68861f2d5d4c8872a7a7532e` |
| xcall | caller | 18.81s | `403cd36c71df9e811cda550701e72fd9e7aba7776191fc420e49743e48de377b` |
