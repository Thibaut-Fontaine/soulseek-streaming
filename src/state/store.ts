import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';
import TrackPlayer, { Event } from 'react-native-track-player';
import { create } from 'zustand';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';

import { id3TagSize, parseId3 } from '../core/id3';
import type { ConnectionState } from '../core/soulseekClient';
import type { TransferSnapshot } from '../core/transfer';
import {
  formatSearchQuery,
  normalizeForMatch,
  rankHits,
  similarity,
} from '../core/search';
import type { RankedHit } from '../core/search';
import type {
  AlbumPageData,
  ArtistPageData,
  BrowseData,
  CatalogPlayContext,
  CatalogSearchResult,
  CatalogTrack,
  GenrePageData,
  Loadable,
  Page,
  Resolution,
  TrackGroup,
} from '../core/catalogTypes';
import { displayArtist, displayTitle, hitKey, isStreamableFile } from '../core/types';
import type { SearchHit, TrackMeta } from '../core/types';
import type { StreamTransfer } from '../core/transfer';
import { ensurePlayer, resetPlayer } from '../player/player';
import { clearCredentials, loadCredentials, loadSettings, saveCredentials, saveSettings } from '../services/settings';
import type { Credentials, Settings } from '../services/settings';
import { StreamingService } from '../services/streaming';
import { debugLog } from '../services/debugLog';
import {
  EMPTY_LIBRARY,
  addRecentSearch,
  addToHistory,
  loadLibrary,
  removeRecentSearch,
  saveLibrary,
  savedTrack,
  toggleLike,
} from '../services/library';
import type { Library } from '../services/library';
import type { LogTag } from '../services/debugLog';
import { createBlobUtilFs } from '../services/blobUtilFs';
import { TrackCache } from '../services/trackCache';
import type { CacheEntry } from '../services/trackCache';
import { contentTypeFor } from '../stream/httpServer';

export type Tab = 'home' | 'search' | 'library' | 'settings';

/** What "next" and "previous" walk through: the list a track was played from. */
export interface PlayContext {
  /** Shown as "Lecture depuis …" in the player. */
  label: string;
  items: SearchHit[];
  index: number;
}

/** Bottom sheets shown above everything, the player included. */
export type Sheet =
  | { kind: 'actions'; hit: SearchHit; context?: PlayContext }
  | { kind: 'sources'; hits: SearchHit[]; title: string; context?: PlayContext }
  | { kind: 'queue' };

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
  /** The full-screen player, opened from the bottom bar. */
  playerOpen: boolean;
  sheet: Sheet | null;
  query: string;
  searching: boolean;
  searchQuery: string;
  searchEmpty: boolean;
  searchError: string | null;
  /** Ranked sources for the last search, best first. Includes weaker matches. */
  results: RankedHit[];
  /** Tracks already on the device that match the last search. */
  deviceResults: SearchHit[];

  /** Liked tracks, history and recent searches, saved on the device. */
  library: Library;
  /** Every track on the device (downloads and added files), newest first. */
  device: SearchHit[];
  /** Tags and covers read from MP3s, by `hitKey`. */
  meta: Record<string, TrackMeta>;
  /** Tracks the user queued; played before the rest of the context. */
  queue: SearchHit[];
  context: PlayContext | null;
  shuffle: boolean;
  /** Repeat the current track. */
  repeat: boolean;

  transfers: Record<string, TransferSnapshot>;
  current: CurrentPlayback | null;
  notice: string | null;

  // ---- Online catalog (see src/core/catalog.ts) ----
  /** Catalog answer for the last search; null when off, offline or not run. */
  catalogResults: CatalogSearchResult | null;
  /**
   * The last search as unified cards: one per catalog track with its Soulseek
   * sources, then groups of files no catalog track matched. Best first.
   */
  groups: TrackGroup[];
  /** Artist/album/genre pages pushed above the current tab, last on top. */
  pages: Page[];
  artistPages: Record<string, Loadable<ArtistPageData>>;
  albumPages: Record<string, Loadable<AlbumPageData>>;
  genrePages: Record<string, Loadable<GenrePageData>>;
  browse: Loadable<BrowseData> | null;
  /** Soulseek sources found for catalog tracks, by `CatalogTrack.id`. */
  resolutions: Record<string, Resolution>;
  /** Catalog track of each Soulseek file we matched, by `hitKey`. */
  hitTracks: Record<string, CatalogTrack>;

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

  /** Plays a track the user picked, from a list that "next" will follow. */
  playTrack: (hit: SearchHit, context?: PlayContext) => Promise<void>;
  playNext: () => Promise<void>;
  /** Restarts the track, or goes back when it has just started. */
  playPrevious: (positionSec: number) => Promise<void>;
  enqueue: (hit: SearchHit, first?: boolean) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  removeFromQueue: (index: number) => void;
  toggleLike: (hit: SearchHit) => void;
  forgetSearch: (query: string) => void;
  /** Reads the tag of a track on the device, for its cover and title. */
  loadMeta: (hit: SearchHit) => void;
  openPlayer: () => void;
  closePlayer: () => void;
  openSheet: (sheet: Sheet) => void;
  closeSheet: () => void;
  /** Tracks on the device (shared with others when sharing is on). */
  cacheStats: () => {
    count: number;
    bytes: number;
    importedCount: number;
    importedBytes: number;
  } | null;
  /** Deletes downloaded tracks, or the tracks added from the phone. */
  clearCache: (imported?: boolean) => Promise<void>;
  /**
   * Opens the system file picker and adds the chosen MP3s to the shared
   * folder. Resolves with a summary for the user, or null if cancelled.
   */
  importTracks: () => Promise<string | null>;

  /** Pushes an artist/album/genre page and loads its data. */
  openPage: (page: Page) => void;
  /** Pops the top page. Returns false when there was none. */
  closePage: () => boolean;
  /** Pops every page (e.g. when switching tabs). */
  closeAllPages: () => void;
  loadArtistPage: (id: string, force?: boolean) => Promise<void>;
  loadAlbumPage: (id: string, force?: boolean) => Promise<void>;
  loadGenrePage: (id: string, force?: boolean) => Promise<void>;
  loadBrowse: (force?: boolean) => Promise<void>;
  /**
   * Plays a catalog track: finds Soulseek sources (or uses a cached copy) and
   * starts the best one. `context` makes next/previous walk the list, each
   * track being resolved when it is reached.
   */
  playCatalogTrack: (track: CatalogTrack, context?: CatalogPlayContext) => Promise<void>;
  /** Looks for Soulseek sources of a catalog track without playing it. */
  resolveTrack: (track: CatalogTrack) => Promise<Resolution>;
  /** Adds a catalog track to the queue (resolved when reached). */
  enqueueCatalogTrack: (track: CatalogTrack, first?: boolean) => void;
  /** Catalog track for a Soulseek file, when one was matched. */
  trackForHit: (hit: SearchHit) => CatalogTrack | null;
}

let service: StreamingService | null = null;
/** Tracks already played; also our shared folder. Created on init. */
let trackCache: TrackCache | null = null;
let initStarted = false;
let searchSequence = 0;
let playSequence = 0;
/** When the user last started a track; see the queue-ended listener. */
let lastPlayStartedAt = 0;

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
const SEARCH_DURATION_MS = 10000;
/** Weaker matches are still listed; the user picks what to play. */
const LIST_SCORE = 0.55;
/** Stop listening for results once this many sources came in. */
const ENOUGH_RESULTS = 300;
/** A tag bigger than this is not waited for (it would delay nothing, but costs memory). */
const MAX_STREAM_TAG_BYTES = 4 * 1024 * 1024;
/** "Previous" restarts the track after this many seconds of playback. */
const RESTART_THRESHOLD_SEC = 3;

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
  const metaLoading = new Set<string>();

  function updateLibrary(change: (library: Library) => Library): void {
    const library = change(get().library);
    set({ library });
    void saveLibrary(library);
  }

  function setMeta(key: string, meta: TrackMeta): void {
    set(state => ({ meta: { ...state.meta, [key]: meta } }));
  }

  function refreshDevice(): void {
    const cache = trackCache;
    set({ device: cache ? cache.all().map(entry => cache.asHit(entry)) : [] });
  }

  /**
   * Reads the ID3 tag from the first bytes of a stream: the cover appears as
   * soon as the tag has arrived, usually before playback starts.
   */
  async function readStreamMeta(transferId: string, hit: SearchHit): Promise<void> {
    const key = hitKey(hit);
    const buffer = service?.getTransfer(transferId)?.buffer;

    if (!buffer || get().meta[key]) {
      return;
    }

    try {
      await buffer.waitFor(9, 30000);
      const size = id3TagSize(buffer.read(0, 10));

      if (size === 0 || size > MAX_STREAM_TAG_BYTES) {
        setMeta(key, { coverUri: null });
        return;
      }

      if (buffer.total < size) {
        await buffer.waitFor(size - 1, 120000);
      }

      const tags = parseId3(buffer.read(0, size));
      setMeta(key, {
        title: tags?.title,
        artist: tags?.artist,
        album: tags?.album,
        coverUri: tags?.picture
          ? `data:${tags.picture.mime};base64,${Buffer.from(tags.picture.data).toString('base64')}`
          : null,
      });
    } catch {
      // The transfer ended or failed first: no cover for this one.
    }
  }

  /** Marks the current track as played, once it really started. */
  function recordPlay(hit: SearchHit): void {
    const meta = get().meta[hitKey(hit)];
    updateLibrary(library => addToHistory(library, savedTrack(hit, meta)));
  }

  function wire(instance: StreamingService): void {
    instance.events.on('state', payload => {
      debugLog('net', `connexion : ${payload.state}${payload.error ? ` (${payload.error})` : ''}`);
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
      // Client messages start with "[peer] ", "[transfer] "… when they belong
      // to a step of fetching a track.
      const match = /^\[(peer|transfer|http)\] /.exec(message);
      debugLog(
        (match ? match[1] : 'net') as LogTag,
        match ? message.slice(match[0].length) : message,
      );
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
    const startedAt = Date.now();
    const step = (name: string) =>
      debugLog('play', `${name} après ${Date.now() - startedAt} ms`);

    debugLog(
      'play',
      `source ${attempt} : ${hit.username} — ${hit.filename} (${hit.size} o, ${hit.bitrate ?? '?'} kbps, ` +
        `slot ${hit.slotFree ? 'libre' : 'occupé'}, file ${hit.queueLength}) ; tampon visé ${bufferTarget} o ; URL ${prepared.url}`,
    );

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
    step('pair joint, QueueUpload envoyé');

    await waitForTransfer(
      id,
      sequence,
      t => t.state === 'awaiting-file' || t.state === 'streaming' || t.state === 'complete',
      hit.slotFree ? playbackTimeouts.acceptFreeSlotMs : playbackTimeouts.acceptNoSlotMs,
      `${hit.username} vous a mis en file d'attente`,
    );
    step('transfert accepté');

    await waitForTransfer(
      id,
      sequence,
      t => t.state === 'streaming' || t.state === 'complete',
      playbackTimeouts.openFileMs,
      `${hit.username} n'a pas ouvert le transfert`,
    );
    step('connexion F ouverte, octets en route');
    void readStreamMeta(id, hit);

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
    step(`tampon atteint (${service.getTransfer(id)?.buffer.total ?? '?'} o)`);

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
    step('piste ajoutée au lecteur');

    await TrackPlayer.play();
    step('lecture demandée');
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

  /**
   * Native player events. Without this, a stream the player cannot read
   * looks like "playing" forever with no sound and no message.
   */
  let watchingPlayer = false;

  function watchPlayer(): void {
    if (watchingPlayer) {
      return;
    }

    watchingPlayer = true;

    TrackPlayer.addEventListener(Event.PlaybackState, event => {
      const extra = 'error' in event && event.error ? ` : ${event.error.code} ${event.error.message}` : '';
      debugLog('player', `état ${event.state}${extra}`);
    });

    TrackPlayer.addEventListener(Event.PlaybackError, event => {
      debugLog('player', `erreur ${event.code} : ${event.message}`);

      set(state => {
        if (!state.current || state.current.phase === 'error') {
          return {};
        }

        return {
          current: {
            ...state.current,
            phase: 'error',
            error: `Le lecteur n’a pas pu lire le flux (${event.code} : ${event.message})`,
          },
        };
      });
    });

    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, event => {
      debugLog('player', `piste active : ${event.track?.url ?? 'aucune'}`);
    });

    // One track at a time in the native player: at its end, play what's next.
    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, event => {
      // Ignore the end of a track we are replacing anyway.
      if (get().current?.phase !== 'playing' || Date.now() - lastPlayStartedAt < 3000 || !(event.position > 0)) {
        return;
      }

      if (get().repeat) {
        void TrackPlayer.seekTo(0)
          .then(() => TrackPlayer.play())
          .catch(() => {});
        return;
      }

      void get().playNext();
    });
  }

  /** Plays a track already on the device. No network involved. */
  /**
   * `original` is the search result or saved track that led here: it keeps
   * the peer's exact name, needed to download the file again if the copy on
   * the device is ever removed.
   */
  async function playCached(entry: CacheEntry, original?: SearchHit): Promise<void> {
    const sequence = ++playSequence;
    const cache = trackCache!;
    const hit = original ?? cache.asHit(entry);
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
    get().loadMeta(hit);
    recordPlay(hit);
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
          recordPlay(hit);
        }

        return;
      } catch (error) {
        if (error instanceof PlaybackCancelled || sequence !== playSequence) {
          return;
        }

        lastError = errorMessage(error);
        debugLog('play', `source ${attempt} (${hit.username}) abandonnée : ${lastError}`);

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

    debugLog('play', `échec après ${tried.size} source(s) : ${lastError}`);
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

    tab: 'home',
    playerOpen: false,
    sheet: null,
    query: '',
    searching: false,
    searchQuery: '',
    searchEmpty: false,
    searchError: null,
    results: [],
    deviceResults: [],

    library: { ...EMPTY_LIBRARY },
    device: [],
    meta: {},
    queue: [],
    context: null,
    shuffle: false,
    repeat: false,

    transfers: {},
    current: null,
    catalogResults: null,
    groups: [],
    pages: [],
    artistPages: {},
    albumPages: {},
    genrePages: {},
    browse: null,
    resolutions: {},
    hitTracks: {},
    notice: null,

    init: async () => {
      if (initStarted) {
        return;
      }

      initStarted = true;

      try {
        const settings = await loadSettings();
        set({ settings, library: await loadLibrary() });

        try {
          trackCache = new TrackCache(createBlobUtilFs(), settings.cacheMb * 1024 * 1024);
          await trackCache.load();
          trackCache.onChange(refreshDevice);
          refreshDevice();
        } catch (error) {
          trackCache = null;
          debugLog('app', `cache indisponible : ${errorMessage(error)}`);
        }

        try {
          await ensurePlayer();
          set({ playerReady: true });
          watchPlayer();
        } catch (error) {
          debugLog('player', `lecteur indisponible : ${errorMessage(error)}`);
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
        results: [],
        deviceResults: [],
        transfers: {},
        current: null,
        queue: [],
        context: null,
        playerOpen: false,
        sheet: null,
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
          tab: keepSessionOnFailure ? get().tab : 'home',
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
        tab: 'home',
        playerOpen: false,
        sheet: null,
        query: '',
        searching: false,
        searchQuery: '',
        searchEmpty: false,
        searchError: null,
        results: [],
        deviceResults: [],
        transfers: {},
        current: null,
        queue: [],
        context: null,
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
      const previous = get().settings;
      await saveSettings(settings);
      set({ settings });
      trackCache?.setLimit(settings.cacheMb * 1024 * 1024);

      // Only server and port changes need a new connection; the rest applies
      // live, without stopping the music.
      const networkChanged =
        settings.serverHost !== previous.serverHost ||
        settings.serverPort !== previous.serverPort ||
        settings.listenPort !== previous.listenPort ||
        settings.streamPort !== previous.streamPort;

      if (!networkChanged) {
        service?.updateSettings(settings);
        return;
      }

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

      const networkQuery = formatSearchQuery(rawQuery);
      const cache = trackCache;
      const deviceResults = cache
        ? cache.search(networkQuery, LIST_SCORE).map(entry => cache.asHit(entry))
        : [];

      updateLibrary(library => addRecentSearch(library, rawQuery));

      const searchService = service;

      if (!searchService || get().connection !== 'online') {
        set({
          query: rawQuery,
          searchQuery: networkQuery,
          deviceResults,
          results: [],
          searchError: deviceResults.length > 0 ? null : 'Non connecté au réseau Soulseek',
        });
        return;
      }

      if (get().searching && get().searchQuery === networkQuery) {
        return;
      }

      const sequence = ++searchSequence;
      const collected: SearchHit[] = [];
      let rankTimer: ReturnType<typeof setTimeout> | null = null;

      debugLog('play', `recherche « ${networkQuery} » (saisie : « ${rawQuery} »)`);

      set({
        query: rawQuery,
        searching: true,
        searchQuery: networkQuery,
        searchEmpty: false,
        searchError: null,
        results: [],
        deviceResults,
      });

      // Nothing plays until the user picks a result: the list fills in as
      // peers answer, ranked by match then availability.
      const publishResults = () => {
        rankTimer = null;

        if (sequence === searchSequence) {
          set({ results: rankHits(networkQuery, collected, LIST_SCORE) });
        }
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

            if (collected.length >= ENOUGH_RESULTS) {
              searchService.cancelSearch();
            }
          },
          SEARCH_DURATION_MS,
        );

        if (sequence !== searchSequence) {
          return;
        }

        if (rankTimer) {
          clearTimeout(rankTimer);
        }

        publishResults();
        const top = rankHits(networkQuery, collected, 0).slice(0, 5);
        debugLog(
          'play',
          top.length > 0
            ? `meilleurs candidats : ${top.map(r => `${r.score.toFixed(2)} ${r.hit.filename}`).join(' | ')}`
            : 'aucun MP3 reçu des pairs',
        );
        debugLog('play', `recherche terminée : ${collected.length} MP3 reçus, ${get().results.length} retenus`);
        set({
          searching: false,
          searchEmpty: get().results.length === 0 && deviceResults.length === 0,
        });
      } catch (error) {
        debugLog('play', `recherche en erreur : ${errorMessage(error)}`);
        if (sequence === searchSequence) {
          set({ searching: false, searchError: errorMessage(error) });
        }
      } finally {
        if (rankTimer && sequence !== searchSequence) {
          clearTimeout(rankTimer);
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
        lastPlayStartedAt = Date.now();

        if (cached) {
          await playCached(cached, hit);
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
      set({ current: null, playerOpen: false });
    },

    dismissNotice: () => set({ notice: null }),

    playTrack: async (hit, context) => {
      set({ context: context ?? null });
      await get().playHit(hit);
    },

    playNext: async () => {
      const { queue, context } = get();

      if (queue.length > 0) {
        const [next, ...rest] = queue;
        set({ queue: rest });
        await get().playHit(next);
        return;
      }

      if (context && get().shuffle && context.items.length > 1) {
        let index = Math.floor(Math.random() * (context.items.length - 1));
        if (index >= context.index) {
          index++;
        }
        set({ context: { ...context, index } });
        await get().playHit(context.items[index]);
        return;
      }

      if (context && context.index + 1 < context.items.length) {
        const index = context.index + 1;
        set({ context: { ...context, index } });
        await get().playHit(context.items[index]);
        return;
      }

      set({ notice: 'Fin de la liste de lecture.' });
    },

    playPrevious: async positionSec => {
      const { context, current } = get();

      if (current && (positionSec > RESTART_THRESHOLD_SEC || !context || context.index === 0)) {
        try {
          await TrackPlayer.seekTo(0);
        } catch {
          // The player reports failures through its state.
        }
        return;
      }

      if (context && context.index > 0) {
        const index = context.index - 1;
        set({ context: { ...context, index } });
        await get().playHit(context.items[index]);
      }
    },

    enqueue: (hit, first = false) =>
      set(state => ({
        queue: first ? [hit, ...state.queue] : [...state.queue, hit],
        notice: first ? 'Sera lu ensuite.' : 'Ajouté à la file d’attente.',
      })),

    toggleShuffle: () => set(state => ({ shuffle: !state.shuffle })),
    toggleRepeat: () => set(state => ({ repeat: !state.repeat })),

    removeFromQueue: index =>
      set(state => ({ queue: state.queue.filter((_, i) => i !== index) })),

    toggleLike: hit => {
      const meta = get().meta[hitKey(hit)];
      updateLibrary(library => toggleLike(library, savedTrack(hit, meta)));
    },

    forgetSearch: query => updateLibrary(library => removeRecentSearch(library, query)),

    loadMeta: hit => {
      const key = hitKey(hit);
      const cache = trackCache;

      if (!cache || get().meta[key] || metaLoading.has(key)) {
        return;
      }

      const entry = cache.findByHit(hit);

      if (!entry) {
        return;
      }

      metaLoading.add(key);
      cache
        .readMeta(entry)
        .then(meta => setMeta(key, meta))
        .catch(() => setMeta(key, { coverUri: null }))
        .finally(() => metaLoading.delete(key));
    },

    openPlayer: () => set({ playerOpen: true }),
    closePlayer: () => set({ playerOpen: false }),
    openSheet: sheet => set({ sheet }),
    closeSheet: () => set({ sheet: null }),

    cacheStats: () =>
      trackCache
        ? {
            count: trackCache.count,
            bytes: trackCache.totalBytes,
            importedCount: trackCache.importedCount,
            importedBytes: trackCache.importedBytes,
          }
        : null,

    clearCache: async (imported = false) => {
      await trackCache?.clear(imported);
      service?.updateSettings(get().settings);
    },

    // ---- Catalog: navigation is final; loaders are stubs until catalog.ts lands.
    openPage: (page: Page) => {
      set(state => ({ pages: [...state.pages, page], playerOpen: false, sheet: null }));
    },
    closePage: () => {
      if (get().pages.length === 0) {
        return false;
      }
      set(state => ({ pages: state.pages.slice(0, -1) }));
      return true;
    },
    closeAllPages: () => set({ pages: [] }),
    loadArtistPage: async () => {},
    loadAlbumPage: async () => {},
    loadGenrePage: async () => {},
    loadBrowse: async () => {},
    playCatalogTrack: async () => {},
    resolveTrack: async () => ({ status: 'none', sources: [] }),
    enqueueCatalogTrack: () => {},
    trackForHit: hit => get().hitTracks[hitKey(hit)] ?? null,

    importTracks: async () => {
      const cache = trackCache;

      if (!cache) {
        throw new Error('Le stockage de l’appareil est indisponible');
      }

      let picked;

      try {
        picked = await pick({ type: [types.audio], allowMultiSelection: true });
      } catch (error) {
        if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
          return null;
        }

        throw error;
      }

      const files = picked.filter(file => file.uri);

      if (files.length === 0) {
        return null;
      }

      debugLog('app', `ajout de ${files.length} fichier(s) au partage`);

      const copies = await keepLocalCopy({
        files: files.map(file => ({
          uri: file.uri,
          fileName: file.name ?? 'track.mp3',
        })) as [{ uri: string; fileName: string }],
        destination: 'cachesDirectory',
      });

      let added = 0;
      let duplicates = 0;
      const skipped: string[] = [];

      for (const [index, copy] of copies.entries()) {
        const file = files[index];
        const name = file?.name ?? 'track.mp3';

        if (copy.status !== 'success') {
          skipped.push(`${name} (copie impossible)`);
          debugLog('app', `copie impossible de ${name} : ${copy.copyError}`);
          continue;
        }

        const localPath = decodeURIComponent(copy.localUri.replace(/^file:\/\//, ''));

        try {
          const result = await cache.importFile(localPath, name, file?.size ?? 0);

          if (result.status === 'added') {
            added++;
          } else if (result.status === 'duplicate') {
            duplicates++;
          } else {
            skipped.push(`${name} (${result.reason})`);
          }

          debugLog('app', `${name} : ${result.status === 'skipped' ? result.reason : result.status}`);
        } catch (error) {
          skipped.push(`${name} (${errorMessage(error)})`);
          debugLog('app', `ajout impossible de ${name} : ${errorMessage(error)}`);
        }
      }

      refreshDevice();
      // Announce the new file count to the server and to peers browsing us.
      service?.updateSettings(get().settings);

      const parts = [
        added > 0 ? `${added} morceau${added > 1 ? 'x' : ''} ajouté${added > 1 ? 's' : ''} au partage` : null,
        duplicates > 0 ? `${duplicates} déjà présent${duplicates > 1 ? 's' : ''}` : null,
        skipped.length > 0 ? `ignorés : ${skipped.join(', ')}` : null,
      ].filter(Boolean);

      return parts.length > 0 ? parts.join(' · ') : 'Aucun fichier ajouté';
    },
  };
});
