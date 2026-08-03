// Where the builtin serialize<T, N> layout stands relative to the LEDGER
// object serialization: the versioned `Serializable` format the ledger crate
// and the Wallet SDK expose as `.serialize()` on ContractState and friends.
// Everything runs offline: the compiled UintPair circuits on one side,
// @midnightntwrk/ledger-v9 on the other, over the SAME logical value.
//
// Four claims are proven here:
//   1. TAGGED: the ledger format is self-describing and versioned. It begins
//      with the ASCII header "midnight:contract-state[v8]:" (v8 under this
//      repo's pinned ledger 1.0.0-rc.3), so its bytes change across ledger
//      versions by construction. serialize<T, N> bytes carry no header at all.
//   2. DIFFERENT BYTES: the ledger encoding embeds each FAB atom individually
//      (minimal width, wrapped in structure bytes) and never contains the
//      contiguous packed sequence serialize<T, N> emits.
//   3. STRIPPING THE TAG DOES NOT HELP: the bytes after the header do not
//      decode through deserialize<UintPair, 128> to the original values.
//   4. THE REAL RELATIONSHIP: both formats are built from the same FAB atoms
//      (CompactType.toValue). serialize<T, N> is exactly those atoms padded
//      to their alignment widths and concatenated, zero-padded right to N.
//      The ledger format wraps the same atoms in a versioned object tree.

import { CompactTypeUnsignedInteger } from "@midnight-ntwrk/compact-runtime";
import { ChargedState, ContractState, StateValue } from "@midnightntwrk/ledger-v9";
import { describe, expect, it } from "vitest";

import { pureCircuits } from "../src/managed/serde-builtin/contract/index.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

// UintPair from serde-builtin.compact, via the same runtime descriptors the
// compiler generates for it.
const A_TYPE = new CompactTypeUnsignedInteger((1n << 128n) - 1n, 16);
const B_TYPE = new CompactTypeUnsignedInteger((1n << 64n) - 1n, 8);

// Distinctive values so the atoms are recognisable inside any encoding. The
// top byte of A is zero on purpose: it makes the minimal-width FAB atom
// (15 bytes) visibly different from the padded natural width (16 bytes).
const A = 0x00112233445566778899aabbccddeeffn;
const B = 0xdeadbeefdeadbeefn;

const A_ATOM = A_TYPE.toValue(A)[0]; // ffeeddccbbaa998877665544332211 (15 bytes)
const B_ATOM = B_TYPE.toValue(B)[0]; // efbeaddeefbeadde (8 bytes)

const pad = (atom: Uint8Array, width: number): Uint8Array => {
  const out = new Uint8Array(width);
  out.set(atom);
  return out;
};

// The circuit encoding of the pair: Bytes<128>, packed prefix of 24 bytes.
const CIRCUIT_BYTES = pureCircuits.serUintPair(A, B);

// The ledger encoding of the same pair: a ContractState whose data is a cell
// holding the pair's FAB aligned value.
const LEDGER_HEADER = "midnight:contract-state[v8]:";
const ledgerState = new ContractState();
ledgerState.data = new ChargedState(
  StateValue.newCell({
    value: [A_ATOM, B_ATOM],
    alignment: [...A_TYPE.alignment(), ...B_TYPE.alignment()],
  }),
);
const LEDGER_BYTES = ledgerState.serialize();
const LEDGER_TAIL = LEDGER_BYTES.slice(LEDGER_HEADER.length);

describe("ledger object serialization vs serialize<T, N>", () => {
  it("the ledger format opens with a versioned ASCII tag, the circuit format has none", () => {
    const ascii = Buffer.from(LEDGER_BYTES.slice(0, LEDGER_HEADER.length)).toString("latin1");
    expect(ascii).toBe(LEDGER_HEADER);
    // The circuit bytes for the same value start with the value itself.
    expect(hex(CIRCUIT_BYTES).startsWith(hex(pad(A_ATOM, 16)))).toBe(true);
  });

  it("the ledger encoding frames each FAB atom individually and never contains the packed sequence", () => {
    const tail = hex(LEDGER_TAIL);
    // Both atoms are present (at minimal width), so the formats clearly share
    // their atoms...
    expect(tail).toContain(hex(A_ATOM));
    expect(tail).toContain(hex(B_ATOM));
    // ...but the contiguous packed layout the circuit emits appears nowhere,
    // neither at padded natural widths nor at minimal atom widths.
    const packedPrefix = hex(pad(A_ATOM, 16)) + hex(pad(B_ATOM, 8));
    expect(hex(CIRCUIT_BYTES).startsWith(packedPrefix)).toBe(true);
    expect(tail).not.toContain(packedPrefix);
    expect(tail).not.toContain(hex(A_ATOM) + hex(B_ATOM));
  });

  it("stripping the tag and deserializing does not recover the value", () => {
    // Take the post-header bytes, fit them into the circuit's Bytes<128>
    // input, and decode. The structure bytes land inside the numeric fields,
    // so the result cannot be the original pair.
    const stripped = pad(LEDGER_TAIL.slice(0, 128), 128);
    let decoded: { a: bigint; b: bigint } | "rejected";
    try {
      decoded = pureCircuits.deUintPair(stripped);
    } catch {
      decoded = "rejected";
    }
    expect(decoded === "rejected" || decoded.a !== A || decoded.b !== B).toBe(true);
  });

  it("serialize<T, N> is exactly the FAB atoms padded to their alignment widths", () => {
    // The alignment declares each atom's natural width: 16 bytes for
    // Uint<128>, 8 for Uint<64>. Pad the minimal atoms to those widths,
    // concatenate, zero-pad right to N: byte-identical to the circuit.
    const rebuilt = new Uint8Array(128);
    rebuilt.set(pad(A_ATOM, 16), 0);
    rebuilt.set(pad(B_ATOM, 8), 16);
    expect(hex(rebuilt)).toBe(hex(CIRCUIT_BYTES));
  });
});
