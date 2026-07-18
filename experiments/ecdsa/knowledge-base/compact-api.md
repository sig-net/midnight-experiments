# The Compact secp256k1 / ECDSA API surface

As shipped in compactc 0.33.0-rc.2's `CompactStandardLibrary`. All of it is
gated behind the `--feature-zkir-v3` compiler flag (see
[gotchas.md](gotchas.md#the---feature-zkir-v3-gate)).

## Types

| Compact type | What it is | TypeScript representation (compact-runtime 0.18.0-rc.1) |
|---|---|---|
| `Secp256k1Point` | A point on secp256k1 (opaque new type) | `{ x: bigint, y: bigint, identity: boolean }` (`identity: true` means the point at infinity, with `x = y = 0`) |
| `Secp256k1Scalar` | Element of the scalar field (order n) | `bigint` |
| `Secp256k1Base` | Element of the base field (modulus p) | `bigint` |
| `Secp256k1EcdsaSignature` | struct `{ r: Secp256k1Scalar, s: Secp256k1Scalar }` | `{ r: bigint, s: bigint }` |

The runtime also exports `CompactTypeSecp256k1Point`, `CompactTypeSecp256k1Base`
and `CompactTypeSecp256k1Scalar` for use with `persistentHash` and friends from
TypeScript.

## Circuits

```compact
// The one you want. Standard ECDSA verification:
//   w = s^-1 mod n; u1 = z*w; u2 = r*w; P = u1*G + u2*pk; valid iff P.x == r
// msgHash is deserialised as a BIG-ENDIAN integer reduced mod n (RFC 6979
// convention, same as Ethereum/Bitcoin tooling).
circuit secp256k1EcdsaVerify(msgHash: Bytes<32>, sig: Secp256k1EcdsaSignature, pk: Secp256k1Point): Boolean

// Ethereum address of a public key: keccak256(x_be || y_be)[12..32].
// Asserts pk is not the identity point (it has no address).
circuit secp256k1EthereumAddress(pk: Secp256k1Point): Bytes<20>
```

Both can be called from your own `pure circuit` wrappers (verification touches
no ledger state), used inside `assert(...)` in impure circuits, and re-exported
directly with `export { secp256k1EcdsaVerify }`. Two calls in one circuit
compile fine in this build (an older optimiser bug with successive calls,
upstream issue #609, is fixed here).

There is NO in-circuit recovery: `secp256k1EcdsaRecover` and
`Secp256k1EcdsaSignatureWithRecovery` existed briefly upstream and were
REMOVED from the standard library. The supported ecrecover-style pattern is:
recover the public key off-circuit (noble's `Signature.recoverPublicKey`),
pass it in, verify in-circuit against it, and derive the address with
`secp256k1EthereumAddress` when the address is what you pin.

## Primitive builtins (for hand-rolled curve arithmetic)

`secp256k1Add(a, b)`, `secp256k1Mul(p, k)`, `secp256k1MulGenerator(k)`,
`secp256k1PointX(p)`, `secp256k1PointY(p)` (point ops), plus the OVERLOADED
generic field operations `add`, `mul`, `neg`, `inv` which accept
`Secp256k1Scalar` and `Secp256k1Base` operands. The generic names are compiler
natives: `export { mul }` does not work, wrap them in your own circuit if you
need to export them. You should not need any of these for the signet upgrade;
`secp256k1EcdsaVerify` covers it.

## Casts

- `Bytes<32> as Secp256k1Scalar` and `Secp256k1Scalar as Bytes<32>`: both
  exist and are LITTLE-ENDIAN (likewise for `Secp256k1Base`). Note the
  asymmetry with `secp256k1EcdsaVerify`'s msgHash parameter, which is
  interpreted big-endian; see
  [gotchas.md](gotchas.md#byte-order-le-casts-be-digests).
- `Bytes<32> as Vector<32, Uint<8>>` works for byte-level reordering (the
  standard library itself reverses bytes this way).

## TypeScript interop (@noble/curves 2.x)

The values cross the TS boundary as bigints, so interop is direct; this is the
exact pattern the experiment's tests use:

```ts
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const skBytes: Uint8Array = ...;                       // 32-byte secret key
const pkUncompressed = secp256k1.getPublicKey(skBytes, false); // 65 bytes: 0x04 || x || y
const pk = {                                           // the contract's Secp256k1Point
  x: bytesToBigIntBE(pkUncompressed.slice(1, 33)),
  y: bytesToBigIntBE(pkUncompressed.slice(33, 65)),
  identity: false,
};

const msgHash = keccak_256(messageBytes);              // any 32-byte digest
// prehash: false because msgHash is already the digest (noble would otherwise sha256 it).
const sigBytes = secp256k1.sign(msgHash, skBytes, { prehash: false });
const sig = secp256k1.Signature.fromBytes(sigBytes, "compact"); // { r: bigint, s: bigint }

// In-circuit / simulator:
pureCircuits.verifyEcdsa(msgHash, { r: sig.r, s: sig.s }, pk); // true
```

noble signs deterministically (RFC 6979) and normalises to low-s by default;
both are compatible with the stdlib verifier (which accepts high-s too, see
the malleability note in [gotchas.md](gotchas.md#no-low-s-enforcement)).

The simulator (`@midnight-ntwrk/compact-runtime`) executes all of this
in-process with no proving, so offline unit tests fully cover the
verification logic; only the proving pipeline needs the live stack.
