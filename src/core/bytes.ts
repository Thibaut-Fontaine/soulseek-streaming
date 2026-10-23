/* eslint-disable no-bitwise */
/**
 * Small, dependency-free binary helpers.
 *
 * Everything is expressed with `Uint8Array` so the same code can run in
 * Hermes (React Native), Node.js (tests / optional gateway) and in workers.
 * All multi-byte integers on the Soulseek network are little-endian.
 */

export const MAX_U32 = 0xffffffff;

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/** Encode a JS string as UTF-8. Invalid surrogates become U+FFFD. */
export function utf8Encode(input: string): Uint8Array {
  const out: number[] = [];

  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: try to combine it with the following low surrogate.
      const next = input.charCodeAt(i + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return Uint8Array.from(out);
}

/** Decode UTF-8. Returns `null` when the byte sequence is not valid UTF-8. */
function tryUtf8Decode(input: Uint8Array): string | null {
  let result = '';
  let i = 0;

  while (i < input.length) {
    const byte = input[i];

    if (byte < 0x80) {
      result += String.fromCharCode(byte);
      i++;
      continue;
    }

    let needed: number;
    let code: number;

    if ((byte & 0xe0) === 0xc0) {
      needed = 1;
      code = byte & 0x1f;
    } else if ((byte & 0xf0) === 0xe0) {
      needed = 2;
      code = byte & 0x0f;
    } else if ((byte & 0xf8) === 0xf0) {
      needed = 3;
      code = byte & 0x07;
    } else {
      return null;
    }

    if (i + needed >= input.length) {
      return null;
    }

    for (let j = 1; j <= needed; j++) {
      const continuation = input[i + j];

      if ((continuation & 0xc0) !== 0x80) {
        return null;
      }

      code = (code << 6) | (continuation & 0x3f);
    }

    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return null;
    }

    if (code < 0x10000) {
      result += String.fromCharCode(code);
    } else {
      code -= 0x10000;
      result += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }

    i += needed + 1;
  }

  return result;
}

/**
 * Decode a byte string as UTF-8, falling back to Latin-1. Soulseek is old
 * enough that a few clients still send file names encoded as Latin-1.
 */
export function utf8Decode(input: Uint8Array): string {
  const decoded = tryUtf8Decode(input);

  if (decoded !== null) {
    return decoded;
  }

  let result = '';

  for (let i = 0; i < input.length; i++) {
    result += String.fromCharCode(input[i]);
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Byte writer                                                                */
/* -------------------------------------------------------------------------- */

export class ByteWriter {
  private readonly parts: Uint8Array[] = [];
  private size = 0;

  get length(): number {
    return this.size;
  }

  u8(value: number): this {
    const buffer = new Uint8Array(1);
    buffer[0] = value & 0xff;
    return this.raw(buffer);
  }

  u16(value: number): this {
    const buffer = new Uint8Array(2);
    buffer[0] = value & 0xff;
    buffer[1] = (value >>> 8) & 0xff;
    return this.raw(buffer);
  }

  u32(value: number): this {
    const buffer = new Uint8Array(4);
    writeU32(buffer, 0, value);
    return this.raw(buffer);
  }

  i32(value: number): this {
    return this.u32(value >>> 0);
  }

  /** Writes a 64-bit unsigned integer as two 32-bit halves. */
  u64(value: number): this {
    const low = value % 0x100000000;
    const high = Math.floor(value / 0x100000000);
    return this.u32(low).u32(high);
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  bytes(value: Uint8Array): this {
    return this.u32(value.length).raw(value);
  }

  string(value: string): this {
    return this.bytes(utf8Encode(value));
  }

  raw(value: Uint8Array): this {
    if (value.length > 0) {
      this.parts.push(value);
      this.size += value.length;
    }

    return this;
  }

  toBytes(): Uint8Array {
    const output = new Uint8Array(this.size);
    let offset = 0;

    for (const part of this.parts) {
      output.set(part, offset);
      offset += part.length;
    }

    return output;
  }
}

/* -------------------------------------------------------------------------- */
/* Byte reader                                                                */
/* -------------------------------------------------------------------------- */

export class ByteReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  hasRemaining(): boolean {
    return this.remaining > 0;
  }

  private need(count: number): void {
    if (count < 0 || this.offset + count > this.data.length) {
      throw new RangeError(
        `Truncated message: need ${count} byte(s) at ${this.offset}, have ${this.remaining}`,
      );
    }
  }

  u8(): number {
    this.need(1);
    return this.data[this.offset++];
  }

  u16(): number {
    this.need(2);
    const value = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = readU32(this.data, this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    return this.u32() | 0;
  }

  u64(): number {
    const low = this.u32();
    const high = this.u32();
    return high * 0x100000000 + low;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  bytes(): Uint8Array {
    const length = this.u32();
    this.need(length);
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string(): string {
    return utf8Decode(this.bytes());
  }

  /** Reads the little-endian uint32 representation of an IPv4 address. */
  ip(): string {
    this.need(4);
    const a = this.data[this.offset + 3];
    const b = this.data[this.offset + 2];
    const c = this.data[this.offset + 1];
    const d = this.data[this.offset];
    this.offset += 4;
    return `${a}.${b}.${c}.${d}`;
  }

  skip(count: number): void {
    this.need(count);
    this.offset += count;
  }

  rest(): Uint8Array {
    const value = this.data.subarray(this.offset);
    this.offset = this.data.length;
    return value;
  }

  fork(length: number): ByteReader {
    this.need(length);
    const value = new ByteReader(this.data.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }
}

/* -------------------------------------------------------------------------- */
/* Low level helpers                                                          */
/* -------------------------------------------------------------------------- */

export function readU32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

export function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;

  for (const part of parts) {
    total += part.length;
  }

  const output = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  let output = '';

  for (let i = 0; i < bytes.length; i++) {
    output += bytes[i].toString(16).padStart(2, '0');
  }

  return output;
}

/* -------------------------------------------------------------------------- */
/* Growable FIFO of byte chunks                                               */
/* -------------------------------------------------------------------------- */

/**
 * A queue of network chunks that can hand out exact byte counts without
 * quadratic re-concatenation. Used by the frame parsers.
 */
export class ByteQueue {
  private chunks: Uint8Array[] = [];
  private headOffset = 0;
  private total = 0;

  get length(): number {
    return this.total;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) {
      return;
    }

    this.chunks.push(chunk);
    this.total += chunk.length;
  }

  /** Copies `count` bytes from the front of the queue. */
  take(count: number): Uint8Array {
    if (count < 0 || count > this.total) {
      throw new RangeError(`Cannot take ${count} byte(s) from a ${this.total}-byte queue`);
    }

    const output = new Uint8Array(count);
    let written = 0;

    while (written < count) {
      const first = this.chunks[0];
      const available = first.length - this.headOffset;
      const toCopy = Math.min(available, count - written);

      output.set(first.subarray(this.headOffset, this.headOffset + toCopy), written);
      written += toCopy;
      this.headOffset += toCopy;
      this.total -= toCopy;

      if (this.headOffset >= first.length) {
        this.chunks.shift();
        this.headOffset = 0;
      }
    }

    return output;
  }

  /** Copies `count` bytes without consuming them. */
  peek(count: number): Uint8Array {
    if (count > this.total) {
      throw new RangeError(`Cannot peek ${count} byte(s) from a ${this.total}-byte queue`);
    }

    const output = new Uint8Array(count);
    let written = 0;
    let index = 0;
    let offset = this.headOffset;

    while (written < count) {
      const chunk = this.chunks[index];
      const available = chunk.length - offset;
      const toCopy = Math.min(available, count - written);

      output.set(chunk.subarray(offset, offset + toCopy), written);
      written += toCopy;
      index++;
      offset = 0;
    }

    return output;
  }

  skip(count: number): void {
    if (count > this.total) {
      throw new RangeError(`Cannot skip ${count} byte(s) in a ${this.total}-byte queue`);
    }

    while (count > 0) {
      const first = this.chunks[0];
      const available = first.length - this.headOffset;
      const toSkip = Math.min(available, count);

      this.headOffset += toSkip;
      this.total -= toSkip;
      count -= toSkip;

      if (this.headOffset >= first.length) {
        this.chunks.shift();
        this.headOffset = 0;
      }
    }
  }

  clear(): void {
    this.chunks = [];
    this.headOffset = 0;
    this.total = 0;
  }
}
