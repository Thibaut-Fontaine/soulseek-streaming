import type { FileInfo } from './protocol';

export interface SearchHit extends FileInfo {
  username: string;
  slotFree: boolean;
  avgSpeed: number;
  queueLength: number;
  extension: string;
}

/**
 * The app deliberately only offers MP3. Files are small enough to start
 * streaming almost immediately, and MP3 plays on every iOS/Android device
 * without a platform-specific decoder.
 */
export const STREAMABLE_EXTENSIONS = new Set(['mp3']);

/**
 * Largest file the app streams. The whole file is held in memory while it
 * plays (and copied in pieces to the cache): hour-long mixes of 100+ MB got
 * the app killed on phones with little RAM. Bigger files are left out of
 * search results.
 */
export const MAX_STREAM_BYTES = 64 * 1024 * 1024;

export function extensionOf(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');

  if (dot < 0 || dot === base.length - 1) {
    return '';
  }

  return base.slice(dot + 1).toLowerCase();
}

export function isStreamableFile(filename: string): boolean {
  return STREAMABLE_EXTENSIONS.has(extensionOf(filename));
}

/** Last path component, for display. */
export function baseName(filename: string): string {
  return filename.replace(/\\/g, '/').split('/').pop() ?? filename;
}

const TRACK_NUMBER = /^\s*(?:cd\s*\d+\s*)?(?:\d{1,2}[-.])?\d{1,3}(?:\s*[-._)]\s*|\s+)/i;

function isTrackNumber(value: string): boolean {
  return /^\s*(?:\d{1,2}[-.])?\d{1,3}\s*$/.test(value);
}

/**
 * Best-effort artist/title parsing from a Soulseek path such as
 * `Music\Artist\Album\01 - Title.mp3` or `Artist - Title.mp3`.
 */
export function parseTrackName(filename: string): { artist: string | null; title: string } {
  const base = baseName(filename);
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/_/g, ' ').trim();
  const parts = stem
    .split(/\s+[-–—]\s+/)
    .map(part => part.trim())
    .filter(part => part.length > 0 && !isTrackNumber(part));

  let artist: string | null = null;
  let title = stem;

  if (parts.length >= 2) {
    artist = parts[0].replace(TRACK_NUMBER, '').trim() || null;
    title = parts[parts.length - 1];
  } else if (parts.length === 1) {
    title = parts[0];
  }

  // "01. Title", "1-03 Title": strip a leading track number, but keep titles
  // that are only a number (e.g. "1999").
  const stripped = title.replace(TRACK_NUMBER, '').trim();
  if (stripped.length > 0) {
    title = stripped;
  }

  if (!artist) {
    // ".../Artist/Album/Track.mp3"
    const folders = filename.replace(/\\/g, '/').split('/').filter(Boolean);
    if (folders.length >= 3) {
      artist = folders[folders.length - 3];
    }
  }

  return { artist, title };
}

/** Track title for display. */
export function displayTitle(filename: string): string {
  return parseTrackName(filename).title;
}

export function displayArtist(hit: { filename: string }): string | null {
  return parseTrackName(hit.filename).artist;
}

/** Details read from a track's ID3 tag, when it has one. */
export interface TrackMeta {
  title?: string;
  artist?: string;
  album?: string;
  /** `file://` or `data:` URI of the embedded cover; null when there is none. */
  coverUri: string | null;
}

export function hitKey(hit: { username: string; filename: string }): string {
  return `${hit.username.toLowerCase()}\u0000${hit.filename}`;
}
