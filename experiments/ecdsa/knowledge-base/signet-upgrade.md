# Upgrading the signet contracts from JubJub Schnorr to ECDSA

The change map for `sig-net/midnight-integration`, based on this experiment.
The experiment's contract
([../contract/src/ecdsa.compact](../contract/src/ecdsa.compact)) is the
attestation gate already ported; diff it against the signet contract's
`postRespondBidirectional` while reading this.

## Why this upgrade is natural for sig-net

The MPC network's native signing key IS a secp256k1 ECDSA key (that is what it
uses to sign Ethereum transactions). The JubJub Schnorr attestation exists
only because earlier Compact could not verify ECDSA in-circuit, forcing the
MPC to maintain a second, Midnight-specific key. With
`secp256k1EcdsaVerify` the contract can verify the MPC's native key directly,
and `secp256k1EthereumAddress` can even bind it to its Ethereum address
in-circuit.

## Contract changes (`packages/signet-contract/src/signet-contract.compact`)

- `constructor(mpcPk: JubjubPoint)` becomes `constructor(mpcPk: Secp256k1Point)`;
  the sealed pin becomes `persistentHash<Secp256k1Point>(mpcPk)`. Same shape,
  different type parameter. (Alternative worth considering: pin
  `secp256k1EthereumAddress(mpcPk)` instead of a hash, so the on-ledger pin is
  the MPC's well-known Ethereum address.)
- In `postRespondBidirectional`:
  - the key check becomes `persistentHash<Secp256k1Point>(disclosedResponse.pk) == mpcPubKeyHash`;
  - the signature check becomes
    `assert(secp256k1EcdsaVerify(digest, sig, disclosedResponse.pk), ...)`
    where `sig: Secp256k1EcdsaSignature` and `digest: Bytes<32>` (see message
    format below).
- The `RespondBidirectional` struct loses `announcement`/`response`
  (JubJub Schnorr parts) and `pk: JubjubPoint`. IMPORTANT: it is stored in the
  `respondBidirectionalIndex` ledger map, and `Secp256k1Scalar` values crash
  the compiler when placed in ledger state (see
  [gotchas.md](gotchas.md#secp256k1-field-values-cannot-be-stored-in-ledger-state)).
  So the struct must carry the signature as bytes: `r: Bytes<32>, s: Bytes<32>`
  (little-endian, produced in-circuit via `disclosedSig.r as Bytes<32>`), and
  the pk either as its hash, its Ethereum address (`Bytes<20>`), or coordinate
  bytes. Circuit PARAMETERS can and should stay richly typed
  (`Secp256k1EcdsaSignature`, `Secp256k1Point`); only the stored record
  degrades to bytes, which also matches the repo's serialize-at-the-edges
  rule.
- First-write-wins stays as is. ECDSA from noble/RFC 6979 is deterministic
  (unlike the randomised Schnorr), but the verifier accepts the malleated
  `(r, n - s)` twin, so re-posts can still be byte-different; the existing
  member-check no-op is exactly right.
- The `postSignatureResponse` comment saying secp256k1 ECDSA "cannot be
  verified in-circuit" is now false. Whether to keep that path unauthenticated
  (off-chain verification by pollers) or gate it in-circuit too is a DESIGN
  decision, not a technical constraint any more; note the proving cost below
  before gating high-volume paths.

## Message format: the attestation digest

`jubjubSchnorrVerify<4>` signs a `Vector<4, Bytes<32>>` message
(`signetAttestationMessage(...)` in `@sig-net/midnight`'s `Signet.compact`).
`secp256k1EcdsaVerify` takes a single `Bytes<32>` digest instead, interpreted
big-endian (RFC 6979). So the shared module needs a digest circuit, for
example:

```compact
persistentHash<Vector<4, Bytes<32>>>(signetAttestationMessage(...))
```

or `keccak256<...>(...)` if the MPC side prefers Ethereum-style hashing. The
MPC then ECDSA-signs that 32-byte digest with its secp256k1 key. Keep the
digest computation IN-CIRCUIT (hash the request id + output inside
`postRespondBidirectional`), so the signature stays bound to the actual
attested content, exactly as `signetAttestationMessage` binds it today. The
convention matches @noble/curves' `sign(digest, sk, { prehash: false })` and
standard Ethereum signers with no byte reversal.

## Beyond the contract

- **Compile scripts**: every package that compiles a `.compact` touching
  secp256k1 types (signet-contract, and `packages/signet-midnight`'s
  `circuits.compact` if the digest/verify helpers move into the shared seed)
  must add `--feature-zkir-v3` to `compile` AND `compile:zk` (see
  [proving-stack.md](proving-stack.md)).
- **TS pure-circuit twins**: none needed. `pureCircuits.<wrapper>` exposes the
  exact on-chain predicate, and the repo rule (never mimic a circuit in TS)
  stands; TS only converts noble's `{ r, s }` bigints and the
  `{ x, y, identity }` point, as shown in
  [compact-api.md](compact-api.md#typescript-interop-noblecurves-2x).
- **MPC / fakenet responder**: the responder must sign the new digest with the
  secp256k1 key instead of producing a JubJub Schnorr signature, and post
  `{ r, s }` bigints. Recovery-id handling is unnecessary (the pk is passed
  explicitly; in-circuit recovery does not exist).
- **Deploy flow**: `deploy.ts` passes the MPC's public key as
  `{ x: bigint, y: bigint, identity: false }` parsed from the uncompressed
  SEC1 key (the experiment's `deployEcdsa` shows the exact code).
- **Stack versions**: the e2e stack must run the ZKIR-v3-capable images (node
  2.0.0-rc.4, proof-server 9.0.0-rc.5_experimental line); see
  [proving-stack.md](proving-stack.md) for the verified set.
- **Proving cost**: the ECDSA-gated circuit's prover key is ~112 MB, though
  the proof itself is quick (~7 s through the local proof server; ~30 s for
  the whole call including submission and finality). The main operational
  cost is shipping the large prover key to the proof server per call; fine
  for postRespondBidirectional's one-per-request volume, worth measuring
  before adding `secp256k1EcdsaVerify` to hot paths.
