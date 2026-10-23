import { ByteReader, ByteWriter, ByteQueue, utf8Encode, utf8Decode, bytesToHex } from '../src/core/bytes';

describe('UTF-8 helpers', () => {
  test('round-trips ASCII and non-ASCII file names', () => {
    const names = [
      'Artist - Track.mp3',
      'Björk - Jóga.flac',
      '坂本龍一 - Merry Christmas Mr. Lawrence.mp3',
      '𝄞 music.ogg',
    ];

    for (const name of names) {
      expect(utf8Decode(utf8Encode(name))).toBe(name);
    }
  });

  test('falls back to Latin-1 for legacy names', () => {
    const latin1 = Uint8Array.from([0x4d, 0xe9, 0x74, 0x61]); // "Méta" in Latin-1
    expect(utf8Decode(latin1)).toBe('Méta');
  });
});

describe('ByteWriter / ByteReader', () => {
  test('round-trips integers, strings and booleans', () => {
    const writer = new ByteWriter();
    writer.u8(0xab).u16(0x1234).u32(0xdeadbeef).u64(0x1_0000_0001).bool(true);
    writer.string('héllo');

    const reader = new ByteReader(writer.toBytes());
    expect(reader.u8()).toBe(0xab);
    expect(reader.u16()).toBe(0x1234);
    expect(reader.u32()).toBe(0xdeadbeef);
    expect(reader.u64()).toBe(0x1_0000_0001);
    expect(reader.bool()).toBe(true);
    expect(reader.string()).toBe('héllo');
    expect(reader.remaining).toBe(0);
  });

  test('decodes IPv4 addresses the Soulseek way', () => {
    // 1.2.3.4 is stored as 04 03 02 01 on the wire.
    const writer = new ByteWriter();
    writer.raw(Uint8Array.from([4, 3, 2, 1]));
    expect(new ByteReader(writer.toBytes()).ip()).toBe('1.2.3.4');
  });

  test('throws on truncated messages', () => {
    const reader = new ByteReader(Uint8Array.from([1, 2]));
    expect(() => reader.u32()).toThrow(RangeError);
  });
});

describe('ByteQueue', () => {
  test('takes bytes across chunks without losing data', () => {
    const queue = new ByteQueue();
    queue.push(Uint8Array.from([1, 2]));
    queue.push(Uint8Array.from([3, 4, 5]));

    expect(queue.length).toBe(5);
    expect(Array.from(queue.take(3))).toEqual([1, 2, 3]);
    expect(Array.from(queue.peek(2))).toEqual([4, 5]);
    expect(Array.from(queue.take(2))).toEqual([4, 5]);
    expect(queue.length).toBe(0);
  });

  test('bytesToHex', () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 255]))).toBe('000fff');
  });
});
