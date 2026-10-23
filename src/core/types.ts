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

/** Best-effort "Artist - Title" parsing from a Soulseek path. */
export function displayTitle(filename: string): string {
  const base = baseName(filename);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function displayArtist(hit: SearchHit): string | null {
  const title = displayTitle(hit.filename);

  if (title.includes(' - ')) {
    const [artist] = title.split(' - ');
    return artist.trim() || null;
  }

  // Try the parent folder name (".../Artist/Album/Track.mp3").
  const parts = hit.filename.replace(/\\/g, '/').split('/').filter(Boolean);

  if (parts.length >= 3) {
    return parts[parts.length - 3];
  }

  return null;
}

export function hitKey(hit: { username: string; filename: string }): string {
  return `${hit.username.toLowerCase()}\u0000${hit.filename}`;
}
