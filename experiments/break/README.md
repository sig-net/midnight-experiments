# break

Tries to break the Signet protocol from a contract that seals a reference to
the signet contract (`SignetSigner`) at deploy time. One contract,
`break.compact`. Its single circuit, `requestSignature`, takes every
`SignBidirectionalEvent` field except the sender from the caller, unvalidated,
stores the request in `signBidirectionalEventMap` and calls
`signBidirectional` on the signet contract.

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
