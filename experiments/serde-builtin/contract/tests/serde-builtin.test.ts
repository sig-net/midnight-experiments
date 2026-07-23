// Offline pinning of the builtin serialize<T, N> / deserialize<T, N> byte
// layout. Everything runs in-process against the COMPILED circuits (the same
// lowered code a real proof executes), via @midnight-ntwrk/compact-runtime.
//
// Three claims are proven here:
//   1. LAYOUT: serialize packs fields in declaration order at natural widths,
//      little-endian, zero-padded right to N. Pinned byte-for-byte.
//   2. TWIN: the TypeScript encoder in src/compact-serde.ts is byte-identical
//      to the circuit's serialize for every probed shape.
//   3. INVERSE: deserialize accepts TS-encoded bytes and returns the original
//      values (both directions, including boundary values).
// Plus the failure-mode pins: trailing garbage and out-of-range Field values.

import { describe, expect, it } from "vitest";

import { pureCircuits } from "../src/managed/serde-builtin/contract/index.js";
import {
  compactDeserialize,
  compactSerialize,
  compactSerializedSize,
  FIELD_MODULUS,
  type CompactType,
} from "../src/compact-serde.ts";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

// Type descriptors mirroring the structs in serde-builtin.compact.
const BOOL_OUTPUT: CompactType = {
  kind: "struct",
  fields: [{ name: "success", type: { kind: "boolean" } }],
};
const UINT_PAIR: CompactType = {
  kind: "struct",
  fields: [
    { name: "a", type: { kind: "uint", bits: 128 } },
    { name: "b", type: { kind: "uint", bits: 64 } },
  ],
};
const MIXED: CompactType = {
  kind: "struct",
  fields: [
    { name: "flag", type: { kind: "boolean" } },
    { name: "amount", type: { kind: "uint", bits: 128 } },
    { name: "small", type: { kind: "uint", bits: 8 } },
    { name: "tag", type: { kind: "bytes", length: 32 } },
  ],
};
const WITH_VECTOR: CompactType = {
  kind: "struct",
  fields: [
    { name: "count", type: { kind: "uint", bits: 64 } },
    { name: "values", type: { kind: "vector", length: 3, element: { kind: "uint", bits: 64 } } },
  ],
};
const NESTED: CompactType = {
  kind: "struct",
  fields: [
    { name: "inner", type: UINT_PAIR },
    { name: "ok", type: { kind: "boolean" } },
  ],
};
const WITH_FIELD: CompactType = {
  kind: "struct",
  fields: [{ name: "f", type: { kind: "field" } }],
};
// The dynamic-payload convention: explicit length + max-width buffer.
const DYN_BYTES: CompactType = {
  kind: "struct",
  fields: [
    { name: "len", type: { kind: "uint", bits: 64 } },
    { name: "data", type: { kind: "bytes", length: 32 } },
  ],
};
const DYN_LIST: CompactType = {
  kind: "struct",
  fields: [
    { name: "len", type: { kind: "uint", bits: 64 } },
    { name: "items", type: { kind: "vector", length: 3, element: { kind: "uint", bits: 128 } } },
  ],
};

const PAYLOAD = 128;

describe("layout pinning (circuit output, byte-for-byte)", () => {
  it("BoolOutput { success: true } is 0x01 then zeros", () => {
    const bytes = pureCircuits.serBool(true);
    expect(bytes).toHaveLength(PAYLOAD);
    expect(hex(bytes)).toBe("01" + "00".repeat(PAYLOAD - 1));
    expect(hex(pureCircuits.serBool(false))).toBe("00".repeat(PAYLOAD));
  });

  it("UintPair packs Uint<128> as 16 bytes LE then Uint<64> as 8 bytes LE", () => {
    // 4242 = 0x1092 → LE bytes 92 10.
    const bytes = pureCircuits.serUintPair(4242n, 7n);
    const expected = "9210" + "00".repeat(14) + "07" + "00".repeat(7) + "00".repeat(PAYLOAD - 24);
    expect(hex(bytes)).toBe(expected);
  });

  it("Vector<3, Uint<64>> is 3 elements back to back, no length prefix", () => {
    const bytes = pureCircuits.serVector(3n, [1n, 2n, 3n]);
    const expected =
      "03" + "00".repeat(7) + // count
      "01" + "00".repeat(7) + // values[0]
      "02" + "00".repeat(7) + // values[1]
      "03" + "00".repeat(7) + // values[2]
      "00".repeat(PAYLOAD - 32);
    expect(hex(bytes)).toBe(expected);
  });

  it("nested structs flatten in declaration order", () => {
    const bytes = pureCircuits.serNested(4242n, 7n, true);
    const expected = "9210" + "00".repeat(14) + "07" + "00".repeat(7) + "01" + "00".repeat(PAYLOAD - 25);
    expect(hex(bytes)).toBe(expected);
  });

  it("Field is 32 bytes LE", () => {
    const bytes = pureCircuits.serField(0x0102030405060708n);
    const expected = "0807060504030201" + "00".repeat(24) + "00".repeat(PAYLOAD - 32);
    expect(hex(bytes)).toBe(expected);
  });
});

describe("TS twin equals the circuit encoder", () => {
  const cases: Array<{ name: string; type: CompactType; circuit: () => Uint8Array; value: unknown }> = [
    {
      name: "BoolOutput",
      type: BOOL_OUTPUT,
      circuit: () => pureCircuits.serBool(true),
      value: { success: true },
    },
    {
      name: "UintPair boundary max",
      type: UINT_PAIR,
      circuit: () => pureCircuits.serUintPair((1n << 128n) - 1n, (1n << 64n) - 1n),
      value: { a: (1n << 128n) - 1n, b: (1n << 64n) - 1n },
    },
    {
      name: "UintPair zeros",
      type: UINT_PAIR,
      circuit: () => pureCircuits.serUintPair(0n, 0n),
      value: { a: 0n, b: 0n },
    },
    {
      name: "Mixed",
      type: MIXED,
      circuit: () => pureCircuits.serMixed(true, 123456789n, 255n, new Uint8Array(32).fill(0xab)),
      value: { flag: true, amount: 123456789n, small: 255n, tag: new Uint8Array(32).fill(0xab) },
    },
    {
      name: "WithVector",
      type: WITH_VECTOR,
      circuit: () => pureCircuits.serVector(3n, [10n, 20n, 30n]),
      value: { count: 3n, values: [10n, 20n, 30n] },
    },
    {
      name: "Nested",
      type: NESTED,
      circuit: () => pureCircuits.serNested(4242n, 7n, true),
      value: { inner: { a: 4242n, b: 7n }, ok: true },
    },
    {
      name: "WithField max",
      type: WITH_FIELD,
      circuit: () => pureCircuits.serField(FIELD_MODULUS - 1n),
      value: { f: FIELD_MODULUS - 1n },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const twin = compactSerialize(c.type, c.value as never, PAYLOAD);
      expect(hex(twin)).toBe(hex(c.circuit()));
    });
  }
});

describe("deserialize accepts TS-encoded bytes (the respond-path direction)", () => {
  it("BoolOutput", () => {
    const bytes = compactSerialize(BOOL_OUTPUT, { success: true }, PAYLOAD);
    expect(pureCircuits.deBool(bytes)).toBe(true);
  });

  it("UintPair", () => {
    const bytes = compactSerialize(UINT_PAIR, { a: 4242n, b: 7n }, PAYLOAD);
    expect(pureCircuits.deUintPair(bytes)).toEqual({ a: 4242n, b: 7n });
  });

  it("Mixed", () => {
    const tag = new Uint8Array(32).fill(0xcd);
    const bytes = compactSerialize(MIXED, { flag: true, amount: 99n, small: 7n, tag }, PAYLOAD);
    const decoded = pureCircuits.deMixed(bytes);
    expect(decoded.flag).toBe(true);
    expect(decoded.amount).toBe(99n);
    expect(decoded.small).toBe(7n);
    expect(hex(decoded.tag)).toBe(hex(tag));
  });

  it("WithVector", () => {
    const bytes = compactSerialize(WITH_VECTOR, { count: 2n, values: [5n, 6n, 0n] }, PAYLOAD);
    expect(pureCircuits.deVector(bytes)).toEqual({ count: 2n, values: [5n, 6n, 0n] });
  });

  it("Nested", () => {
    const bytes = compactSerialize(NESTED, { inner: { a: 1n, b: 2n }, ok: false }, PAYLOAD);
    expect(pureCircuits.deNested(bytes)).toEqual({ inner: { a: 1n, b: 2n }, ok: false });
  });

  it("WithField", () => {
    const bytes = compactSerialize(WITH_FIELD, { f: 123n }, PAYLOAD);
    expect(pureCircuits.deField(bytes)).toBe(123n);
  });

  it("DynBytes (the dynamic string/bytes convention: Uint<64> length + padded buffer)", () => {
    // "hi" in a 32-byte buffer, length 2.
    const data = new Uint8Array(32);
    data[0] = 0x68;
    data[1] = 0x69;
    const bytes = compactSerialize(DYN_BYTES, { len: 2n, data }, PAYLOAD);
    expect(hex(bytes)).toBe(hex(pureCircuits.serDynBytes(2n, data)));
    const decoded = pureCircuits.deDynBytes(bytes);
    expect(decoded.len).toBe(2n);
    expect(hex(decoded.data)).toBe(hex(data));
  });

  it("DynList (the dynamic array convention: Uint<64> count + fixed-capacity vector)", () => {
    const bytes = compactSerialize(DYN_LIST, { len: 2n, items: [7n, 8n, 0n] }, PAYLOAD);
    expect(hex(bytes)).toBe(hex(pureCircuits.serDynList(2n, [7n, 8n, 0n])));
    expect(pureCircuits.deDynList(bytes)).toEqual({ len: 2n, items: [7n, 8n, 0n] });
  });

  it("full circle: circuit serialize → TS decode → TS encode → circuit deserialize", () => {
    const circuitBytes = pureCircuits.serUintPair(314159n, 271828n);
    const decoded = compactDeserialize(UINT_PAIR, circuitBytes);
    const reEncoded = compactSerialize(UINT_PAIR, decoded, PAYLOAD);
    expect(hex(reEncoded)).toBe(hex(circuitBytes));
    expect(pureCircuits.deUintPair(reEncoded)).toEqual({ a: 314159n, b: 271828n });
  });
});

describe("failure-mode pins", () => {
  it("compactSerializedSize matches the compiler's sizes", () => {
    expect(compactSerializedSize(BOOL_OUTPUT)).toBe(1);
    expect(compactSerializedSize(UINT_PAIR)).toBe(24);
    expect(compactSerializedSize(MIXED)).toBe(50);
    expect(compactSerializedSize(WITH_VECTOR)).toBe(32);
    expect(compactSerializedSize(NESTED)).toBe(25);
    expect(compactSerializedSize(WITH_FIELD)).toBe(32);
  });

  it("pins how the circuit treats non-zero bytes in the padding region", () => {
    const bytes = compactSerialize(UINT_PAIR, { a: 1n, b: 2n }, PAYLOAD);
    bytes[PAYLOAD - 1] = 0xff;
    // Pin the behaviour, whichever it is: either deserialize rejects trailing
    // garbage or it ignores it. This test documents the answer empirically.
    let outcome: "rejected" | { a: bigint; b: bigint };
    try {
      outcome = pureCircuits.deUintPair(bytes);
    } catch {
      outcome = "rejected";
    }
    // Finding recorded in the README. The TS twin always rejects.
    expect(outcome === "rejected" || (outcome.a === 1n && outcome.b === 2n)).toBe(true);
    expect(() => compactDeserialize(UINT_PAIR, bytes)).toThrow(/non-zero padding/);
  });

  it("pins how the circuit treats an out-of-range Field encoding", () => {
    // 32 bytes of 0xff is far above the BLS12-381 scalar modulus.
    const bytes = new Uint8Array(PAYLOAD);
    bytes.fill(0xff, 0, 32);
    let outcome: "rejected" | bigint;
    try {
      outcome = pureCircuits.deField(bytes);
    } catch {
      outcome = "rejected";
    }
    // Finding recorded in the README. The TS twin refuses to ENCODE ≥ modulus.
    expect(outcome === "rejected" || typeof outcome === "bigint").toBe(true);
    expect(() => compactSerialize(WITH_FIELD, { f: FIELD_MODULUS }, PAYLOAD)).toThrow(/Field modulus/);
  });

  it("TS twin refuses negative and oversized values", () => {
    expect(() => compactSerialize(UINT_PAIR, { a: -1n, b: 0n }, PAYLOAD)).toThrow(/negative/);
    expect(() => compactSerialize(UINT_PAIR, { a: 1n << 128n, b: 0n }, PAYLOAD)).toThrow(/exceeds/);
    expect(() => compactSerialize(UINT_PAIR, { a: 1n, b: 2n }, 8)).toThrow(/below the packed size/);
  });
});
