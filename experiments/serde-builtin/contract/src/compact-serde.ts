// TypeScript twin of Compact's builtin serialize<T, N> from
// CompactStandardLibrary, as pinned by tests/serde-builtin.test.ts against the
// compiled circuits in src/serde-builtin.compact.
//
// Layout rules (compactc 0.33 / language 0.25):
//   - struct fields are packed in declaration order, no alignment gaps
//   - every value is little-endian at its NATURAL width:
//       Boolean            1 byte (0x00 / 0x01)
//       Uint<w>            ceil(w / 8) bytes, w at most 248
//       Field              32 bytes (value below the BLS12-381 scalar modulus)
//       Bytes<n>           n raw bytes, copied verbatim
//       Vector<n, T>       n elements back to back, NO length prefix
//       nested struct      its fields, flattened in order
//   - serialize<T, N> places the packed struct at the START of Bytes<N> and
//     zero-pads on the right; N below the packed size is a compile error.
//
// This file is the reference implementation the fakenet-signer response
// serializer is validated against. Keep it dependency-free.

/**
 * The BLS12-381 scalar field modulus. A Compact `Field` value must be below
 * it. Matches `maxField + 1n` exported by @midnight-ntwrk/compact-runtime.
 */
export const FIELD_MODULUS =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** Maximum Uint width accepted by compactc 0.33 (bits). */
export const MAX_UINT_BITS = 248;

export type CompactType =
  | { kind: 'boolean' }
  | { kind: 'uint'; bits: number }
  | { kind: 'field' }
  | { kind: 'bytes'; length: number }
  | { kind: 'vector'; length: number; element: CompactType }
  | { kind: 'struct'; fields: { name: string; type: CompactType }[] };

export type CompactValue =
  | boolean
  | bigint
  | Uint8Array
  | CompactValue[]
  | { [field: string]: CompactValue };

/** Packed byte size of a type, before serialize<T, N>'s right zero-padding. */
export function compactSerializedSize(type: CompactType): number {
  switch (type.kind) {
    case 'boolean':
      return 1;
    case 'uint':
      if (type.bits < 1 || type.bits > MAX_UINT_BITS) {
        throw new Error(`Uint width ${type.bits} is out of range 1..${MAX_UINT_BITS}`);
      }
      return Math.ceil(type.bits / 8);
    case 'field':
      return 32;
    case 'bytes':
      return type.length;
    case 'vector':
      return type.length * compactSerializedSize(type.element);
    case 'struct':
      return type.fields.reduce((sum, f) => sum + compactSerializedSize(f.type), 0);
  }
}

function writeUintLE(out: Uint8Array, offset: number, value: bigint, size: number, label: string): void {
  if (value < 0n) {
    throw new Error(`${label}: negative values cannot be Compact-serialized (got ${value})`);
  }
  if (value >> BigInt(size * 8) !== 0n) {
    throw new Error(`${label}: value ${value} does not fit in ${size} bytes`);
  }
  let v = value;
  for (let i = 0; i < size; i++) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function encodeInto(
  out: Uint8Array,
  offset: number,
  type: CompactType,
  value: CompactValue,
  label: string
): number {
  switch (type.kind) {
    case 'boolean': {
      if (typeof value !== 'boolean') throw new Error(`${label}: expected boolean`);
      out[offset] = value ? 1 : 0;
      return offset + 1;
    }
    case 'uint': {
      if (typeof value !== 'bigint') throw new Error(`${label}: expected bigint`);
      const size = compactSerializedSize(type);
      if (value >= 1n << BigInt(type.bits)) {
        throw new Error(`${label}: value ${value} exceeds Uint<${type.bits}>`);
      }
      writeUintLE(out, offset, value, size, label);
      return offset + size;
    }
    case 'field': {
      if (typeof value !== 'bigint') throw new Error(`${label}: expected bigint`);
      if (value >= FIELD_MODULUS) {
        throw new Error(`${label}: value ${value} is not below the Field modulus`);
      }
      writeUintLE(out, offset, value, 32, label);
      return offset + 32;
    }
    case 'bytes': {
      if (!(value instanceof Uint8Array)) throw new Error(`${label}: expected Uint8Array`);
      if (value.length !== type.length) {
        throw new Error(`${label}: expected exactly ${type.length} bytes, got ${value.length}`);
      }
      out.set(value, offset);
      return offset + type.length;
    }
    case 'vector': {
      if (!Array.isArray(value)) throw new Error(`${label}: expected array`);
      if (value.length !== type.length) {
        throw new Error(`${label}: expected exactly ${type.length} elements, got ${value.length}`);
      }
      let cursor = offset;
      value.forEach((element, i) => {
        cursor = encodeInto(out, cursor, type.element, element, `${label}[${i}]`);
      });
      return cursor;
    }
    case 'struct': {
      if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Uint8Array) {
        throw new Error(`${label}: expected an object`);
      }
      let cursor = offset;
      for (const field of type.fields) {
        const fieldValue = (value as { [field: string]: CompactValue })[field.name];
        if (fieldValue === undefined) {
          throw new Error(`${label}: missing field '${field.name}'`);
        }
        cursor = encodeInto(out, cursor, field.type, fieldValue, `${label}.${field.name}`);
      }
      return cursor;
    }
  }
}

/**
 * Byte-exact twin of `serialize<T, padTo>(value)`. With `padTo` omitted the
 * packed struct is returned unpadded, matching serialize<T, packedSize>.
 */
export function compactSerialize(type: CompactType, value: CompactValue, padTo?: number): Uint8Array {
  const size = compactSerializedSize(type);
  const total = padTo ?? size;
  if (total < size) {
    throw new Error(`padTo ${total} is below the packed size ${size} (compile error in Compact too)`);
  }
  const out = new Uint8Array(total);
  encodeInto(out, 0, type, value, type.kind === 'struct' ? 'value' : 'value');
  return out;
}

/** Inverse of {@link compactSerialize}, for tests and off-chain readers. */
export function compactDeserialize(type: CompactType, bytes: Uint8Array): CompactValue {
  const [value, consumed] = decodeFrom(bytes, 0, type, 'value');
  for (let i = consumed; i < bytes.length; i++) {
    if (bytes[i] !== 0) {
      throw new Error(`non-zero padding byte 0x${bytes[i]!.toString(16)} at offset ${i}`);
    }
  }
  return value;
}

function decodeFrom(
  bytes: Uint8Array,
  offset: number,
  type: CompactType,
  label: string
): [CompactValue, number] {
  const need = compactSerializedSize(type);
  if (offset + need > bytes.length) {
    throw new Error(`${label}: needs ${need} bytes at offset ${offset}, buffer has ${bytes.length}`);
  }
  switch (type.kind) {
    case 'boolean': {
      const b = bytes[offset]!;
      if (b > 1) throw new Error(`${label}: invalid boolean byte 0x${b.toString(16)}`);
      return [b === 1, offset + 1];
    }
    case 'uint':
    case 'field': {
      const size = type.kind === 'field' ? 32 : compactSerializedSize(type);
      let v = 0n;
      for (let i = size - 1; i >= 0; i--) {
        v = (v << 8n) | BigInt(bytes[offset + i]!);
      }
      return [v, offset + size];
    }
    case 'bytes':
      return [bytes.slice(offset, offset + type.length), offset + type.length];
    case 'vector': {
      const elements: CompactValue[] = [];
      let cursor = offset;
      for (let i = 0; i < type.length; i++) {
        const [element, next] = decodeFrom(bytes, cursor, type.element, `${label}[${i}]`);
        elements.push(element);
        cursor = next;
      }
      return [elements, cursor];
    }
    case 'struct': {
      const value: { [field: string]: CompactValue } = {};
      let cursor = offset;
      for (const field of type.fields) {
        const [fieldValue, next] = decodeFrom(bytes, cursor, field.type, `${label}.${field.name}`);
        value[field.name] = fieldValue;
        cursor = next;
      }
      return [value, cursor];
    }
  }
}
