# break

Reproduces the MPC warning `midnight transaction skipped: fallible singleton
calls are unsupported` with one deploy and one call.

`break.compact` seals a reference to the signet contract (`SignetSigner`) at
deploy time. Its single circuit, `requestSignature`, takes 16 `BreakRequest`s
(every `SignBidirectionalEvent` field except the sender and the caip2Id,
unvalidated). In one transaction it stores every request in
`signBidirectionalEventMap` and calls `signBidirectional` on the signet
contract once per request.

## Why 16

When midnight-js builds a call transaction, the ledger's `partitionTranscripts`
estimates the cost of the root call plus every contract it calls, and compares
it with the guaranteed-section budget (`min_time_to_dismiss` less a
per-transaction reserve: 15 ms in the midnight-ledger source's default limits). `requestSignature` has no checkpoints, so the whole
call tree is either guaranteed or fallible. Measured on the local stack:

| requests | section |
| --- | --- |
| 2, 8, 12, 13, 14, 15 | every call guaranteed |
| 16, 20 | every call fallible |

An MPC built without [sig-net/mpc#1311](https://github.com/sig-net/mpc/pull/1311)
skips any transaction whose signet call carries a fallible transcript: at 16
all three nodes log the warning and none of the 16 requests is signed. With
that pull request merged, the same transaction produces no warning and the
nodes sign and publish responses for the requests.

At 20 requests the circuit needs k=20 parameters and proving it got the local
proof server OOM-killed (16 GB docker VM), so 16 is also close to the most this
shape can prove locally.

The integration test first dry-runs the call (`createUnprovenCallTx`, no
proving) and prints which section each call landed in, then sends it for real
and asserts every `signBidirectional` call is fallible. Set
`BREAK_DRY_RUN_ONLY=1` to stop after the dry run when trying another count:
change the vector length in `break.compact` and `REQUEST_COUNT` in the test
together.

The signet contract must already be deployed at `SIGNET_CONTRACT_ADDRESS`
(`contract/src/index.ts`), from the same `@sig-net/midnight-contract` version
this package depends on: proving the cross-contract call needs its keys.

## Run it

```bash
# from the repo root, with the docker stack up (docker compose up -d):
yarn compile:zk:break        # proving keys, needed after every contract change
yarn test:integration:break  # deploy, then call the circuits under real proving
```

## Layout

- [contract/](contract/): `src/break.compact` and its export surface in
  `src/index.ts` (compiled binding, `deployBreak`, `findDeployedBreak`).
- [integration-tests/](integration-tests/): a plain vitest suite gated by
  `RUN_INTEGRATION_TESTS`. The wallet session comes from
  `@midnight-experiments/test-harness`.
