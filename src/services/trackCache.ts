import { Buffer } from 'buffer';

import { id3TagSize, parseId3 } from '../core/id3';
import type { Id3Tags } from '../core/id3';
import type { SharedFileInfo } from '../core/protocol';
import { AUTO_MATCH_SCORE, matchScore } from '../core/search';
import { baseName, hitKey } from '../core/types';
import type { SearchHit, TrackMeta } from '../core/types';
import type { ShareFileReader, ShareLibrary } from '../core/uploads';

/** The few file operations the cache needs. Backed by react-native-blob-util. */
export interface CacheFs {
  readonly dir: string;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeBase64(path: string, data: string): Promise<void>;
  readBase64(path: string): Promise<string>;
  writeText(path: string, data: string): Promise<void>;
  readText(path: string): Promise<string>;
  unlink(path: string): Promise<void>;
  /** Moves a file, e.g. a picked file copied to the app's caches first. */
  move(from: string, to: string): Promise<void>;
  /** Bytes `start`..`end` of a file, base64. Used to read tags cheaply. */
  readSliceBase64?(path: string, start: number, end: number): Promise<string>;
  /** Appends base64 data; lets big files be written in pieces. */
  appendBase64?(path: string, data: string): Promise<void>;
}

/**
 * Piece size when writing a track: base64-encoding a whole 10 MB MP3 in one
 * go froze the JS thread for seconds on phones. A multiple of 3 bytes, so the
 * base64 pieces join without padding in the middle.
 */
export const WRITE_CHUNK_BYTES = 192 * 1024;

/**
 * Bytes to store, read piece by piece. A finished download is read straight
 * from its stream buffer: copying a whole 10 MB file first doubled the
 * memory needed at the end of every download.
 */
export interface ByteSource {
  readonly length: number;
  read(offset: number, length: number): Uint8Array;
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    length: bytes.length,
    read: (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
  };
}

function base64(piece: Uint8Array): string {
  return Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).toString('base64');
}

/** Writes bytes to `path` piece by piece, giving the UI a turn between pieces. */
export async function writeBytesInChunks(
  fs: CacheFs,
  path: string,
  input: Uint8Array | ByteSource,
): Promise<void> {
  const source = input instanceof Uint8Array ? bytesSource(input) : input;

  if (!fs.appendBase64 || source.length <= WRITE_CHUNK_BYTES) {
    await fs.writeBase64(path, base64(source.read(0, source.length)));
    return;
  }

  for (let offset = 0; offset < source.length; offset += WRITE_CHUNK_BYTES) {
    const data = base64(source.read(offset, WRITE_CHUNK_BYTES));
    await (offset === 0 ? fs.writeBase64(path, data) : fs.appendBase64(path, data));
  }
}

export interface CacheEntry {
  /** Path other users see, e.g. `SoulStream\\Artist - Title.mp3`. */
  sharedPath: string;
  /** File name inside the cache directory. */
  file: string;
  size: number;
  bitrate?: number;
  durationSec?: number;
  /** Where it came from, to recognise the same file in search results. */
  sourceKey: string;
  sourceFilename: string;
  addedAt: number;
  lastPlayedAt: number;
  /**
   * Added by the user from the phone's music, not downloaded. Never evicted
   * and not counted in the cache limit: it is there to be shared.
   */
  imported?: boolean;
  /**
   * Cover file name in the cache directory. `null`: the track has no cover.
   * `undefined`: not looked at yet.
   */
  cover?: string | null;
  tagTitle?: string;
  tagArtist?: string;
  tagAlbum?: string;
}

/** Result of adding one file from the phone. */
export type ImportResult =
  | { status: 'added'; entry: CacheEntry }
  | { status: 'duplicate'; entry: CacheEntry }
  | { status: 'skipped'; reason: string };

const INDEX_FILE = 'index.json';
const SHARE_FOLDER = 'SoulStream';
/** Larger files are not worth keeping on a phone. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
/** Added files can be longer (mixes, live sets) but stay reasonable. */
const MAX_IMPORT_BYTES = 150 * 1024 * 1024;
/** Tags bigger than this are not read from disk (covers are small). */
const MAX_TAG_BYTES = 4 * 1024 * 1024;

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
}

/**
 * Tracks already played, kept on disk. It doubles as the shared folder: the
 * files are ones the user listened to, so sharing them is honest and costs
 * no extra setup.
 */
export class TrackCache implements ShareLibrary {
  private entries: CacheEntry[] = [];
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly hits = new WeakMap<CacheEntry, SearchHit>();

  constructor(
    private readonly fs: CacheFs,
    private maxBytes: number,
  ) {}

  /** Called after every change to the list of tracks or their tags. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setLimit(maxBytes: number): void {
    this.maxBytes = maxBytes;
    void this.serialize(() => this.evict());
  }

  /** Downloaded tracks only: the part limited by the cache size setting. */
  get totalBytes(): number {
    return this.downloaded().reduce((sum, entry) => sum + entry.size, 0);
  }

  get count(): number {
    return this.downloaded().length;
  }

  get importedBytes(): number {
    return this.imported().reduce((sum, entry) => sum + entry.size, 0);
  }

  get importedCount(): number {
    return this.imported().length;
  }

  private downloaded(): CacheEntry[] {
    return this.entries.filter(entry => !entry.imported);
  }

  private imported(): CacheEntry[] {
    return this.entries.filter(entry => entry.imported);
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      if (!(await this.fs.exists(this.fs.dir))) {
        await this.fs.mkdir(this.fs.dir);
      }

      const path = `${this.fs.dir}/${INDEX_FILE}`;

      if (await this.fs.exists(path)) {
        const parsed = JSON.parse(await this.fs.readText(path)) as CacheEntry[];
        this.entries = Array.isArray(parsed) ? parsed.filter(e => e && e.file && e.sharedPath) : [];
      }
    } catch {
      this.entries = [];
    }
  }

  files(): SharedFileInfo[] {
    return this.entries.map(entry => ({
      path: entry.sharedPath,
      size: entry.size,
      bitrate: entry.bitrate,
      durationSec: entry.durationSec,
    }));
  }

  /** Local file URI for the player. */
  uriFor(entry: CacheEntry): string {
    return `file://${this.fs.dir}/${entry.file}`;
  }

  /** The cached copy of a search hit, if we already have that file. */
  findByHit(hit: Pick<SearchHit, 'username' | 'filename'>): CacheEntry | null {
    const key = hitKey(hit);
    const exact = this.entries.find(entry => entry.sourceKey === key);

    if (exact || hit.username) {
      return exact ?? null;
    }

    // Added files have no peer.
    return this.entries.find(entry => entry.imported && entry.sourceFilename === hit.filename) ?? null;
  }

  /** Cached tracks matching a query, best first. */
  search(query: string, minScore: number): CacheEntry[] {
    return this.entries
      .map(entry => ({ entry, score: matchScore(query, this.asHit(entry)) }))
      .filter(item => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .map(item => item.entry);
  }

  /** Every track on the device, most recently played (or added) first. */
  all(): CacheEntry[] {
    return [...this.entries].sort(
      (a, b) => Math.max(b.lastPlayedAt, b.addedAt) - Math.max(a.lastPlayedAt, a.addedAt),
    );
  }

  /**
   * Title, artist and cover from the file's tag. Read once from disk, then
   * remembered in the index.
   */
  async readMeta(entry: CacheEntry): Promise<TrackMeta> {
    if (entry.cover === undefined) {
      await this.serialize(() => this.extractFromDisk(entry));
    }

    return this.metaOf(entry);
  }

  metaOf(entry: CacheEntry): TrackMeta {
    return {
      title: entry.tagTitle,
      artist: entry.tagArtist,
      album: entry.tagAlbum,
      coverUri: entry.cover ? `file://${this.fs.dir}/${entry.cover}` : null,
    };
  }

  private async extractFromDisk(entry: CacheEntry): Promise<void> {
    if (entry.cover !== undefined || !this.entries.includes(entry)) {
      return;
    }

    const path = `${this.fs.dir}/${entry.file}`;
    let tags: Id3Tags | null = null;

    try {
      if (this.fs.readSliceBase64) {
        const head = Buffer.from(await this.fs.readSliceBase64(path, 0, 10), 'base64');
        const size = id3TagSize(new Uint8Array(head));

        if (size > 0 && size <= MAX_TAG_BYTES) {
          const bytes = Buffer.from(await this.fs.readSliceBase64(path, 0, size), 'base64');
          tags = parseId3(new Uint8Array(bytes));
        }
      } else if (entry.size <= MAX_FILE_BYTES) {
        tags = parseId3(new Uint8Array(Buffer.from(await this.fs.readBase64(path), 'base64')));
      }
    } catch {
      tags = null;
    }

    await this.applyTags(entry, tags);
    await this.saveIndex();
  }

  /** Writes the cover next to the track and keeps the text tags. */
  private async applyTags(entry: CacheEntry, tags: Id3Tags | null): Promise<void> {
    entry.tagTitle = tags?.title;
    entry.tagArtist = tags?.artist;
    entry.tagAlbum = tags?.album;
    entry.cover = null;

    if (tags?.picture) {
      const extension = tags.picture.mime === 'image/png' ? 'png' : 'jpg';
      const cover = `${entry.file.replace(/\.[^.]+$/, '')}.cover.${extension}`;

      try {
        await this.fs.writeBase64(`${this.fs.dir}/${cover}`, Buffer.from(tags.picture.data).toString('base64'));
        entry.cover = cover;
      } catch {
        entry.cover = null;
      }
    }
  }

  private async removeFiles(entry: CacheEntry): Promise<void> {
    await this.fs.unlink(`${this.fs.dir}/${entry.file}`).catch(() => {});

    if (entry.cover) {
      await this.fs.unlink(`${this.fs.dir}/${entry.cover}`).catch(() => {});
    }
  }

  /** The best cached track for a query, if it matches well enough. */
  findByQuery(query: string, minScore = AUTO_MATCH_SCORE): CacheEntry | null {
    let best: { entry: CacheEntry; score: number } | null = null;

    for (const entry of this.entries) {
      const score = matchScore(query, this.asHit(entry));

      if (score >= minScore && (!best || score > best.score)) {
        best = { entry, score };
      }
    }

    return best?.entry ?? null;
  }

  /**
   * A SearchHit describing a cached entry, for display and matching. The same
   * object is returned for an entry each time, so search scoring caches and
   * memoised rows can reuse their work.
   */
  asHit(entry: CacheEntry): SearchHit {
    const known = this.hits.get(entry);
    if (known) {
      return known;
    }

    // Downloads keep the peer's name (`sourceKey` is its hitKey), so the hit
    // matches the one in search results, likes and history.
    const separator = entry.sourceKey.indexOf('\u0000');

    const hit: SearchHit = {
      username: !entry.imported && separator > 0 ? entry.sourceKey.slice(0, separator) : '',
      filename: entry.sourceFilename,
      size: entry.size,
      bitrate: entry.bitrate,
      durationSec: entry.durationSec,
      slotFree: true,
      avgSpeed: 0,
      queueLength: 0,
      extension: 'mp3',
    };
    this.hits.set(entry, hit);
    return hit;
  }

  markPlayed(entry: CacheEntry): void {
    entry.lastPlayedAt = Date.now();
    void this.serialize(() => this.saveIndex());
  }

  /** Stores a completed download. */
  save(hit: SearchHit, input: Uint8Array | ByteSource): Promise<CacheEntry | null> {
    const bytes = input instanceof Uint8Array ? bytesSource(input) : input;
    return this.serialize(async () => {
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
        return null;
      }

      const existing = this.findByHit(hit);

      if (existing) {
        existing.lastPlayedAt = Date.now();
        await this.saveIndex();
        return existing;
      }

      const name = safeName(baseName(hit.filename)) || 'track.mp3';
      let sharedPath = `${SHARE_FOLDER}\\${name}`;

      for (let n = 2; this.entries.some(e => e.sharedPath === sharedPath); n++) {
        sharedPath = `${SHARE_FOLDER}\\${name.replace(/(\.[^.]+)?$/, ` (${n})$1`)}`;
      }

      const file = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}.mp3`;
      // Written under a temporary name: an interrupted write never leaves a
      // truncated track that looks complete.
      const partial = `${this.fs.dir}/${file}.part`;
      await writeBytesInChunks(this.fs, partial, bytes);
      await this.fs.move(partial, `${this.fs.dir}/${file}`);

      const entry: CacheEntry = {
        sharedPath,
        file,
        size: bytes.length,
        bitrate: hit.bitrate,
        durationSec: hit.durationSec,
        sourceKey: hitKey(hit),
        sourceFilename: hit.filename,
        addedAt: Date.now(),
        lastPlayedAt: Date.now(),
      };

      const size = id3TagSize(bytes.read(0, 10));
      await this.applyTags(entry, size > 0 && size <= MAX_TAG_BYTES ? parseId3(bytes.read(0, size)) : null);

      this.entries.push(entry);
      await this.evict();
      await this.saveIndex();
      return this.entries.includes(entry) ? entry : null;
    });
  }

  /**
   * Adds an MP3 from the phone to the shared folder. `localPath` is a file
   * the app owns (the picker's local copy); it is moved, not copied again.
   */
  importFile(localPath: string, name: string, size: number): Promise<ImportResult> {
    return this.serialize(async () => {
      const cleanName = safeName(name.trim()) || 'track.mp3';

      if (!/\.mp3$/i.test(cleanName)) {
        await this.fs.unlink(localPath).catch(() => {});
        return { status: 'skipped', reason: 'pas un MP3' };
      }

      if (size <= 0 || size > MAX_IMPORT_BYTES) {
        await this.fs.unlink(localPath).catch(() => {});
        return { status: 'skipped', reason: size <= 0 ? 'fichier vide' : 'fichier trop gros' };
      }

      const sourceKey = `import:${cleanName.toLowerCase()}:${size}`;
      const existing = this.entries.find(entry => entry.sourceKey === sourceKey);

      if (existing) {
        await this.fs.unlink(localPath).catch(() => {});
        return { status: 'duplicate', entry: existing };
      }

      let sharedPath = `${SHARE_FOLDER}\\${cleanName}`;

      for (let n = 2; this.entries.some(e => e.sharedPath === sharedPath); n++) {
        sharedPath = `${SHARE_FOLDER}\\${cleanName.replace(/(\.[^.]+)?$/, ` (${n})$1`)}`;
      }

      const file = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}.mp3`;
      await this.fs.move(localPath, `${this.fs.dir}/${file}`);

      const entry: CacheEntry = {
        sharedPath,
        file,
        size,
        sourceKey,
        sourceFilename: cleanName,
        addedAt: Date.now(),
        lastPlayedAt: 0,
        imported: true,
      };

      this.entries.push(entry);
      await this.saveIndex();
      return { status: 'added', entry };
    });
  }

  async open(path: string): Promise<ShareFileReader | null> {
    const entry = this.entries.find(e => e.sharedPath === path);

    if (!entry) {
      return null;
    }

    let bytes: Uint8Array;

    try {
      // Tracks are a few MB; reading the whole file once is simpler and
      // faster over the bridge than many small reads.
      bytes = new Uint8Array(Buffer.from(await this.fs.readBase64(`${this.fs.dir}/${entry.file}`), 'base64'));
    } catch {
      return null;
    }

    return {
      size: bytes.length,
      read: async (offset, length) => bytes.subarray(offset, offset + length),
      close: () => {
        bytes = new Uint8Array(0);
      },
    };
  }

  /** Deletes downloaded tracks (`imported: false`) or added ones (`true`). */
  async clear(imported = false): Promise<void> {
    await this.serialize(async () => {
      const removed = this.entries.filter(entry => Boolean(entry.imported) === imported);

      for (const entry of removed) {
        await this.removeFiles(entry);
      }

      this.entries = this.entries.filter(entry => Boolean(entry.imported) !== imported);
      await this.saveIndex();
    });
  }

  /**
   * Drops the least recently played downloads until they fit the limit.
   * Added files are never dropped.
   */
  private async evict(): Promise<void> {
    const downloads = this.downloaded().sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
    let bytes = downloads.reduce((sum, entry) => sum + entry.size, 0);

    while (downloads.length > 0 && bytes > this.maxBytes) {
      const victim = downloads.pop()!;
      bytes -= victim.size;
      this.entries = this.entries.filter(entry => entry !== victim);
      await this.removeFiles(victim);
    }
  }

  private async saveIndex(): Promise<void> {
    await this.fs.writeText(`${this.fs.dir}/${INDEX_FILE}`, JSON.stringify(this.entries));

    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A listener must not break the cache.
      }
    }
  }

  /** Runs file operations one at a time. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writing.then(task, task);
    this.writing = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
