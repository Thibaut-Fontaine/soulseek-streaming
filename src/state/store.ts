import { PermissionsAndroid, Platform } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import { create } from 'zustand';

import type { ConnectionState } from '../core/soulseekClient';
import type { TransferSnapshot } from '../core/transfer';
import {
  AUTO_MATCH_SCORE,
  formatSearchQuery,
  normalizeForMatch,
  pickBestMatch,
  rankHits,
  similarity,
} from '../core/search';
import type { RankedHit } from '../core/search';
import { displayArtist, displayTitle, hitKey, isStreamableFile } from '../core/types';
import type { SearchHit } from '../core/types';
import type { StreamTransfer } from '../core/transfer';
import { ensurePlayer, resetPlayer } from '../player/player';
import { clearCredentials, loadCredentials, loadSettings, saveCredentials, saveSettings } from '../services/settings';
import type { Credentials, Settings } from '../services/settings';
import { StreamingService } from '../services/streaming';
import { createBlobUtilFs } from '../services/blobUtilFs';
import { TrackCache } from '../services/trackCache';
import type { CacheEntry } from '../services/trackCache';
import { contentTypeFor } from '../stream/httpServer';

export type Tab = 'search' | 'player' | 'settings';

export interface CurrentPlayback {
  hit: SearchHit;
  transferId: string;
  url: string;
  phase: 'preparing' | 'playing' | 'error';
  error: string | null;
  bufferTarget: number;
  /** 1-based number of the source being tried for this track. */
  attempt: number;
  /** Set when we switched away from a source that failed: who and why. */
  fallback: { username: string; reason: string } | null;
  /** `cache` when played from a track already on the device. */
  source: 'network' | 'cache';
  /**
   * The source dropped while playing. Playback continues with the bytes that
   * already arrived; the UI can offer another source.
   */
  warning: string | null;
}

interface AppState {
  ready: boolean;
  playerReady: boolean;
  settings: Settings;

  username: string | null;
  prefillUsername: string;
  connection: ConnectionState;
  connectionError: string | null;
  listenPort: number;
  httpPort: number;

  tab: Tab;
  query: string;
  searching: boolean;
  searchQuery: string;
  searchEmpty: boolean;
  searchError: string | null;
  matchHit: SearchHit | null;
  /** Ranked sources for the last search, best first. Includes weaker matches. */
  results: RankedHit[];

  transfers: Record<string, TransferSnapshot>;
  current: CurrentPlayback | null;
  notice: string | null;

  init: () => Promise<void>;
  login: (username: string, password: string, keepSessionOnFailure?: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
  reconnect: () => Promise<void>;
  applySettings: (settings: Settings) => Promise<void>;
  setTab: (tab: Tab) => void;
  setQuery: (query: string) => void;
  runSearch: (query?: string) => Promise<void>;
  cancelSearch: () => void;
  /** Plays a source; on failure falls back to other sources of the same track. */
  playHit: (hit: SearchHit) => Promise<void>;
  /** Skips the current source and tries the next one. */
  playNextSource: () => Promise<void>;
  retryPlayback: () => Promise<void>;
  stopPlayback: () => Promise<void>;
  dismissNotice: () => void;
  /** Tracks on the device (shared with others when sharing is on). */
  cacheStats: () => { count: number; bytes: number } | null;
  clearCache: () => Promise<void>;
}

let service: StreamingService | null = null;
/** Tracks already played; also our shared folder. Created on init. */
let trackCache: TrackCache | null = null;
let initStarted = false;
let searchSequence = 0;
let playSequence = 0;

/** Peers that refused us during this session, by lower-cased username. */
const deniedPeers = new Map<string, string>();

class PlaybackCancelled extends Error {
  constructor() {
    super('Lecture annulée');
  }
}

const MAX_TRANSFER_HISTORY = 20;

/** How many sources to try for one track before giving up. */
const MAX_ATTEMPTS = 5;
/** After the first good match, keep collecting this long before choosing. */
const MATCH_WINDOW_MS = 1200;
/** Keep the search open this long after the first match, to fill `results`. */
const RESULTS_AFTER_MATCH_MS = 4000;
const SEARCH_DURATION_MS = 10000;
/** Weaker matches are listed for manual choice but never auto-played. */
const LIST_SCORE = 0.55;

/**
 * Per-step limits. A P2P source that is slow to answer is usually not worth
 * waiting for when another one may start right away. Exported so tests can
 * shorten them.
 */
export const playbackTimeouts = {
  reachPeerMs: 25000,
  acceptFreeSlotMs: 20000,
  acceptNoSlotMs: 12000,
  openFileMs: 20000,
  stallMs: 15000,
  bufferTotalMs: 90000,
};

/** Errors that mean "this peer will not send to us", worth remembering. */
const DENIED_PATTERN = /refus|denied|banned|not shared|ne partage/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bufferTargetFor(size: number, bufferMb: number): number {
  if (size <= 0) {
    return 256 * 1024;
  }

  const cap = Math.max(256 * 1024, bufferMb * 1024 * 1024);
  const proportional = Math.floor(size * 0.15);
  return Math.min(size, Math.max(256 * 1024, Math.min(cap, proportional)));
}

function rememberTransfers(
  transfers: Record<string, TransferSnapshot>,
  snapshot: TransferSnapshot,
): Record<string, TransferSnapshot> {
  const next = { ...transfers, [snapshot.id]: snapshot };
  const ids = Object.keys(next);

  if (ids.length > MAX_TRANSFER_HISTORY) {
    ids
      .sort((a, b) => (next[a]?.startedAt ?? 0) - (next[b]?.startedAt ?? 0))
      .slice(0, ids.length - MAX_TRANSFER_HISTORY)
      .forEach(id => delete next[id]);
  }

  return next;
}

async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return;
  }

  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // Playback still works without the notification.
  }
}

export const useAppStore = create<AppState>((set, get) => {
  function wire(instance: StreamingService): void {
    instance.events.on('state', payload => {
      set(state => ({
        connection: payload.state,
        connectionError: payload.error ?? (payload.state === 'online' ? null : state.connectionError),
        listenPort: instance.listenPort || state.listenPort,
        httpPort: instance.httpPort || state.httpPort,
      }));
    });

    instance.events.on('login', () => {
      set({
        connection: 'online',
        connectionError: null,
        listenPort: instance.listenPort,
        httpPort: instance.httpPort,
      });
    });

    instance.events.on('transfer', snapshot => {
      set(state => {
        // While preparing, the playback loop handles failures (and falls back
        // to another source). Once playing, a failure only means no more
        // bytes: the player keeps going with what already arrived.
        const current =
          state.current &&
          state.current.transferId === snapshot.id &&
          state.current.phase === 'playing' &&
          snapshot.state === 'failed'
            ? {
                ...state.current,
                warning: snapshot.error ?? 'La source a été interrompue',
              }
            : state.current;

        return {
          transfers: rememberTransfers(state.transfers, snapshot),
          current,
        };
      });
    });

    instance.events.on('notice', notice => set({ notice }));
    instance.events.on('log', message => {
      if (__DEV__) {
        console.log('[soulseek]', message);
      }
    });
  }

  /**
   * Resolves when `done(transfer)` is true. Rejects when the transfer fails,
   * when the user starts something else, or after `timeoutMs`.
   */
  function waitForTransfer(
    transferId: string,
    sequence: number,
    done: (transfer: StreamTransfer) => boolean,
    timeoutMs: number,
    timeoutMessage: string,
    stallMs = 0,
  ): Promise<void> {
    const instance = service;

    return new Promise<void>((resolve, reject) => {
      let finished = false;
      let lastBytes = -1;
      let lastProgressAt = Date.now();

      const finish = (error?: Error) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timer);
        clearInterval(ticker);
        unsubscribe?.();

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const check = () => {
        if (sequence !== playSequence) {
          finish(new PlaybackCancelled());
          return;
        }

        const transfer = instance?.getTransfer(transferId);

        if (!transfer) {
          finish(new Error('Transfert introuvable'));
          return;
        }

        if (transfer.state === 'failed' || transfer.state === 'cancelled') {
          finish(new Error(transfer.error ?? 'Le transfert a échoué'));
          return;
        }

        if (done(transfer)) {
          finish();
          return;
        }

        if (stallMs > 0) {
          if (transfer.received !== lastBytes) {
            lastBytes = transfer.received;
            lastProgressAt = Date.now();
          } else if (Date.now() - lastProgressAt > stallMs) {
            finish(new Error('La source ne transmet plus de données'));
          }
        }
      };

      const timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
      // Transfer events arrive at most every 250 ms; the ticker only covers
      // cancellation and stalls when no event comes at all.
      const ticker = setInterval(check, 1000);
      const unsubscribe = instance?.events.on('transfer', snapshot => {
        if (snapshot.id === transferId) {
          check();
        }
      });

      check();
    });
  }

  /** Tries one source: connect, get accepted, receive the buffer target. */
  async function attemptSource(hit: SearchHit, sequence: number, attempt: number, fallback: CurrentPlayback['fallback']): Promise<void> {
    if (!service) {
      throw new Error('Non connecté');
    }

    const bufferTarget = bufferTargetFor(hit.size, get().settings.bufferMb);
    const prepared = service.prepareStream(hit);
    const id = prepared.transferId;

    set({
      current: {
        hit,
        transferId: id,
        url: prepared.url,
        phase: 'preparing',
        error: null,
        bufferTarget,
        attempt,
        fallback,
        warning: null,
        source: 'network',
      },
    });

    await waitForTransfer(
      id,
      sequence,
      t => t.state !== 'requesting',
      playbackTimeouts.reachPeerMs,
      `Impossible de joindre ${hit.username}`,
    );

    await waitForTransfer(
      id,
      sequence,
      t => t.state === 'awaiting-file' || t.state === 'streaming' || t.state === 'complete',
      hit.slotFree ? playbackTimeouts.acceptFreeSlotMs : playbackTimeouts.acceptNoSlotMs,
      `${hit.username} vous a mis en file d'attente`,
    );

    await waitForTransfer(
      id,
      sequence,
      t => t.state === 'streaming' || t.state === 'complete',
      playbackTimeouts.openFileMs,
      `${hit.username} n'a pas ouvert le transfert`,
    );

    await waitForTransfer(
      id,
      sequence,
      t =>
        t.state === 'complete' ||
        t.buffer.total >= Math.min(bufferTarget, t.expectedSize),
      playbackTimeouts.bufferTotalMs,
      'Source trop lente',
      playbackTimeouts.stallMs,
    );

    if (sequence !== playSequence) {
      throw new PlaybackCancelled();
    }

    await TrackPlayer.add({
      id,
      url: prepared.url,
      title: displayTitle(hit.filename),
      artist: displayArtist(hit) ?? hit.username,
      album: hit.username,
      duration: hit.durationSec,
      contentType: contentTypeFor(hit.filename),
    });

    await TrackPlayer.play();
  }

  /**
   * The next source to try for the same track: same title, not tried yet,
   * not a peer that refused us. Read lazily, so results that arrived during
   * the previous attempt are considered.
   */
  function nextCandidate(original: SearchHit, tried: Set<string>): SearchHit | null {
    const title = normalizeForMatch(displayTitle(original.filename));

    for (const { hit } of get().results) {
      if (tried.has(hitKey(hit)) || deniedPeers.has(hit.username.toLowerCase())) {
        continue;
      }

      if (similarity(title, displayTitle(hit.filename)) >= 0.85) {
        return hit;
      }
    }

    return null;
  }

  /** Plays a track already on the device. No network involved. */
  async function playCached(entry: CacheEntry): Promise<void> {
    const sequence = ++playSequence;
    const cache = trackCache!;
    const hit = cache.asHit(entry);
    const url = cache.uriFor(entry);

    await ensurePlayer();
    set({ playerReady: true });
    await resetPlayer();
    service?.cancelActive();

    if (sequence !== playSequence) {
      return;
    }

    set({
      current: {
        hit,
        transferId: '',
        url,
        phase: 'playing',
        error: null,
        bufferTarget: 0,
        attempt: 1,
        fallback: null,
        warning: null,
        source: 'cache',
      },
    });

    cache.markPlayed(entry);
    await TrackPlayer.add({
      id: `cache:${entry.file}`,
      url,
      title: displayTitle(hit.filename),
      artist: displayArtist(hit) ?? 'SoulStream',
      duration: hit.durationSec,
      contentType: contentTypeFor(hit.filename),
    });
    await TrackPlayer.play();
  }

  async function playWithFallback(first: SearchHit): Promise<void> {
    const sequence = ++playSequence;
    const tried = new Set<string>();
    let hit: SearchHit | null = first;
    let fallback: CurrentPlayback['fallback'] = null;
    let lastError = 'Lecture impossible';

    await ensurePlayer();
    set({ playerReady: true });
    void requestNotificationPermission();

    for (let attempt = 1; hit && attempt <= MAX_ATTEMPTS; attempt++) {
      tried.add(hitKey(hit));

      try {
        // Stop the previous track before releasing its local HTTP source.
        await resetPlayer();

        if (sequence !== playSequence) {
          return;
        }

        await attemptSource(hit, sequence, attempt, fallback);

        if (sequence === playSequence) {
          set(state => ({
            current: state.current ? { ...state.current, phase: 'playing' } : null,
          }));
        }

        return;
      } catch (error) {
        if (error instanceof PlaybackCancelled || sequence !== playSequence) {
          return;
        }

        lastError = errorMessage(error);

        if (DENIED_PATTERN.test(lastError)) {
          deniedPeers.set(hit.username.toLowerCase(), lastError);
        }

        service?.cancelActive();
        fallback = { username: hit.username, reason: lastError };
        hit = nextCandidate(first, tried);
      }
    }

    if (sequence !== playSequence) {
      return;
    }

    set(state => ({
      current: state.current
        ? {
            ...state.current,
            phase: 'error',
            error:
              tried.size > 1
                ? `${lastError} (${tried.size} sources essayées)`
                : lastError,
          }
        : null,
    }));
  }

  return {
    ready: false,
    playerReady: false,
    settings: {
      serverHost: 'server.slsknet.org',
      serverPort: 2242,
      listenPort: 22345,
      streamPort: 0,
      bufferMb: 2,
      shareEnabled: true,
      shareWifiOnly: true,
      cacheMb: 1024,
    },

    username: null,
    prefillUsername: '',
    connection: 'idle',
    connectionError: null,
    listenPort: 0,
    httpPort: 0,

    tab: 'search',
    query: '',
    searching: false,
    searchQuery: '',
    searchEmpty: false,
    searchError: null,
    matchHit: null,
    results: [],

    transfers: {},
    current: null,
    notice: null,

    init: async () => {
      if (initStarted) {
        return;
      }

      initStarted = true;

      try {
        const settings = await loadSettings();
        set({ settings });

        try {
          trackCache = new TrackCache(createBlobUtilFs(), settings.cacheMb * 1024 * 1024);
          await trackCache.load();
        } catch (error) {
          trackCache = null;
          if (__DEV__) {
            console.log('[cache] unavailable', errorMessage(error));
          }
        }

        try {
          await ensurePlayer();
          set({ playerReady: true });
        } catch (error) {
          if (__DEV__) {
            console.log('[player] unavailable', errorMessage(error));
          }
        }

        const credentials = await loadCredentials();

        if (credentials) {
          set({ prefillUsername: credentials.username });
          await get().login(credentials.username, credentials.password);
        }
      } finally {
        set({ ready: true });
      }
    },

    login: async (username, password, keepSessionOnFailure = false) => {
      const settings = get().settings;
      const previousUsername = get().username;

      searchSequence++;
      playSequence++;
      deniedPeers.clear();
      await resetPlayer();

      if (service) {
        await service.stop();
        service = null;
      }

      const instance = new StreamingService(settings, trackCache);
      service = instance;
      wire(instance);

      set({
        username: keepSessionOnFailure ? previousUsername : null,
        prefillUsername: username,
        connection: 'connecting',
        connectionError: null,
        searching: false,
        searchQuery: '',
        searchEmpty: false,
        searchError: null,
        matchHit: null,
        results: [],
        transfers: {},
        current: null,
        listenPort: 0,
        httpPort: 0,
      });

      try {
        await instance.start(username, password);
        await saveCredentials({ username, password });
        set({
          username,
          connection: 'online',
          listenPort: instance.listenPort,
          httpPort: instance.httpPort,
          tab: keepSessionOnFailure ? get().tab : 'search',
        });
        return true;
      } catch (error) {
        await instance.stop();

        if (service === instance) {
          service = null;
        }

        set({
          username: keepSessionOnFailure ? previousUsername : null,
          connection: 'error',
          connectionError: errorMessage(error),
        });

        return false;
      }
    },

    logout: async () => {
      playSequence++;
      searchSequence++;
      await resetPlayer();

      if (service) {
        await service.stop();
        service = null;
      }

      await clearCredentials();

      set({
        username: null,
        prefillUsername: '',
        connection: 'idle',
        connectionError: null,
        listenPort: 0,
        httpPort: 0,
        tab: 'search',
        query: '',
        searching: false,
        searchQuery: '',
        searchEmpty: false,
        searchError: null,
        matchHit: null,
        results: [],
        transfers: {},
        current: null,
        notice: null,
      });
    },

    reconnect: async () => {
      if (get().connection === 'connecting' || get().connection === 'online') {
        return;
      }

      // The client is already retrying: skip its backoff instead of tearing
      // everything down (that would stop the current track).
      if (service && get().connection === 'reconnecting') {
        service.reconnectNow();
        return;
      }

      const credentials: Credentials | null = await loadCredentials();

      if (credentials) {
        await get().login(credentials.username, credentials.password);
      }
    },

    applySettings: async (settings: Settings) => {
      await saveSettings(settings);
      set({ settings });
      trackCache?.setLimit(settings.cacheMb * 1024 * 1024);

      const currentUsername = get().username;

      if (!currentUsername) {
        return;
      }

      const credentials: Credentials | null = await loadCredentials();
      const username = credentials?.username ?? currentUsername;
      const password = credentials?.password;

      if (!password) {
        return;
      }

      const ok = await get().login(username, password, true);

      if (ok) {
        set({ tab: 'settings' });
      }
    },

    setTab: tab => set({ tab }),

    setQuery: query => set({ query, searchEmpty: false, searchError: null }),

    runSearch: async (input?: string) => {
      const rawQuery = (input ?? get().query).trim();

      if (!rawQuery) {
        return;
      }

      const searchService = service;

      if (!searchService || get().connection !== 'online') {
        set({ searchError: 'Non connecté au réseau Soulseek' });
        return;
      }

      if (get().searching && get().searchQuery === formatSearchQuery(rawQuery)) {
        return;
      }

      const networkQuery = formatSearchQuery(rawQuery);
      const sequence = ++searchSequence;

      // Already on the device: play it at once, no search needed.
      const cached = trackCache?.findByQuery(networkQuery);

      if (cached && trackCache) {
        searchService.cancelSearch();
        set({
          query: rawQuery,
          searching: false,
          searchQuery: networkQuery,
          searchEmpty: false,
          searchError: null,
          matchHit: trackCache.asHit(cached),
          results: [],
        });
        await playCached(cached).catch(error => set({ searchError: errorMessage(error) }));
        return;
      }

      const collected: SearchHit[] = [];
      let matched = false;
      let windowTimer: ReturnType<typeof setTimeout> | null = null;
      let closeTimer: ReturnType<typeof setTimeout> | null = null;
      let rankTimer: ReturnType<typeof setTimeout> | null = null;

      set({
        query: rawQuery,
        searching: true,
        searchQuery: networkQuery,
        searchEmpty: false,
        searchError: null,
        matchHit: null,
        results: [],
      });

      const publishResults = () => {
        rankTimer = null;

        if (sequence === searchSequence) {
          set({ results: rankHits(networkQuery, collected, LIST_SCORE) });
        }
      };

      const choose = () => {
        windowTimer = null;

        if (sequence !== searchSequence) {
          return;
        }

        if (rankTimer) {
          clearTimeout(rankTimer);
        }

        publishResults();
        const best = rankHits(networkQuery, collected, AUTO_MATCH_SCORE).find(
          ranked => !deniedPeers.has(ranked.hit.username.toLowerCase()),
        );

        if (!best) {
          return;
        }

        matched = true;
        // `searching` ends at the match; results keep filling in the
        // background for fallback and the sources list.
        set({ searching: false, searchEmpty: false, matchHit: best.hit });
        void get().playHit(best.hit);

        // Keep listening a little longer so other sources are available for
        // fallback and manual choice, then stop: late responses cost CPU.
        closeTimer = setTimeout(() => {
          if (sequence === searchSequence) {
            searchService.cancelSearch();
          }
        }, RESULTS_AFTER_MATCH_MS);
      };

      try {
        await searchService.search(
          networkQuery,
          batch => {
            if (sequence !== searchSequence) {
              return;
            }

            collected.push(...batch);

            if (!rankTimer) {
              rankTimer = setTimeout(publishResults, 400);
            }

            // Wait a moment after the first good match: the best source is
            // often a few hundred milliseconds behind the first one.
            if (!matched && !windowTimer && pickBestMatch(networkQuery, batch, AUTO_MATCH_SCORE)) {
              windowTimer = setTimeout(choose, MATCH_WINDOW_MS);
            }
          },
          SEARCH_DURATION_MS,
        );

        if (sequence !== searchSequence) {
          return;
        }

        if (windowTimer) {
          // The search ended inside the window: decide now.
          clearTimeout(windowTimer);
          choose();
        }

        if (rankTimer) {
          clearTimeout(rankTimer);
        }

        publishResults();
        set({ searching: false, searchEmpty: !matched && get().results.length === 0 });
      } catch (error) {
        if (sequence === searchSequence) {
          set({ searching: false, searchError: errorMessage(error) });
        }
      } finally {
        if (sequence !== searchSequence) {
          // A newer search replaced this one.
          if (windowTimer) {
            clearTimeout(windowTimer);
          }

          if (closeTimer) {
            clearTimeout(closeTimer);
          }
        }
      }
    },

    cancelSearch: () => {
      searchSequence++;
      service?.cancelSearch();
      set({ searching: false, searchEmpty: false });
    },

    playHit: async hit => {
      if (!service) {
        return;
      }

      if (!isStreamableFile(hit.filename)) {
        set({ notice: 'Seuls les fichiers MP3 sont proposés par SoulStream.' });
        return;
      }

      const cached = trackCache?.findByHit(hit);

      try {
        if (cached) {
          await playCached(cached);
        } else {
          await playWithFallback(hit);
        }
      } catch (error) {
        set(state => ({
          current: state.current
            ? { ...state.current, phase: 'error', error: errorMessage(error) }
            : null,
          searchError: state.current ? state.searchError : errorMessage(error),
        }));
      }
    },

    playNextSource: async () => {
      const current = get().current;

      if (!current) {
        return;
      }

      const next = nextCandidate(current.hit, new Set([hitKey(current.hit)]));

      if (!next) {
        set({ notice: 'Aucune autre source pour ce morceau.' });
        return;
      }

      await get().playHit(next);
    },

    retryPlayback: async () => {
      const current = get().current;

      if (current) {
        await get().playHit(current.hit);
      }
    },

    stopPlayback: async () => {
      playSequence++;
      await resetPlayer();
      service?.cancelActive();
      set({ current: null, matchHit: null });
    },

    dismissNotice: () => set({ notice: null }),

    cacheStats: () =>
      trackCache ? { count: trackCache.count, bytes: trackCache.totalBytes } : null,

    clearCache: async () => {
      await trackCache?.clear();
    },
  };
});
