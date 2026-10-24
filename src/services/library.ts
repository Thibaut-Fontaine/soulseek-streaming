import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CatalogTrack } from '../core/catalogTypes';
import { normalizeForMatch } from '../core/search';
import { displayArtist, displayTitle } from '../core/types';
import type { SearchHit } from '../core/types';

/** A track the user liked or played, with the last source it came from. */
export interface SavedTrack {
  /** Identity of the song, independent of the peer (see `trackIdentity`). */
  key: string;
  title: string;
  artist: string | null;
  hit: SearchHit;
  /** The catalog track of that file, when it was matched: cover, album... */
  catalog?: CatalogTrack;
  /** When it was liked, or last played. */
  at: number;
}

export interface Library {
  liked: SavedTrack[];
  history: SavedTrack[];
  recentSearches: string[];
}

export const EMPTY_LIBRARY: Library = { liked: [], history: [], recentSearches: [] };

const LIBRARY_KEY = '@soulstream/library/v1';
export const MAX_HISTORY = 200;
export const MAX_RECENT_SEARCHES = 8;

/** Same song from two peers gives the same identity. */
export function trackIdentity(hit: { filename: string }): string {
  const title = displayTitle(hit.filename);
  const artist = displayArtist(hit) ?? '';
  return normalizeForMatch(`${artist} ${title}`) || normalizeForMatch(hit.filename);
}

export function savedTrack(
  hit: SearchHit,
  meta?: { title?: string; artist?: string },
  catalog?: CatalogTrack | null,
): SavedTrack {
  return {
    key: trackIdentity(hit),
    title: catalog?.title ?? meta?.title ?? displayTitle(hit.filename),
    artist: catalog?.artist.name ?? meta?.artist ?? displayArtist(hit),
    hit,
    ...(catalog ? { catalog } : {}),
    at: Date.now(),
  };
}

export function isLiked(library: Library, hit: { filename: string }): boolean {
  const key = trackIdentity(hit);
  return library.liked.some(track => track.key === key);
}

/** Adds or removes a like. Newest first. */
export function toggleLike(library: Library, track: SavedTrack): Library {
  const exists = library.liked.some(item => item.key === track.key);

  return {
    ...library,
    liked: exists
      ? library.liked.filter(item => item.key !== track.key)
      : [track, ...library.liked],
  };
}

/** Moves a played track to the top of the history, without duplicates. */
export function addToHistory(library: Library, track: SavedTrack): Library {
  return {
    ...library,
    history: [track, ...library.history.filter(item => item.key !== track.key)].slice(0, MAX_HISTORY),
  };
}

export function addRecentSearch(library: Library, query: string): Library {
  const clean = query.trim();

  if (!clean) {
    return library;
  }

  const lower = clean.toLowerCase();

  return {
    ...library,
    recentSearches: [
      clean,
      ...library.recentSearches.filter(item => item.toLowerCase() !== lower),
    ].slice(0, MAX_RECENT_SEARCHES),
  };
}

export function removeRecentSearch(library: Library, query: string): Library {
  return { ...library, recentSearches: library.recentSearches.filter(item => item !== query) };
}

function validTracks(value: unknown): SavedTrack[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is SavedTrack =>
      item &&
      typeof item.key === 'string' &&
      typeof item.title === 'string' &&
      item.hit &&
      typeof item.hit.filename === 'string' &&
      typeof item.hit.username === 'string',
  );
}

export async function loadLibrary(): Promise<Library> {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);

    if (!raw) {
      return { ...EMPTY_LIBRARY };
    }

    const parsed = JSON.parse(raw) as Partial<Library>;

    return {
      liked: validTracks(parsed.liked),
      history: validTracks(parsed.history).slice(0, MAX_HISTORY),
      recentSearches: Array.isArray(parsed.recentSearches)
        ? parsed.recentSearches.filter(item => typeof item === 'string').slice(0, MAX_RECENT_SEARCHES)
        : [],
    };
  } catch {
    return { ...EMPTY_LIBRARY };
  }
}

export async function saveLibrary(library: Library): Promise<void> {
  try {
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    // Losing the library is not worth interrupting playback for.
  }
}
