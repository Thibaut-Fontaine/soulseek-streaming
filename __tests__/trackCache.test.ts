import { Buffer } from 'buffer';

import { TrackCache, WRITE_CHUNK_BYTES, writeBytesInChunks } from '../src/services/trackCache';
import type { CacheFs } from '../src/services/trackCache';
import type { SearchHit } from '../src/core/types';

function memoryFs(): CacheFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    dir: '/docs/tracks',
    files,
    exists: async path => path === '/docs/tracks' || files.has(path),
    mkdir: async () => {},
    writeBase64: async (path, data) => void files.set(path, data),
    readBase64: async path => files.get(path) ?? '',
    writeText: async (path, data) => void files.set(path, data),
    readText: async path => files.get(path) ?? '',
    unlink: async path => void files.delete(path),
    move: async (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
  };
}

function hit(filename: string, username = 'peer'): SearchHit {
  return {
    username, filename, size: 1000, extension: 'mp3', slotFree: true,
    avgSpeed: 1, queueLength: 0, bitrate: 320, durationSec: 200,
  };
}

const bytes = (n: number, v = 7) => new Uint8Array(n).fill(v);

describe('track cache', () => {
  test('stores a download, shares it and reads it back', async () => {
    const fs = memoryFs();
    const cache = new TrackCache(fs, 10_000);
    await cache.load();
    await cache.save(hit('Music\\Daft Punk\\01 - One More Time.mp3'), bytes(1000));

    expect(cache.files()).toEqual([
      { path: 'SoulStream\\01 - One More Time.mp3', size: 1000, bitrate: 320, durationSec: 200 },
    ]);

    const reader = await cache.open('SoulStream\\01 - One More Time.mp3');
    expect(reader?.size).toBe(1000);
    expect(Array.from(await reader!.read(10, 3))).toEqual([7, 7, 7]);
  });

  test('finds a cached track by query or by search hit', async () => {
    const cache = new TrackCache(memoryFs(), 10_000);
    await cache.load();
    const source = hit('Music\\Daft Punk\\Discovery\\01 - One More Time.mp3');
    await cache.save(source, bytes(500));

    expect(cache.findByQuery('daft punk one more time')).not.toBeNull();
    expect(cache.findByQuery('daft punk around the world')).toBeNull();
    expect(cache.findByHit(source)).not.toBeNull();
  });

  test('evicts the least recently played track when full', async () => {
    const cache = new TrackCache(memoryFs(), 2500);
    await cache.load();
    await cache.save(hit('A - First.mp3'), bytes(1000));
    await new Promise(r => setTimeout(r, 5));
    await cache.save(hit('B - Second.mp3'), bytes(1000));
    await new Promise(r => setTimeout(r, 5));
    await cache.save(hit('C - Third.mp3'), bytes(1000));

    expect(cache.files().map(f => f.path).sort()).toEqual([
      'SoulStream\\B - Second.mp3',
      'SoulStream\\C - Third.mp3',
    ]);
  });

  test('survives a restart through its index', async () => {
    const fs = memoryFs();
    const first = new TrackCache(fs, 10_000);
    await first.load();
    await first.save(hit('A - Song.mp3'), bytes(100));

    const second = new TrackCache(fs, 10_000);
    await second.load();
    expect(second.count).toBe(1);
  });

  test('gives distinct shared names to files with the same name', async () => {
    const cache = new TrackCache(memoryFs(), 10_000);
    await cache.load();
    await cache.save(hit('x\\Song.mp3', 'a'), bytes(10));
    await cache.save(hit('y\\Song.mp3', 'b'), bytes(10));
    expect(cache.files().map(f => f.path).sort()).toEqual(['SoulStream\\Song (2).mp3', 'SoulStream\\Song.mp3']);
  });

  test('adds an MP3 from the phone and shares it', async () => {
    const fs = memoryFs();
    const cache = new TrackCache(fs, 10_000);
    await cache.load();
    fs.files.set('/caches/pick.mp3', Buffer.from(bytes(5000)).toString('base64'));

    const result = await cache.importFile('/caches/pick.mp3', 'Daft Punk - One More Time.mp3', 5000);

    expect(result.status).toBe('added');
    expect(fs.files.has('/caches/pick.mp3')).toBe(false);
    expect(cache.files()).toEqual([
      { path: 'SoulStream\\Daft Punk - One More Time.mp3', size: 5000, bitrate: undefined, durationSec: undefined },
    ]);
    expect(cache.importedCount).toBe(1);
    expect(cache.count).toBe(0);
    expect(cache.findByQuery('daft punk one more time')?.imported).toBe(true);

    const reader = await cache.open('SoulStream\\Daft Punk - One More Time.mp3');
    expect(reader?.size).toBe(5000);
  });

  test('skips non-MP3 files and duplicates', async () => {
    const fs = memoryFs();
    const cache = new TrackCache(fs, 10_000);
    await cache.load();
    fs.files.set('/c/a', 'AAAA');
    fs.files.set('/c/b', 'AAAA');
    fs.files.set('/c/c', 'AAAA');

    expect((await cache.importFile('/c/a', 'song.flac', 3)).status).toBe('skipped');
    expect((await cache.importFile('/c/b', 'song.mp3', 3)).status).toBe('added');
    expect((await cache.importFile('/c/c', 'song.mp3', 3)).status).toBe('duplicate');
    expect(fs.files.has('/c/a') || fs.files.has('/c/c')).toBe(false);
    expect(cache.importedCount).toBe(1);
  });

  test('never evicts added files and clears them separately', async () => {
    const fs = memoryFs();
    const cache = new TrackCache(fs, 2_000);
    await cache.load();
    fs.files.set('/c/big', 'AAAA');
    await cache.importFile('/c/big', 'mine.mp3', 50_000);

    await cache.save(hit('Music\\A\\one.mp3'), bytes(1500));
    await cache.save(hit('Music\\A\\two.mp3'), bytes(1500));

    // Only downloads count toward the 2 000-byte limit; the older one goes.
    expect(cache.importedCount).toBe(1);
    expect(cache.count).toBe(1);

    await cache.clear();
    expect(cache.count).toBe(0);
    expect(cache.importedCount).toBe(1);

    await cache.clear(true);
    expect(cache.importedCount).toBe(0);
    expect(cache.files()).toEqual([]);
  });
});

describe('covers and tags of cached tracks', () => {
  // ID3v2.3 tag: title "Tagged", a JPEG front cover, then fake audio.
  function taggedMp3(): Uint8Array {
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(5), 0xff, 0xd9];
    const text = (id: string, value: string) => {
      const data = [0, ...[...value].map(c => c.charCodeAt(0))];
      return [...[...id].map(c => c.charCodeAt(0)), 0, 0, 0, data.length, 0, 0, ...data];
    };
    const apicData = [0, ...[...'image/jpeg'].map(c => c.charCodeAt(0)), 0, 3, 0, ...jpeg];
    const apic = [...[...'APIC'].map(c => c.charCodeAt(0)), 0, 0, 0, apicData.length, 0, 0, ...apicData];
    const body = [...text('TIT2', 'Tagged'), ...text('TPE1', 'Someone'), ...apic];
    return Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, body.length, ...body, ...new Array(200).fill(1)]);
  }

  test('a saved download keeps its cover file and tags', async () => {
    const fs = memoryFs();
    const cache = new TrackCache(fs, 10_000);
    await cache.load();
    const source = hit('Music\\Someone\\01 - Untitled.mp3');
    const entry = (await cache.save(source, taggedMp3()))!;

    const meta = await cache.readMeta(entry);
    expect(meta.title).toBe('Tagged');
    expect(meta.artist).toBe('Someone');
    expect(meta.coverUri).toMatch(/^file:\/\/\/docs\/tracks\/.+\.cover\.jpg$/);
    expect(fs.files.has(meta.coverUri!.replace('file://', ''))).toBe(true);

    // The cached copy is recognised as the same hit as the search result.
    expect(cache.findByHit(cache.asHit(entry))).toBe(entry);

    await cache.clear();
    expect([...fs.files.keys()].some(path => path.includes('.cover.'))).toBe(false);
  });

  test('reads the tag of an older entry from disk once', async () => {
    const fs = memoryFs();
    const cache = new TrackCache(fs, 10_000);
    await cache.load();
    const entry = (await cache.save(hit('a\\b\\c.mp3'), bytes(300)))!;
    // Pretend it was saved before covers existed.
    delete entry.cover;
    fs.files.set(`/docs/tracks/${entry.file}`, Buffer.from(taggedMp3()).toString('base64'));

    expect((await cache.readMeta(entry)).title).toBe('Tagged');
    expect(entry.cover).toMatch(/\.cover\.jpg$/);
  });
});

describe('writing big tracks', () => {
  test('a track written in pieces reads back byte for byte', async () => {
    const fs = memoryFs();
    let appends = 0;
    fs.appendBase64 = async (path, data) => {
      appends++;
      fs.files.set(path, (fs.files.get(path) ?? '') + data);
    };
    // Not a multiple of the piece size, so the last piece is short.
    const bytes = Uint8Array.from({ length: WRITE_CHUNK_BYTES * 3 + 1234 }, (_, i) => (i * 7 + 3) % 256);

    await writeBytesInChunks(fs, '/docs/tracks/a.mp3', bytes);

    expect(appends).toBe(3);
    const back = Buffer.from(fs.files.get('/docs/tracks/a.mp3') ?? '', 'base64');
    expect(back.equals(Buffer.from(bytes))).toBe(true);
  });

  test('a saved download leaves no partial file behind', async () => {
    const fs = memoryFs();
    fs.appendBase64 = async (path, data) => void fs.files.set(path, (fs.files.get(path) ?? '') + data);
    const cache = new TrackCache(fs, 100 * 1024 * 1024);
    await cache.load();

    const bytes = Uint8Array.from({ length: WRITE_CHUNK_BYTES * 2 + 5 }, (_, i) => i % 256);
    const entry = await cache.save(hit('Music\\Artist\\Song.mp3'), bytes);

    expect(entry).not.toBeNull();
    expect([...fs.files.keys()].some(path => path.endsWith('.part'))).toBe(false);
    const stored = Buffer.from(fs.files.get(`/docs/tracks/${entry!.file}`) ?? '', 'base64');
    expect(stored.equals(Buffer.from(bytes))).toBe(true);
  });
});
