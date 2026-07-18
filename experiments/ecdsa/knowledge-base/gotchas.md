# Gotchas

Everything below was hit (or deliberately probed) while building this
experiment against compactc 0.33.0-rc.2.

## The `--feature-zkir-v3` gate

Every secp256k1 name (`Secp256k1Point`, `Secp256k1Scalar`, `Secp256k1Base`,
`Secp256k1EcdsaSignature`, `secp256k1EcdsaVerify`, `secp256k1EthereumAddress`,
the point builtins) is invisible without passing `--feature-zkir-v3` to
`compact compile`. The failure mode is MISLEADING: a plain
`unbound identifier Secp256k1Point` / `unbound identifier secp256k1EcdsaVerify`
parse-time error, exactly as if you had typo'd the name. Nothing hints at the
flag. If a secp256k1 name does not resolve, check the flag before anything
else. Both `compile` (`--skip-zk`) and `compile:zk` script variants need it.

## Secp256k1 field values cannot be stored in ledger state

Declaring a ledger cell or map that contains a `Secp256k1Scalar` (for example
`Map<Bytes<32>, Secp256k1EcdsaSignature>`, since the signature struct is two
scalars) crashes the COMPILER itself:

```
Internal error (please report): Exception: failed assertion cannot-happen
at line 558, char 20 of compiler/zkir-v3-passes.ss
```

Circuit parameters, locals and return values of these types are fine; only
ledger residency breaks. Workaround (used by this experiment's contract):
store the little-endian byte form via the `Secp256k1Scalar as Bytes<32>` cast
in a Bytes-only struct, and cast back with `Bytes<32> as Secp256k1Scalar`
when a later circuit needs the typed value. `Secp256k1Point` in ledger state
was not probed separately; assume it breaks the same way and store coordinate
bytes (or just the key's hash, as the signet pattern already does).

## Byte order: LE casts, BE digests

Two opposite conventions coexist; mixing them up makes signatures "randomly"
fail:

- `Secp256k1Scalar as Bytes<32>` / `Bytes<32> as Secp256k1Scalar` (and the
  `Secp256k1Base` equivalents) are LITTLE-ENDIAN.
- `secp256k1EcdsaVerify`'s `msgHash: Bytes<32>` parameter is interpreted
  BIG-ENDIAN (reduced mod n), per RFC 6979, matching what Ethereum/Bitcoin
  tooling and @noble/curves produce. Pass the digest bytes straight through;
  do NOT reverse them.
- Consequently a ledger record stored via the cast holds LE bytes; a TS reader
  converting back to a bigint must read little-endian (the experiment's tests
  pin this).

## No low-s enforcement

`secp256k1EcdsaVerify` accepts BOTH signature twins: for a valid `(r, s)` the
malleated `(r, n - s)` also verifies (pinned by an offline test). Ethereum
post-EIP-2 rejects high-s; the stdlib does not. This does not weaken the
signet attestation gate (any accepted signature is still from the pinned
key), but two byte-different valid signatures exist for the same message, so:
never key or deduplicate stored records by signature bytes; key by the signed
message hash and make the first valid write win, exactly as the signet
contract already does for its randomised Schnorr signatures.

## Things that DO work (probed, in case you wondered)

- `persistentHash<Secp256k1Point>(pk)` in a constructor and in circuits (the
  sealed key pin ports unchanged). Note upstream fixed point-alignment bugs in
  hashing right around this compiler line; if a later toolchain misbehaves
  here, check its changelog for `persistentHash` alignment fixes.
- `assert(secp256k1EcdsaVerify(...), "...")` inside an impure circuit.
- A `pure circuit` wrapper around `secp256k1EcdsaVerify` (verification is
  ledger-free), giving clients the exact on-chain predicate via
  `pureCircuits`.
- Direct re-export: `export { secp256k1EcdsaVerify }`.
- Two `secp256k1EcdsaVerify` calls in one circuit (upstream issue #609 is
  fixed in 0.33.0-rc.2).
- `constructor(mpcPk: Secp256k1Point)`: deploy-time constructor args of point
  type, passed from TS as `{ x, y, identity }`.

## Wallet contention on a shared dev stack (not ECDSA-specific)

Running this e2e against a stack that other suites are using concurrently
(the signet integration e2e, midnight-examples) with the default genesis
wallet fails at submission with node `Custom error: 196` (DustDoubleSpend):
concurrent spenders invalidate the fresh wallet's dust selection. Fund a
dedicated `DEPLOYER_SEED` from genesis once and use that.
