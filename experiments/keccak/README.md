# keccak

**Question:** does the `keccak256` builtin cost more to prove than
`persistentHash` (SHA-256) over the same flat byte inputs, and by how much in
wall-clock terms on the local stack?

**Why it matters:** the signet hashed-attestation digest can either stay
`keccak256(request_id || output)`, byte-identical to the MPC's construction on
every other chain, or swap to SHA-256 via `persistentHash`. midnight-zk's
golden cost model ([circuits/goldenfiles/cost-model.json](https://github.com/midnightntwrk/midnight-zk/blob/31435e9/circuits/goldenfiles/cost-model.json),
[zk_stdlib/goldenfiles/cost-model.json](https://github.com/midnightntwrk/midnight-zk/blob/31435e9/zk_stdlib/goldenfiles/cost-model.json),
both recorded at 256-byte inputs) puts the two in the same cost class:
keccak with ~10% fewer advice rows (8,372 vs 9,314) but a ~55% bigger lookup
table (12,287 vs 7,933 table rows), which can force the next power-of-two
proving domain. This experiment turns that into measured local numbers.

**Layout:** nine circuits over identical payloads. `c64`/`c128`/`c256` are
input-size controls (no hash), `p64`/`p128`/`p256` call
`persistentHash<Bytes<N>>`, `k64`/`k128`/`k256` call `keccak256<Bytes<N>>`.
Short names since the stdlib already exports a circuit named `keccak256`.
Sizes bracket the attestation preimage (32-byte request id + a small output)
and exercise the block arithmetic: SHA-256 absorbs 64 bytes per compression
(55 effective in the padded block), keccak-f absorbs 136 per permutation, so
64 B is 2 SHA blocks vs 1 keccak permutation, 128 B is 3 vs 1, 256 B is
5 vs 2. Payload tails are deliberately non-zero: runtimes before 0.18.100
trimmed trailing zero bytes from JS-side keccak preimages (see the compact
CHANGELOG entry for toolchain 0.33.102).

**Note:** this is the first experiment in this repo compiled with
`--feature-zkir-v3`: `keccak256` is not supported in ZKIR v2. The measured
SHA-256 rows therefore also double as a v2-vs-v3 sanity reference against the
`hashing` experiment's `persistent256` (compiled without the flag).

## Run it

```bash
yarn compile:zk:keccak       # generate proving keys (slow, one-off per circuit change)
yarn bench:keccak            # full plan against the local stack
yarn bench:keccak-keccak     # just k64/k128/k256
yarn report                  # refresh REPORT.md with the new rows
```

Needs the local docker stack (node + indexer + proof server) up. The
`run-experiment` agent skill covers bring-up and failure reading.

## Finding

Measured 2026-07-23 on the local stack (compactc 0.33.0, zkir-v3, proof
server in docker, BENCH_REPS=2). Full rows in `reports/REPORT.md`.

| circuit | prover key | prove (mean) | proof bytes |
| --- | --- | --- | --- |
| `p64` (SHA-256) | 11.3 MB | 1.06 s | 5,420 B |
| `p128` (SHA-256) | 11.3 MB | 1.04 s | 5,420 B |
| `p256` (SHA-256) | 22.5 MB | 1.90 s | 5,420 B |
| `k64` (keccak) | 22.0 MB | 2.46 s | 8,156 B |
| `k128` (keccak) | 22.0 MB | 2.48 s | 8,156 B |
| `k256` (keccak) | 22.0 MB | 2.82 s | 8,156 B |

Proving domains, read from the verifier keys (the byte after the `04` tag
in the header is K, the log2 domain size): controls K=8/9/10, SHA-256
K=13/13/14 at 64/128/256 B, keccak K=14 at every size.

**keccak256 proves ~2.3x slower than persistentHash at attestation-sized
inputs (64/128 B), with ~50% bigger proofs.** The lookup-table domain floor
predicted from midnight-zk's cost model is real and visible in the prover
keys: keccak sits in the 2^14 domain at EVERY size (22 MB keys even for
64 B), while SHA-256 stays in 2^13 (11.3 MB) until its row count crosses
over at 256 B. Once both are in the same domain (256 B) the gap narrows to
1.49x. zkir instruction counts are IDENTICAL per size (hashes are single
native instructions), so all cost lives in the proof-system gadgets.

Caveat for the signet decision: these circuits contain only the hash. The
real verify circuit adds secp256k1EcdsaVerify, whose own rows may push
either variant into the larger domain anyway, shrinking the relative gap.
The [attest](../attest) experiment measured exactly that and the gap
vanished entirely (keccak 0.99x SHA inside the combined circuit), so the
2.3x here is real for hash-only circuits but NOT decision-relevant for the
attestation flow.
