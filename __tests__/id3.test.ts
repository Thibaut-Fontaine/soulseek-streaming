import { id3TagSize, parseId3 } from '../src/core/id3';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(7), 0xff, 0xd9]);

function syncsafe(n: number): number[] {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function latin1(text: string): number[] {
  return [...text].map(c => c.charCodeAt(0));
}

function frame(major: 3 | 4, id: string, data: number[]): number[] {
  return [...latin1(id), ...(major === 4 ? syncsafe(data.length) : be32(data.length)), 0, 0, ...data];
}

function tag(major: 3 | 4, frames: number[][], padding = 20): Uint8Array {
  const body = [...frames.flat(), ...new Array(padding).fill(0)];
  return Uint8Array.from([0x49, 0x44, 0x33, major, 0, 0, ...syncsafe(body.length), ...body]);
}

function utf16le(text: string): number[] {
  const out = [0xff, 0xfe];
  for (const c of text) {
    const code = c.charCodeAt(0);
    out.push(code & 0xff, code >> 8);
  }
  return out;
}

describe('ID3 reader', () => {
  test('reads title, artist, album and the front cover (v2.3)', () => {
    const bytes = tag(3, [
      frame(3, 'TIT2', [0, ...latin1('One More Time')]),
      frame(3, 'TPE1', [1, ...utf16le('Daft Punk'), 0, 0]),
      frame(3, 'TALB', [3, ...Array.from(Buffer.from('Discovery é', 'utf8'))]),
      frame(3, 'APIC', [0, ...latin1('image/jpeg'), 0, 3, ...latin1('cover'), 0, ...JPEG]),
    ]);

    expect(id3TagSize(bytes)).toBe(bytes.length);
    const tags = parseId3(bytes)!;
    expect(tags.title).toBe('One More Time');
    expect(tags.artist).toBe('Daft Punk');
    expect(tags.album).toBe('Discovery é');
    expect(tags.picture?.mime).toBe('image/jpeg');
    expect(Array.from(tags.picture!.data)).toEqual(Array.from(JPEG));
  });

  test('prefers the front cover over another picture (v2.4)', () => {
    const png = [0x89, 0x50, 0x4e, 0x47, ...new Array(40).fill(1)];
    const bytes = tag(4, [
      frame(4, 'APIC', [0, ...latin1('image/png'), 0, 0, 0, ...png]),
      frame(4, 'APIC', [0, ...latin1('image/jpeg'), 0, 3, 0, ...JPEG]),
    ]);

    expect(parseId3(bytes)?.picture?.mime).toBe('image/jpeg');
  });

  test('returns null without a tag and survives a truncated one', () => {
    expect(parseId3(Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();

    const bytes = tag(3, [
      frame(3, 'TIT2', [0, ...latin1('Short')]),
      frame(3, 'APIC', [0, ...latin1('image/jpeg'), 0, 3, 0, ...JPEG]),
    ]);
    const truncated = parseId3(bytes.subarray(0, 40))!;
    expect(truncated.title).toBe('Short');
    expect(truncated.picture).toBeUndefined();
  });
});
