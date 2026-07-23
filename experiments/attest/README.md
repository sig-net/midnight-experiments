# attest

**Question:** inside a realistic client circuit (hash the request id + output,
ECDSA-verify the attestation signature, mark the request verified in a ledger
map), does keccak256 still cost meaningfully more than persistentHash
(SHA-256), or does `secp256k1EcdsaVerify` dominate and erase the gap?

**Why it matters:** the hash-only [keccak experiment](../keccak) measured
keccak256 at ~2.3x slower proving than persistentHash for attestation-sized
inputs, driven by keccak's lookup table forcing the 2^14 proving domain. But
the signet digest decision is about a circuit that ALSO runs ECDSA
verification, whose own cost may push both variants into the same domain.
This experiment is the tiebreaker.

**Layout:** four circuits simulating signet's
`verifyRespondBidirectionalEvent` flow with the flat MPC digest construction
`hash(request_id || output)` over a 32-byte request id and 128-byte output:

- `mapOnly`: counter + map write, the workload floor
- `verifyOnly`: + `secp256k1EcdsaVerify` over a supplied digest (no hash)
- `shaVerify`: + in-circuit `persistentHash<[Bytes<32>, Bytes<128>]>` digest
- `keccakVerify`: + in-circuit `keccak256<[Bytes<32>, Bytes<128>]>` digest

The bench plan carries REAL secp256k1 signatures over the exact digests the
circuits recompute (noble curves, conventions mirroring Signet.compact:
big-endian digest interpretation, r/s as 32-byte values cast to
`Secp256k1Scalar`), and every circuit asserts the verification, so a passing
run doubles as a fixture proving the off-chain and in-circuit conventions
agree. Compiled with `--feature-zkir-v3` (keccak256 and the secp256k1
circuits need it).

## Run it

```bash
yarn compile:zk:attest       # generate proving keys
yarn bench:attest            # full plan against the local stack
yarn bench:attest-hashes     # just shaVerify + keccakVerify
yarn report                  # refresh REPORT.md
```

Needs the local docker stack (node + indexer + proof server) up.

## Finding

Measured 2026-07-23 on the local stack (compactc 0.33.0, zkir-v3,
BENCH_REPS=2). Full rows in `reports/REPORT.md`.

| circuit | zkir instrs | prover key | prove (mean) | proof bytes |
| --- | --- | --- | --- | --- |
| `mapOnly` | 10 | 0.22 MB | 0.14 s | 3,852 B |
| `verifyOnly` | 98 | 43.0 MB | 3.24 s | 5,244 B |
| `shaVerify` | 156 | 117.5 MB | 9.47 s | 6,364 B |
| `keccakVerify` | 156 | 111.2 MB | 9.35 s | 9,244 B |

Proving domains, read from the verifier keys: mapOnly K=8, verifyOnly K=15,
shaVerify and keccakVerify BOTH K=16. That is the whole story in one
number: ECDSA alone already needs a 2^15 domain, the full flow needs 2^16
either way, so the hash-only experiment's K=13-vs-14 gap between SHA and
keccak is erased by context.

**In the realistic circuit the hash choice is a dead heat: keccak 0.99x SHA
(9.35 s vs 9.47 s).** The hash-only experiment's 2.3x keccak penalty
evaporates once `secp256k1EcdsaVerify` (3.24 s alone, a 23x jump over the
workload floor) and the digest+deserialize step push both variants into the
same large proving domain: the keccak prover key is actually 5% SMALLER
here. The only residual costs of keccak are ~2.9 KB more proof bytes per
attestation and a marginally different verifier key. Conclusion for the
signet digest decision: keccak parity with the MPC construction costs
essentially nothing in proving time inside the real verify flow.

The run also pins the full off-chain/in-circuit conformance chain for BOTH
hashes: bytes packed by @sig-net/midnight-serde are read back by the builtin
`deserialize<RespondOutput, 128>`, the digests signed off-chain (noble, r/s
little-endian per the `Bytes<32> as Secp256k1Scalar` cast, digest big-endian
per RFC 6979) verify in-circuit, and the zero-padded tail exercises the
keccak trailing-zero fix from toolchain 0.33.102.

Operational note: running all four circuits back to back can exhaust the
deployer wallet's spendable DUST and the node then rejects the last
transaction with `Invalid Transaction: Custom error` at submission (proving
succeeds). Rerun the missing circuit alone (`yarn bench:attest-hashes` or
`BENCH_CIRCUITS=keccakVerify yarn bench:attest`): the report composes each
circuit's most recent measurement.
