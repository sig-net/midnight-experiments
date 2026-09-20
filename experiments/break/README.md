# break (benchmark)

Measures the cost of cross-contract calls. TWO contracts: the target (callee)
deploys first, then the caller seals a reference to it. Circuits: `localBase`
(no call), `callOnce`, `callTwice`, `callBig` (a `Bytes<256>` call argument)
and `callEmit` (a call whose callee fires an event).

A cross-contract call proves once per contract in the call tree; the
instrumented proof provider records the caller's and callee's proofs
separately, and the suite cross-checks the callee's ledger counted every
call.

## Run it

```bash
# from the repo root, with the docker stack up (docker compose up -d):
yarn compile:zk:break       # proving keys for BOTH contracts
yarn bench:break            # deploy target + caller, drive all five circuits
yarn bench:break-callTwice  # a single circuit
yarn report                 # refresh reports/REPORT.md
```

## Layout

- [contract/](contract/): `src/caller.compact` + `src/target.compact`, their
  export surface (compiled bindings, deploy functions, bench plan, expected
  callee call counts) in `src/index.ts`.
- [integration-tests/](integration-tests/): the live bench suite, gated by
  `RUN_INTEGRATION_TESTS`. Generic driving and recording come from
  `@midnight-experiments/test-harness-benchmark`; the proof provider spans
  the whole call tree (caller + target).
