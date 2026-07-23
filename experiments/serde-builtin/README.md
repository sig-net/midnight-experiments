# serde-builtin — feature

Answers: **what exact byte layout does Compact's builtin `serialize<T, N>` /
`deserialize<T, N>` pair use, and can an off-chain TypeScript encoder
byte-match it?** Short answer: **pinned below, and yes.**

Why it matters: the signet respond path delivers an MPC-signed
`serializedOutput: Bytes<128>` into consumer contracts
(`RespondBidirectionalEvent` in the signet-midnight seed). Today consumers read
it with hand-maintained `slice<N>(output, offset)` casts. If the off-chain
serializer emits exactly the builtin layout, a consumer can instead write
`deserialize<MyOutput, 128>(event.serializedOutput)` and get a typed struct in
one call, with the compiler owning the offsets.

## Findings (all verified by tests against the compiled circuits)

Layout of `serialize<T, N>` (compactc 0.33.0, language 0.25, runtime 0.18.0-rc.1):

| Rule | Detail |
|---|---|
| Field order | struct fields in declaration order, no gaps, nested structs flatten |
| Endianness | little-endian for every numeric value |
| `Boolean` | 1 byte, `0x00` / `0x01` |
| `Uint<w>` | `ceil(w / 8)` bytes (natural width). Max width **248 bits**, so `Uint<256>` does not exist |
| `Field` | 32 bytes, value must be below the BLS12-381 scalar modulus (`maxField` from compact-runtime) |
| `Bytes<n>` | n raw bytes, verbatim |
| `Vector<n, T>` | n elements back to back, **no length prefix** |
| Padding | packed struct sits at the START of `Bytes<N>`, zero-padded right |
| `N` too small | compile error ("actual serialized size … exceeds specified length") |

`deserialize<T, N>` behaviour (pinned empirically):

- Accepts TS-encoded bytes and returns the original values (both directions
  round-trip, including boundary values like `Uint<128>` max and `maxField`).
- **Ignores** the padding region entirely: trailing non-zero garbage after the
  packed prefix decodes fine. Do not rely on padding carrying information.
- **Rejects** an out-of-range `Field` encoding at runtime (range error), so a
  32-byte word at or above the modulus can never enter a circuit as `Field`.

Implications for the signet respond schemas:

- An EVM `uint256` has **no lossless Compact carrier**: `Uint<w>` stops at 248
  bits and `Field` tops out just under 2^255 (and rejects values at or above
  the modulus). Full-range uint256 values must travel as `Bytes<32>` and be
  compared as bytes, or the protocol must accept the range restriction.
- For a single-`Boolean` payload (the erc20-vault's respond schema) the builtin
  layout is byte 0 = `0x01`/`0x00` then zeros. The fakenet-signer's historic
  32-byte-word encoding produces the identical bytes for that schema, which is
  why the two conventions coexisted unnoticed.
- Compact has no dynamic arrays or strings in circuit types: only `Vector<n,T>`
  and `Bytes<n>`. Schema entries describing dynamic payloads cannot map onto
  `deserialize<T, N>` and need an explicit convention on both sides.

## What's here

- [`contract/src/serde-builtin.compact`](contract/src/serde-builtin.compact):
  pure `ser*`/`de*` probe circuits over six struct shapes (bool, uint pair,
  mixed, vector, nested, field), all through `Bytes<128>` (the seed's
  `serializedOutput` width), plus a non-pure `checkRoundtrip` that asserts
  `serialize(deserialize(bytes)) == bytes` on-chain.
- [`contract/src/compact-serde.ts`](contract/src/compact-serde.ts): the
  TypeScript twin encoder/decoder (`compactSerialize` / `compactDeserialize`),
  the reference implementation for off-chain producers.
- [`contract/tests/serde-builtin.test.ts`](contract/tests/serde-builtin.test.ts):
  offline, in-process against the compiled circuits. Pins the layout
  byte-for-byte, proves twin/circuit byte-equality in both directions, and pins
  the failure modes above.
- [`integration-tests/tests/serde-builtin.test.ts`](integration-tests/tests/serde-builtin.test.ts):
  live, gated by `RUN_INTEGRATION_TESTS`. Deploys the contract and submits
  `checkRoundtrip` with bytes encoded entirely off-chain, so an accepted proof
  shows the REAL zk circuit (not just the JS simulator) accepts TS-encoded
  bytes. Set `SERDE_CONTRACT_ADDRESS` to reuse a deployment.

## Run it

```bash
yarn compile                                   # or compile:zk:serde-builtin before deploying
yarn workspace @midnight-experiments/serde-builtin-contract run test   # offline pinning
yarn test:integration:serde-builtin            # live (needs node + indexer + proof server + funded DEPLOYER_SEED)
```
