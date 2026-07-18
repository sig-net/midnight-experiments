Read this excerpt from the "Midnight Q2 2026 Beta Delivery Document" which I have received:

-------------

## Whats in this document:
 - List of Q2 deliverables & their delivery status
 - The compatibility matrix needed to exercise these features on Stagenet
 - Link to the Release Artifact Checksum Document
 - Links to the low-level protocol documentation
 - How to access Stagenet - RPCs & Faucet URLs

## Q2 Sow Deliverables:

| ID | Deliverable | Components | Status |
| ------ | --- | --- | --- |
| SOW-01 | Native cryptographic primitives for Prime stablecoin integration (USDCx) | Language, Smart Compliance | Delivered |
| SOW-02 | ECDSA signature support (custodian integrations) | Ledger, Crypto | Delivered |
| SOW-03 | Contract-to-contract calls, phase 1 (unshielded data only) | Midnight.js, Compact | Delivered |
| SOW-04 | ZKIR v3 | Crypto, Language, Ledger | Delivered |
| SOW-05 | cNIGHT to mNIGHT protocol token bridge | Protocol, Ledger, Cardano integration | Delivered |
| SOW-06 | Native Keccak hashing | Crypto, Language | Delivered |
| SOW-07 | Native secp256k1 | Crypto, Language | Delivered |
| SOW-08 | Event emission support for Compact smart contracts, phase 1 (unshielded only) | Ledger, Language | Delivered |
| SOW-09 | Low-level protocol documentation | Ledger | Delivered |


## Component versions

### Stagenet Testing [Ledger RC3 Compatible Stack]:

| Component | Version |
| --- | --- |
| Ledger | [9.1.0.0-rc.3](https://github.com/midnightntwrk/midnight-ledger) |
| Node | [2.0.0-rc.4](https://github.com/midnightntwrk/midnight-node/releases/tag/node-2.0.0-rc.4) |
| Indexer | [4.4.0-pre-alpha.16](https://github.com/midnightntwrk/midnight-indexer) |
| Proof server | [9.0.0-rc.5_experimental](https://hub.docker.com/r/midnightntwrk/proof-server) |
| Compact compiler | [0.33.0-rc.2](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.33.0-rc.2) |
| Compact runtime | [0.18.0-rc.1](https://www.npmjs.com/package/@midnight-ntwrk/compact-runtime/v/0.18.0-rc.1) |
| Compact.js | [2.5.5-rc.6](https://github.com/midnightntwrk/midnight-sdk/releases/tag/compact-js-v2.5.5-rc.6) |
| Midnight.js | [5.0.0-beta.4](https://github.com/midnightntwrk/midnight-js/releases/tag/v5.0.0-beta.4) |
| Wallet SDK | [2.0.0-beta.2](https://github.com/midnightntwrk/midnight-wallet) |

-------------

Supposedly ECDSA signature support has been added.

Before ECDSA midnight only supported JubJub, as such JubJub is wired extensively into the signet midnight integration: /Users/bernard/Projects/github.com/sig-net/midnight-integration-use-ecdsa/packages/signet-contract/src/signet-contract.compact: mpcPublic key used to verify a jubjub signature.

I want to upgrade this signet-contract.compact to use the new ECDSA support, but first I want you to run a NEW experiment in the midnight-experiments repository: /Users/bernard/Projects/github.com/sig-net/midnight-experiments-use-ecdsa to proove that this is possible. Be sure to store your research and all you findinings to that a future agent can use your findings in this experiment to upgrade the signet contracts. Use /Users/bernard/Projects/github.com/sig-net/midnight-experiments-use-ecdsa/.claude/skills/add-experiment and /Users/bernard/Projects/github.com/sig-net/midnight-experiments-use-ecdsa/.claude/skills/run-experiment skills to help you go about your work effectively.