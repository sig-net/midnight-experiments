// Simulator-level confirmation that THIS repo's toolchain (compactc 0.33 with
// --feature-zkir-v3 / compact-runtime 0.18 / ledger-9) verifies secp256k1
// ECDSA signatures in-circuit:
//
//   1. The standard library's `secp256k1EcdsaVerify` (wrapped by the pure
//      circuit `verifyEcdsa`) agrees with an independent off-chain signer
//      (@noble/curves): valid signatures pass, tampered ones fail.
//   2. The signet-shaped attestation flow works end-to-end: a sealed key pin
//      via `persistentHash<Secp256k1Point>`, in-circuit signature gating, and
//      first-write-wins ledger storage of the signature as LE bytes.
//   3. `secp256k1EthereumAddress` matches the standard Ethereum derivation
//      (keccak256 of the uncompressed point, last 20 bytes).
//
// Everything runs in-process via @midnight-ntwrk/compact-runtime: no node,
// no indexer, no proving. The live proving path is the sibling
// integration-tests package.

import { describe, expect, it } from "vitest";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type Secp256k1Point,
} from "@midnight-ntwrk/compact-runtime";

import * as Ecdsa from "../src/managed/ecdsa/contract/index.js";

// Dummy coin public key (32-byte hex). Required by the API, unused here.
const CPK = "0".repeat(64);

// The secp256k1 curve order n, for the signature-malleability case (n - s).
const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const bytesToBigIntBE = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
};

const bigIntTo32BytesLE = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number((value >> BigInt(8 * i)) & 0xffn);
  return bytes;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** Parse a noble uncompressed public key (0x04 || x || y) into the runtime's point shape. */
const toPoint = (uncompressed: Uint8Array): Secp256k1Point => ({
  x: bytesToBigIntBE(uncompressed.slice(1, 33)),
  y: bytesToBigIntBE(uncompressed.slice(33, 65)),
  identity: false,
});

// Fixed keypair + message so every run (and the RFC 6979 deterministic
// signature) is byte-for-byte reproducible.
const SECRET_KEY = Uint8Array.from(Buffer.from("a3b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1", "hex"));
const PUBLIC_KEY_UNCOMPRESSED = secp256k1.getPublicKey(SECRET_KEY, false);
const PUBLIC_KEY: Secp256k1Point = toPoint(PUBLIC_KEY_UNCOMPRESSED);
const MSG_HASH: Uint8Array = keccak_256(new TextEncoder().encode("signet ecdsa attestation experiment"));
const SIGNATURE = secp256k1.Signature.fromBytes(
  secp256k1.sign(MSG_HASH, SECRET_KEY, { prehash: false }),
  "compact",
);

// A second, unrelated keypair for wrong-key cases.
const OTHER_SECRET_KEY = Uint8Array.from(Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex"));
const OTHER_PUBLIC_KEY: Secp256k1Point = toPoint(secp256k1.getPublicKey(OTHER_SECRET_KEY, false));

describe("verifyEcdsa (pure circuit over stdlib secp256k1EcdsaVerify)", () => {
  const cases: Array<{
    name: string;
    msgHash: Uint8Array;
    sig: { r: bigint; s: bigint };
    pk: Secp256k1Point;
    expected: boolean;
  }> = [
    {
      name: "valid signature verifies",
      msgHash: MSG_HASH,
      sig: { r: SIGNATURE.r, s: SIGNATURE.s },
      pk: PUBLIC_KEY,
      expected: true,
    },
    {
      name: "high-s malleated twin (n - s) also verifies: stdlib does NOT enforce low-s",
      msgHash: MSG_HASH,
      sig: { r: SIGNATURE.r, s: CURVE_ORDER - SIGNATURE.s },
      pk: PUBLIC_KEY,
      expected: true,
    },
    {
      name: "different message hash fails",
      msgHash: keccak_256(new TextEncoder().encode("some other message")),
      sig: { r: SIGNATURE.r, s: SIGNATURE.s },
      pk: PUBLIC_KEY,
      expected: false,
    },
    {
      name: "wrong public key fails",
      msgHash: MSG_HASH,
      sig: { r: SIGNATURE.r, s: SIGNATURE.s },
      pk: OTHER_PUBLIC_KEY,
      expected: false,
    },
    {
      name: "tampered r fails",
      msgHash: MSG_HASH,
      sig: { r: SIGNATURE.r + 1n, s: SIGNATURE.s },
      pk: PUBLIC_KEY,
      expected: false,
    },
    {
      name: "tampered s fails",
      msgHash: MSG_HASH,
      sig: { r: SIGNATURE.r, s: SIGNATURE.s + 1n },
      pk: PUBLIC_KEY,
      expected: false,
    },
  ];

  it.each(cases)("$name", ({ msgHash, sig, pk, expected }) => {
    expect(Ecdsa.pureCircuits.verifyEcdsa(msgHash, sig, pk)).toBe(expected);
  });

  it("agrees with noble's own verifier on the valid signature", () => {
    expect(
      secp256k1.verify(SIGNATURE.toBytes("compact"), MSG_HASH, PUBLIC_KEY_UNCOMPRESSED, { prehash: false }),
    ).toBe(true);
  });
});

describe("ethereumAddress (pure circuit over stdlib secp256k1EthereumAddress)", () => {
  it("matches the standard Ethereum derivation (keccak256 of uncompressed point, last 20 bytes)", () => {
    const expected = keccak_256(PUBLIC_KEY_UNCOMPRESSED.slice(1)).slice(12);
    const derived = Ecdsa.pureCircuits.ethereumAddress(PUBLIC_KEY);
    expect(derived).toHaveLength(20);
    expect(hex(derived)).toBe(hex(expected));
  });
});

describe("postAttestation (signet-shaped, ECDSA-gated attestation flow)", () => {
  // Arrange harness: deploy the contract in-process with PUBLIC_KEY pinned.
  async function deployInitialized() {
    const contract = new Ecdsa.Contract({});
    const { currentContractState, currentPrivateState } = await contract.initialState(
      createConstructorContext(undefined, CPK),
      PUBLIC_KEY,
    );
    const ctx = createCircuitContext(
      "postAttestation",
      sampleContractAddress(),
      CPK,
      currentContractState,
      currentPrivateState,
    );
    return { contract, ctx };
  }

  it("seals persistentHash<Secp256k1Point>(mpcPk) at deploy time, matching the pure recomputation", async () => {
    const { ctx } = await deployInitialized();
    const led = Ecdsa.ledger(ctx.callContext.currentQueryContext.state);
    expect(hex(led.mpcPubKeyHash)).toBe(hex(Ecdsa.pureCircuits.mpcKeyHash(PUBLIC_KEY)));
    expect(led.attestationCount).toBe(0n);
  });

  it("stores a valid attestation: count increments, signature lands as LE bytes under msgHash", async () => {
    const { contract, ctx } = await deployInitialized();

    const { context } = await contract.circuits.postAttestation(
      ctx,
      MSG_HASH,
      { r: SIGNATURE.r, s: SIGNATURE.s },
      PUBLIC_KEY,
    );

    const led = Ecdsa.ledger(context.callContext.currentQueryContext.state);
    expect(led.attestationCount).toBe(1n);
    expect(led.attestations.member(MSG_HASH)).toBe(true);
    const stored = led.attestations.lookup(MSG_HASH);
    expect(hex(stored.r)).toBe(hex(bigIntTo32BytesLE(SIGNATURE.r)));
    expect(hex(stored.s)).toBe(hex(bigIntTo32BytesLE(SIGNATURE.s)));
  });

  it("re-posting the same msgHash is a no-op: first valid write wins", async () => {
    const { contract, ctx } = await deployInitialized();

    const first = await contract.circuits.postAttestation(
      ctx,
      MSG_HASH,
      { r: SIGNATURE.r, s: SIGNATURE.s },
      PUBLIC_KEY,
    );
    // Re-post the malleated-but-valid twin: it must verify, then no-op.
    const second = await contract.circuits.postAttestation(
      first.context,
      MSG_HASH,
      { r: SIGNATURE.r, s: CURVE_ORDER - SIGNATURE.s },
      PUBLIC_KEY,
    );

    const led = Ecdsa.ledger(second.context.callContext.currentQueryContext.state);
    expect(led.attestationCount).toBe(1n);
    const stored = led.attestations.lookup(MSG_HASH);
    expect(hex(stored.s)).toBe(hex(bigIntTo32BytesLE(SIGNATURE.s)));
  });

  it("rejects a signature from a key other than the pinned MPC key", async () => {
    const { contract, ctx } = await deployInitialized();
    const otherSig = secp256k1.Signature.fromBytes(
      secp256k1.sign(MSG_HASH, OTHER_SECRET_KEY, { prehash: false }),
      "compact",
    );

    await expect(
      contract.circuits.postAttestation(ctx, MSG_HASH, { r: otherSig.r, s: otherSig.s }, OTHER_PUBLIC_KEY),
    ).rejects.toThrow("unauthorized: attestation pk is not the MPC key");
  });

  it("rejects an invalid signature from the pinned key", async () => {
    const { contract, ctx } = await deployInitialized();

    await expect(
      contract.circuits.postAttestation(ctx, MSG_HASH, { r: SIGNATURE.r + 1n, s: SIGNATURE.s }, PUBLIC_KEY),
    ).rejects.toThrow("Invalid attestation signature");
  });
});
