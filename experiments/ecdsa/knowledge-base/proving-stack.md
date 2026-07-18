# Proving-stack requirements for secp256k1 circuits

The secp256k1 types compile ONLY through the ZKIR v3 backend, and v3 artefacts
flow through the whole pipeline: compiler flag, local key generation, proof
server, node verification. Every stage must speak v3.

## Compile

Add `--feature-zkir-v3` to BOTH compile scripts of any contract package whose
`.compact` (or an imported module) touches a secp256k1 type:

```json
"compile":    "COMPACT_PATH=... compact compile --skip-zk --feature-zkir-v3 src/x.compact src/managed/x",
"compile:zk": "COMPACT_PATH=... compact compile --feature-zkir-v3 src/x.compact src/managed/x"
```

The toolchain distribution ships both `zkir` and `zkir-v3` binaries; key
generation picks v3 automatically when the flag was used. No other build
change is needed.

## Key sizes and timings (this experiment's `postAttestation`)

One `secp256k1EcdsaVerify` + one `persistentHash<Secp256k1Point>` + map/counter
writes, measured with compactc 0.33.0-rc.2 on an M-series laptop:

- `postAttestation.prover`: **112 MB** (verifier key 2.7 KB). Foreign-field EC
  arithmetic is expensive; a typical non-secp circuit's prover key in this
  repo is an order of magnitude smaller. Budget key generation and key
  distribution accordingly (the proof provider uploads the prover key to the
  proof server per call).
- Local zk key generation for the one-circuit contract: about a minute.
- Live proving of the postAttestation call was NOT the bottleneck feared from
  the key size: the proof server's `/prove` round-trip took about 7 seconds,
  and the whole valid-post test (wallet sync, proving, submission, finality,
  ledger read-back) about 30 seconds on an M-series laptop.

## Component versions (verified working set)

The live e2e passed against exactly the "Ledger RC3 Compatible Stack" from the
Midnight Q2 2026 beta delivery document:

| Component | Version |
|---|---|
| Compact compiler | 0.33.0-rc.2 (`--feature-zkir-v3`) |
| Compact runtime | 0.18.0-rc.1 |
| midnight-js | 5.0.0-beta.4 |
| `@midnightntwrk/ledger-v9` (npm) | 1.0.0-rc.3 |
| Node (docker) | `midnightntwrk/midnight-node:2.0.0-rc.4` |
| Proof server (docker) | `midnightntwrk/proof-server:9.0.0-rc.5_experimental` |
| Indexer (docker) | `indexer-standalone:4.4.0-pre-alpha.16-l91r3-n2r3-bridge-and-events-epics-contract-zswap-16c656df` |

This repo's own [docker-compose.yaml](../../../docker-compose.yaml) still pins
the OLDER node 2.0.0-rc.3 / proof-server 9.0.0-rc.3 pair; the e2e was run
against a sig-net/midnight-integration stack that already runs the rc.4 /
rc.5_experimental images. Whether the older pair also proves/verifies ZKIR v3
was NOT tested; when in doubt, use the delivery-document versions above.

## Offline is enough for logic

None of the above matters for correctness testing: the compact-runtime
simulator executes `secp256k1EcdsaVerify` in-process (its JS built-ins
implement the curve arithmetic), so unit tests cover valid/invalid signatures,
key pinning and storage without any stack. Only proof generation and on-chain
verification need the live components.
