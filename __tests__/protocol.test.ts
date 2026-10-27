import { deflate } from 'pako';

import { ByteWriter } from '../src/core/bytes';
import {
  ServerCode,
  encodeLogin,
  encodePeerInit,
  encodeServerMessage,
  encodeTransferResponse,
  encodeQueueUpload,
  parseFileSearchResponse,
  parseLoginResponse,
  parsePeerAddress,
  parseTransferRequest,
  parseConnectToPeer,
  encodeCantConnectToPeer,
  PeerCode,
} from '../src/core/protocol';

function buildSearchResponse(
  username: string,
  token: number,
  files: Array<{ name: string; size: number; bitrate?: number; duration?: number }>,
): Uint8Array {
  const writer = new ByteWriter();
  writer.string(username).u32(token).u32(files.length);

  for (const file of files) {
    writer.u8(1);
    writer.string(file.name);
    writer.u64(file.size);
    writer.string(''); // obsolete extension

    const attributes: Array<[number, number]> = [];

    if (file.bitrate !== undefined) {
      attributes.push([0, file.bitrate]);
    }

    if (file.duration !== undefined) {
      attributes.push([1, file.duration]);
    }

    writer.u32(attributes.length);

    for (const [code, value] of attributes) {
      writer.u32(code).u32(value);
    }
  }

  writer.bool(true).u32(123456).u32(2).u32(0);
  return deflate(writer.toBytes());
}

describe('streaming policy', () => {
  test('only MP3 files are offered', () => {
    const { isStreamableFile } = require('../src/core/types');

    expect(isStreamableFile('Music\\Artist - Track.mp3')).toBe(true);
    expect(isStreamableFile('Music\\Artist - Track.MP3')).toBe(true);
    expect(isStreamableFile('Music\\Artist - Track.flac')).toBe(false);
    expect(isStreamableFile('Music\\Artist - Track.wav')).toBe(false);
    expect(isStreamableFile('Music\\Artist - Track.m4a')).toBe(false);
    expect(isStreamableFile('Music\\cover.jpg')).toBe(false);
  });
});

describe('server messages', () => {
  test('login has the documented layout', () => {
    const bytes = encodeLogin('username', 'password', { major: 177, minor: 1 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint32(0, true)).toBe(bytes.length - 4);
    expect(view.getUint32(4, true)).toBe(ServerCode.LOGIN);
    expect(view.getUint32(8, true)).toBe(8); // "username"
    expect(Buffer.from(bytes.slice(12, 20)).toString()).toBe('username');
    expect(view.getUint32(20, true)).toBe(8); // "password"
    expect(Buffer.from(bytes.slice(24, 32)).toString()).toBe('password');
    expect(view.getUint32(32, true)).toBe(177);
    expect(view.getUint32(36, true)).toBe(32);
    expect(Buffer.from(bytes.slice(40, 72)).toString()).toBe(
      'd51c9a7e9353746a6020f9602d452929',
    );
    expect(view.getUint32(72, true)).toBe(1);
  });

  test('parses a successful login', () => {
    const writer = new ByteWriter();
    writer.bool(true).string('Welcome!').raw(Uint8Array.from([4, 3, 2, 1]));
    writer.string('abc').bool(true);

    expect(parseLoginResponse(writer.toBytes())).toEqual({
      ok: true,
      banner: 'Welcome!',
      ipAddress: '1.2.3.4',
      passwordChecksum: 'abc',
      isSupporter: true,
    });
  });

  test('parses a login rejection with detail', () => {
    const writer = new ByteWriter();
    writer.bool(false).string('INVALIDUSERNAME').string('Invalid characters in nick.');

    expect(parseLoginResponse(writer.toBytes())).toEqual({
      ok: false,
      reason: 'INVALIDUSERNAME',
      detail: 'Invalid characters in nick.',
    });
  });

  test('get peer address', () => {
    const writer = new ByteWriter();
    writer.string('alice').raw(Uint8Array.from([10, 1, 168, 192])).u32(2242).u32(0).u16(0);

    expect(parsePeerAddress(writer.toBytes())).toEqual({
      username: 'alice',
      ipAddress: '192.168.1.10',
      port: 2242,
      obfuscationType: 0,
      obfuscatedPort: 0,
    });
  });

  test('connect to peer request', () => {
    const writer = new ByteWriter();
    writer.string('bob').string('P').raw(Uint8Array.from([2, 1, 168, 192]));
    writer.u32(4000).u32(77).bool(false).u32(0).u32(0);

    expect(parseConnectToPeer(writer.toBytes())).toEqual({
      username: 'bob',
      connectionType: 'P',
      ipAddress: '192.168.1.2',
      port: 4000,
      token: 77,
      privileged: false,
      obfuscationType: 0,
      obfuscatedPort: 0,
    });
  });

  test('peer init frames use a one-byte code', () => {
    const bytes = encodePeerInit('me', 'P');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint32(0, true)).toBe(bytes.length - 4);
    expect(bytes[4]).toBe(1);
  });

  test('cant connect to peer encoding', () => {
    const bytes = encodeCantConnectToPeer(12, 'bob');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(4, true)).toBe(1001);
    expect(view.getUint32(8, true)).toBe(12);
  });
});

describe('peer messages', () => {
  test('parses a compressed search response', () => {
    const payload = buildSearchResponse('alice', 42, [
      { name: 'Music\\Artist - Song.mp3', size: 5_000_000, bitrate: 320, duration: 210 },
      { name: 'Music\\cover.jpg', size: 1000 },
    ]);

    const response = parseFileSearchResponse(payload);
    expect(response.username).toBe('alice');
    expect(response.token).toBe(42);
    expect(response.files).toHaveLength(2);
    expect(response.files[0]).toEqual({
      filename: 'Music\\Artist - Song.mp3',
      size: 5_000_000,
      bitrate: 320,
      durationSec: 210,
    });
    expect(response.slotFree).toBe(true);
    expect(response.avgSpeed).toBe(123456);
    expect(response.queueLength).toBe(2);
  });

  test('parses transfer requests', () => {
    const writer = new ByteWriter();
    writer.u32(1).u32(999).string('a\\b.mp3').u64(123456789);

    expect(parseTransferRequest(writer.toBytes())).toEqual({
      direction: 1,
      token: 999,
      filename: 'a\\b.mp3',
      size: 123456789,
    });
  });

  test('encodes a transfer response', () => {
    const bytes = encodeTransferResponse(999, true);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(4, true)).toBe(PeerCode.TRANSFER_RESPONSE);
    expect(view.getUint32(8, true)).toBe(999);
    expect(bytes[12]).toBe(1);
    expect(bytes.length).toBe(13);
  });

  test('queue upload encodes the virtual path', () => {
    const bytes = encodeQueueUpload('Music\\x.mp3');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(4, true)).toBe(PeerCode.QUEUE_UPLOAD);
    expect(view.getUint32(8, true)).toBe(Buffer.byteLength('Music\\x.mp3'));
  });

  test('server message helper sets the right length', () => {
    const bytes = encodeServerMessage(26, Uint8Array.from([1, 2, 3]));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(7);
    expect(view.getUint32(4, true)).toBe(26);
  });
});

describe('usernameProblem', () => {
  const { usernameProblem } = jest.requireActual('../src/core/protocol') as typeof import('../src/core/protocol');

  test('accepts plain names up to 30 characters', () => {
    expect(usernameProblem('soulstream_fan')).toBeNull();
    expect(usernameProblem('DJ Mark 2000')).toBeNull();
    expect(usernameProblem('a'.repeat(30))).toBeNull();
  });

  test('explains what the server would refuse', () => {
    expect(usernameProblem('')).toMatch(/Choisissez/);
    expect(usernameProblem('a'.repeat(31))).toMatch(/30 caractères/);
    expect(usernameProblem('élodie')).toMatch(/accents/);
    expect(usernameProblem('music 🎵')).toMatch(/accents/);
    expect(usernameProblem(' mark')).toMatch(/espace/);
  });
});
