# ECDSA experiment knowledge base

Distilled findings from the `ecdsa` feature experiment, written for the agent
(or human) who upgrades the sig-net signet contracts from JubJub Schnorr
attestation to secp256k1 ECDSA. Everything here was verified empirically
against compactc **0.33.0-rc.2** (the toolchain this repo pins) unless a note
says otherwise.

**Headline finding: in-circuit secp256k1 ECDSA verification works.** The
Compact standard library ships `secp256k1EcdsaVerify`, and the signet
attestation pattern (sealed key pin, in-circuit signature gate,
first-write-wins storage) ports one-to-one from `jubjubSchnorrVerify` to it.
The experiment's contract ([../contract/src/ecdsa.compact](../contract/src/ecdsa.compact))
IS that port, exercised by offline simulator tests and a live e2e under real
ZKIR v3 proving.

## Contents

- [compact-api.md](compact-api.md): the exact secp256k1 / ECDSA surface of the
  Compact standard library and its TypeScript representations, including
  @noble/curves interop.
- [gotchas.md](gotchas.md): what breaks, what silently surprises, and the
  byte-order conventions (compiler flag gate, ledger-storage crash,
  little-endian casts vs big-endian digests, signature malleability).
- [proving-stack.md](proving-stack.md): what the compile and proving pipeline
  needs (ZKIR v3 backend flag, component versions, key sizes and timings).
- [signet-upgrade.md](signet-upgrade.md): the concrete change map for
  `sig-net/midnight-integration` (contract, message format, MPC responder,
  deploy, stack versions).
