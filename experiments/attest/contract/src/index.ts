// Attest experiment package surface: the generated contract module, its
// compiled-contract binding, deploy flow, and the bench plan with REAL
// secp256k1 signatures over the exact digests the circuits recompute.

import { fileURLToPath } from "node:url";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import type { Secp256k1Point } from "@midnight-ntwrk/compact-runtime";
import type { WalletFacade } from "@midnightntwrk/wallet-sdk-facade";
import { compactSerialize, type CompactType } from "@sig-net/midnight-serde";

import {
  createEmptyPrivateState,
  deployWithFacade,
  makeVacantCompiledContract,
  type AccountKeys,
  type BenchCircuitSpec,
  type EmptyPrivateState,
  type NetworkId,
} from "@midnight-experiments/lib";

import { Contract as AttestContract } from "./managed/attest/contract/index.js";

export * as Attest from "./managed/attest/contract/index.js";

export type AttestCircuitId = keyof InstanceType<typeof AttestContract>["provableCircuits"] & string;
export const ATTEST_PRIVATE_STATE_ID = "exp-attest";
export type AttestPrivateStateId = typeof ATTEST_PRIVATE_STATE_ID;

export const attestManagedPath = fileURLToPath(new URL("./managed/attest", import.meta.url));

export const attestCompiledContract = makeVacantCompiledContract<
  AttestContract<EmptyPrivateState>,
  EmptyPrivateState
>("attest", AttestContract, attestManagedPath);

/** Deploy the attest contract through an already-open facade. */
export async function deployAttest(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(facade, keys, networkId, attestCompiledContract, createEmptyPrivateState());
}

// ── deterministic fixture: request, output, key, signatures ────────────────
// The circuits assert the ECDSA verification, so the plan must carry REAL
// signatures over the exact digests the circuits recompute. Conventions
// mirror Signet.compact and fakenet: digest = hash(requestId || output), one
// flat concatenation, signature (r, s) as 32-byte big-endian, digest
// interpreted as a big-endian integer, key as an uncompressed point.

const bytes = (length: number, offset: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => ((i + offset) % 251) + 1);

export const REQUEST_ID = bytes(32, 7);

// The respond output value, packed by @sig-net/midnight-serde into the exact
// bytes the circuits read back with the builtin deserialize<RespondOutput,
// 128>. The descriptor mirrors the contract's RespondOutput struct. The
// resulting buffer ends in 91 zero padding bytes ON PURPOSE: zero-suffixed
// keccak preimages pin the trailing-zero fix (toolchain 0.33.102), since a
// runtime that trimmed them would produce a digest the circuit disagrees
// with and the signature assert would fire.
const RESPOND_OUTPUT = {
  kind: "struct",
  fields: [
    { name: "success", type: { kind: "boolean" } },
    { name: "amount", type: { kind: "uint", bits: 128 } },
    { name: "recipient", type: { kind: "bytes", length: 20 } },
  ],
} as const satisfies CompactType;

export const RESPOND_VALUE = {
  success: true,
  amount: 4242n,
  recipient: bytes(20, 55),
};

export const OUTPUT_128 = compactSerialize(RESPOND_OUTPUT, RESPOND_VALUE, 128);

const SECRET_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

const bytesToBigintBE = (b: Uint8Array): bigint =>
  b.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

const publicKeyPoint = (): Secp256k1Point => {
  const uncompressed = secp256k1.getPublicKey(SECRET_KEY, false); // 0x04 || x || y
  return {
    x: bytesToBigintBE(uncompressed.slice(1, 33)),
    y: bytesToBigintBE(uncompressed.slice(33, 65)),
    identity: false,
  };
};

/**
 * Sign a 32-byte digest, returning r and s as 32-byte LITTLE-ENDIAN values:
 * the circuit casts them with `Bytes<32> as Secp256k1Scalar`, and Compact's
 * bytes-to-numeric casts are little-endian (the digest itself stays raw:
 * secp256k1EcdsaVerify interprets it as a big-endian integer internally,
 * matching RFC 6979).
 */
const signDigest = (digest: Uint8Array): { r: Uint8Array; s: Uint8Array } => {
  const compact = secp256k1.sign(digest, SECRET_KEY, { prehash: false });
  return {
    r: compact.slice(0, 32).reverse(),
    s: compact.slice(32, 64).reverse(),
  };
};

const preimage = Uint8Array.from([...REQUEST_ID, ...OUTPUT_128]);
const shaDigest = sha256(preimage);
const keccakDigest = keccak_256(preimage);
const shaSig = signDigest(shaDigest);
const keccakSig = signDigest(keccakDigest);
const PK = publicKeyPoint();

/** The measured circuits and their call arguments. */
export const attestBenchPlan: BenchCircuitSpec[] = [
  { circuit: "mapOnly", args: () => [REQUEST_ID] },
  { circuit: "verifyOnly", args: () => [REQUEST_ID, shaDigest, shaSig.r, shaSig.s, PK] },
  { circuit: "shaVerify", args: () => [REQUEST_ID, OUTPUT_128, shaSig.r, shaSig.s, PK] },
  { circuit: "keccakVerify", args: () => [REQUEST_ID, OUTPUT_128, keccakSig.r, keccakSig.s, PK] },
];
