# ecdsa

**Question:** can a Compact contract verify a secp256k1 ECDSA signature
in-circuit, so the signet contract's JubJub Schnorr attestation gate
(`postRespondBidirectional`) can move to the MPC's native ECDSA key?

**Finding: YES.** `CompactStandardLibrary` in compactc 0.33 ships
`secp256k1EcdsaVerify(msgHash, sig, pk)`, the `Secp256k1EcdsaSignature { r, s }`
struct and the `Secp256k1Point` / `Secp256k1Scalar` / `Secp256k1Base` builtin
types, plus `secp256k1EthereumAddress(pk)`; all gated behind the compiler flag
`--feature-zkir-v3`. The full distilled findings (API surface, byte-order
conventions, ledger-storage limits, proving-stack requirements, and the signet
upgrade map) live in [knowledge-base/](knowledge-base/index.md).

The contract mirrors the signet attestation shape one-to-one: a sealed
`persistentHash<Secp256k1Point>` key pin set at deploy time, a
`postAttestation` circuit that verifies the ECDSA signature in-circuit against
the pinned key, and first-valid-write-wins storage keyed by the signed message
hash. Signatures are produced off-chain with @noble/curves (RFC 6979), the
same convention Ethereum tooling uses. Verified at both levels: 13 offline
simulator tests, and the live e2e passing under real ZKIR v3 proving (deploy,
in-circuit rejection of a bad signature, and a valid attestation landing
on-chain with its stored bytes read back).

## Run it

```sh
yarn install                     # once, from the repo root
yarn compile                     # skip-zk compile (enough for the unit tests)
yarn workspace @midnight-experiments/ecdsa-contract run test   # offline simulator tests

# Live e2e (needs the local docker stack + a funded DEPLOYER_SEED):
yarn compile:zk:ecdsa            # generate proving keys (minutes, not seconds)
yarn test:integration:ecdsa      # deploy + post an attestation under real ZKIR v3 proving
```

Set `ECDSA_CONTRACT_ADDRESS` to rerun the live suite against an
already-deployed contract (the deploy step is skipped; each run attests a
fresh message hash).

If other suites share the stack, the default genesis wallet's submissions can
fail with node `Custom error: 196` (dust contention). Fund a dedicated wallet
once and pass it as `DEPLOYER_SEED`:

```sh
CHILD_SEED=<fresh 32-byte hex seed> yarn workspace @midnight-experiments/ecdsa-contract run fund-deployer
DEPLOYER_SEED=<the same seed> yarn test:integration:ecdsa
```

## Layout

- `contract/` (`@midnight-experiments/ecdsa-contract`): `src/ecdsa.compact`
  (the attestation contract), witnesses/providers/deploy plumbing, and the
  offline simulator tests in `tests/`.
- `integration-tests/` (`@midnight-experiments/ecdsa-integration-tests`): the
  live e2e, gated by `RUN_INTEGRATION_TESTS`.
- `knowledge-base/`: distilled findings for upgrading the signet contracts
  from JubJub Schnorr to ECDSA.
