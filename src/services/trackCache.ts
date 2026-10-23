import { Buffer } from 'buffer';

import type { SharedFileInfo } from '../core/protocol';
import { AUTO_MATCH_SCORE, matchScore } from '../core/search';
import { baseName, hitKey } from '../core/types';
import type { SearchHit } from '../core/types';
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
}

const INDEX_FILE = 'index.json';
const SHARE_FOLDER = 'SoulStream';
/** Larger files are not worth keeping on a phone. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;

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

  constructor(
    private readonly fs: CacheFs,
    private maxBytes: number,
  ) {}

  setLimit(maxBytes: number): void {
    this.maxBytes = maxBytes;
    void this.serialize(() => this.evict());
  }

  get totalBytes(): number {
    return this.entries.reduce((sum, entry) => sum + entry.size, 0);
  }

  get count(): number {
    return this.entries.length;
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
  findByHit(hit: SearchHit): CacheEntry | null {
    const key = hitKey(hit);
    return this.entries.find(entry => entry.sourceKey === key) ?? null;
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

  /** A SearchHit describing a cached entry, for display and matching. */
  asHit(entry: CacheEntry): SearchHit {
    return {
      username: '',
      filename: entry.sourceFilename,
      size: entry.size,
      bitrate: entry.bitrate,
      durationSec: entry.durationSec,
      slotFree: true,
      avgSpeed: 0,
      queueLength: 0,
      extension: 'mp3',
    };
  }

  markPlayed(entry: CacheEntry): void {
    entry.lastPlayedAt = Date.now();
    void this.serialize(() => this.saveIndex());
  }

  /** Stores a completed download. */
  save(hit: SearchHit, bytes: Uint8Array): Promise<CacheEntry | null> {
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
      await this.fs.writeBase64(`${this.fs.dir}/${file}`, Buffer.from(bytes).toString('base64'));

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

      this.entries.push(entry);
      await this.evict();
      await this.saveIndex();
      return this.entries.includes(entry) ? entry : null;
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

  async clear(): Promise<void> {
    await this.serialize(async () => {
      for (const entry of this.entries) {
        await this.fs.unlink(`${this.fs.dir}/${entry.file}`).catch(() => {});
      }

      this.entries = [];
      await this.saveIndex();
    });
  }

  /** Drops the least recently played tracks until the cache fits. */
  private async evict(): Promise<void> {
    this.entries.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);

    while (this.entries.length > 0 && this.totalBytes > this.maxBytes) {
      const victim = this.entries.pop()!;
      await this.fs.unlink(`${this.fs.dir}/${victim.file}`).catch(() => {});
    }
  }

  private async saveIndex(): Promise<void> {
    await this.fs.writeText(`${this.fs.dir}/${INDEX_FILE}`, JSON.stringify(this.entries));
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
