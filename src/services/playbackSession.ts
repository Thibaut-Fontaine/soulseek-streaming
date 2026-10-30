/**
 * The last playback session, kept on the device so a crash, a low-memory kill
 * or a manual close can resume the same track at the same second.
 *
 * Everything here is pure except `defaultSessionStore`, so it can be tested
 * with an in-memory store and a fake clock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CatalogPlayContext } from '../core/catalogTypes';
import type { SearchHit } from '../core/types';

export const PLAYBACK_SESSION_KEY = '@soulstream/playback-session/v1';
export const PLAYBACK_SESSION_VERSION = 1;

/** What "next"/"previous" walk through while a track plays. */
export interface PersistedPlayContext {
  label: string;
  items: SearchHit[];
  index: number;
}

export interface PlaybackSession {
  version: number;
  hit: SearchHit;
  source: 'network' | 'cache';
  queue: SearchHit[];
  context: PersistedPlayContext | null;
  catalogContext: CatalogPlayContext | null;
  shuffle: boolean;
  repeat: boolean;
  /** Where the track was when the session was saved. */
  positionSec: number;
  savedAt: number;
}

export interface SessionStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** AsyncStorage-backed store used by the app. */
export const defaultSessionStore: SessionStore = {
  getItem: key => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: key => AsyncStorage.removeItem(key),
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSearchHit(value: unknown): value is SearchHit {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const hit = value as Partial<SearchHit>;
  return (
    typeof hit.username === 'string' &&
    typeof hit.filename === 'string' &&
    hit.filename.length > 0 &&
    isFiniteNumber(hit.size) &&
    hit.size >= 0 &&
    typeof hit.extension === 'string' &&
    typeof hit.slotFree === 'boolean' &&
    isFiniteNumber(hit.avgSpeed) &&
    isFiniteNumber(hit.queueLength)
  );
}

function searchHits(value: unknown): SearchHit[] {
  return Array.isArray(value) ? value.filter(isSearchHit) : [];
}

function persistedContext(value: unknown): PersistedPlayContext | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const context = value as Partial<PersistedPlayContext>;
  const items = searchHits(context.items);

  if (typeof context.label !== 'string' || items.length === 0) {
    return null;
  }

  const index = isFiniteNumber(context.index) ? Math.trunc(context.index) : 0;
  return { label: context.label, items, index: Math.min(Math.max(index, 0), items.length - 1) };
}

function catalogContext(value: unknown): CatalogPlayContext | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const context = value as Partial<CatalogPlayContext>;
  const tracks = Array.isArray(context.tracks)
    ? context.tracks.filter(
        track =>
          !!track &&
          typeof track === 'object' &&
          typeof track.id === 'string' &&
          typeof track.title === 'string' &&
          !!track.artist &&
          typeof track.artist.name === 'string',
      )
    : [];

  if (typeof context.label !== 'string' || tracks.length === 0) {
    return null;
  }

  const index = isFiniteNumber(context.index) ? Math.trunc(context.index) : 0;
  return { label: context.label, tracks, index: Math.min(Math.max(index, 0), tracks.length - 1) };
}

/** Validates a stored session; null means "nothing playable". */
export function parseSession(raw: string | null): PlaybackSession | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const value = parsed as Partial<PlaybackSession>;

  if (value.version !== PLAYBACK_SESSION_VERSION || !isSearchHit(value.hit)) {
    return null;
  }

  return {
    version: PLAYBACK_SESSION_VERSION,
    hit: value.hit,
    source: value.source === 'cache' ? 'cache' : 'network',
    queue: searchHits(value.queue),
    context: persistedContext(value.context),
    catalogContext: catalogContext(value.catalogContext),
    shuffle: value.shuffle === true,
    repeat: value.repeat === true,
    positionSec: isFiniteNumber(value.positionSec) ? Math.max(0, value.positionSec) : 0,
    savedAt: isFiniteNumber(value.savedAt) ? value.savedAt : 0,
  };
}

export function serializeSession(session: PlaybackSession): string {
  return JSON.stringify({ ...session, version: PLAYBACK_SESSION_VERSION });
}

export async function loadSession(store: SessionStore = defaultSessionStore): Promise<PlaybackSession | null> {
  try {
    return parseSession(await store.getItem(PLAYBACK_SESSION_KEY));
  } catch {
    return null;
  }
}

export async function saveSession(
  session: PlaybackSession,
  store: SessionStore = defaultSessionStore,
): Promise<void> {
  try {
    await store.setItem(PLAYBACK_SESSION_KEY, serializeSession(session));
  } catch {
    // Losing the resume point is not worth interrupting playback for.
  }
}

export async function clearSession(store: SessionStore = defaultSessionStore): Promise<void> {
  try {
    await store.removeItem(PLAYBACK_SESSION_KEY);
  } catch {
    // Ignore.
  }
}

export type RestorePlan = 'play-cache' | 'play-network' | 'wait';

/**
 * A cache hit always wins (it needs no network); otherwise the source is
 * retried when the server is online. Offline we keep the session for later
 * instead of throwing the position away.
 */
export function planRestore(
  session: PlaybackSession,
  options: { online: boolean; cached: boolean },
): RestorePlan {
  if (options.cached) {
    return 'play-cache';
  }

  return options.online ? 'play-network' : 'wait';
}

export interface SessionRecorderOptions {
  store: SessionStore;
  /** Current playable session, or null when nothing should be saved. */
  snapshot: () => Omit<PlaybackSession, 'version' | 'positionSec' | 'savedAt'> | null;
  /** Reads the player's position, in seconds. */
  position: () => Promise<number>;
  /** How long to wait after the last change before writing. */
  debounceMs?: number;
  /** How often to refresh the position while playing; 0 disables it. */
  tickMs?: number;
}

export interface SessionRecorder {
  /** Something changed (track, queue, shuffle…): save soon. */
  touch(): void;
  /** Writes a pending session now. */
  flush(): Promise<void>;
  /** Deletes the stored session. */
  clear(): Promise<void>;
  /** Stops the ticker and flushes what is pending. */
  stop(): Promise<void>;
}

/** Persists the session at most once per `debounceMs`, plus a slow position tick. */
export function createSessionRecorder(options: SessionRecorderOptions): SessionRecorder {
  const { store, snapshot, position, debounceMs = 1000, tickMs = 5000 } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let pending = false;
  let stopped = false;

  const cancelTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = async (): Promise<void> => {
    cancelTimer();
    const wasPending = pending;
    pending = false;

    if (!wasPending) {
      return;
    }

    const current = snapshot();

    if (!current) {
      await clearSession(store);
      return;
    }

    let seconds = 0;

    try {
      seconds = await position();
    } catch {
      // Keep the last known position (0) rather than failing the save.
    }

    if (stopped && !wasPending) {
      return;
    }

    await saveSession(
      {
        ...current,
        version: PLAYBACK_SESSION_VERSION,
        positionSec: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
        savedAt: Date.now(),
      },
      store,
    );
  };

  const touch = (): void => {
    if (stopped || !snapshot()) {
      return;
    }

    pending = true;
    cancelTimer();
    timer = setTimeout(() => {
      void flush();
    }, debounceMs);
  };

  if (tickMs > 0) {
    ticker = setInterval(touch, tickMs);
    // Node/Jest timers keep the process alive; React Native's do not.
    (ticker as unknown as { unref?: () => void }).unref?.();
  }

  return {
    touch,
    flush,
    clear: async () => {
      pending = false;
      cancelTimer();
      await clearSession(store);
    },
    stop: async () => {
      if (ticker) {
        clearInterval(ticker);
        ticker = null;
      }
      stopped = true;
      await flush();
    },
  };
}
