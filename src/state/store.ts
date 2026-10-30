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
import { LoginError } from '../core/soulseekClient';
import type { ConnectionState } from '../core/soulseekClient';
import type { TransferSnapshot } from '../core/transfer';
import {
  formatSearchQuery,
  normalizeForMatch,
  rankHits,
  sameSongTitle,
  soulseekSpellings,
} from '../core/search';
import type { RankedHit } from '../core/search';
import { createDeezerCatalog, trackArtists } from '../core/catalog';
import type { CatalogProvider } from '../core/catalog';
import type { ShareTarget } from '../core/share';
import { primeHitScores, soulseekLadder, soulseekQueryFor, sourcesForTrack, unifyResults } from '../core/unify';
import type {
  AlbumPageData,
  ArtistPageData,
  CatalogArtistRef,
  CatalogPlayContext,
  CatalogSearchResult,
  CatalogTrack,
  HomeData,
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
import {
  clearSession,
  createSessionRecorder,
  defaultSessionStore,
  loadSession,
  planRestore,
} from '../services/playbackSession';
import type { SessionRecorder } from '../services/playbackSession';
import { StreamingService } from '../services/streaming';
import { debugLog } from '../services/debugLog';
import { takeLastCrash } from '../services/crashReport';
import { reportPreviousExits } from '../services/exitInfo';
import { encodeBase64 } from '../services/fastBase64';
import {
  EMPTY_LIBRARY,
  addRecentSearch,
  addToHistory,
  loadLibrary,
  removeRecentSearch,
  saveLibrary,
  savedTrack,
  toggleLike,
  withCatalogTrack,
} from '../services/library';
import type { Library } from '../services/library';
import type { LogTag } from '../services/debugLog';
import { createBlobUtilFs } from '../services/blobUtilFs';
import { TrackCache } from '../services/trackCache';
import type { CacheEntry } from '../services/trackCache';
import { contentTypeFor } from '../stream/httpServer';
import { messages, uploaderPhrase } from '../strings';

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
  | { kind: 'queue' }
  /** Menu of a catalog track (artist/album pages, catalog search results). */
  | { kind: 'catalogActions'; track: CatalogTrack; context?: CatalogPlayContext };

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

export type LoginSession = 'new' | 'saved' | 'keep';

interface AppState {
  ready: boolean;
  playerReady: boolean;
  settings: Settings;

  username: string | null;
  prefillUsername: string;
  connection: ConnectionState;
  connectionError: string | null;
  /** The server's reason for refusing the last login (LoginRejection), if it did. */
  loginRejection: string | null;
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
  /**
   * Soulseek file search for the current query. With the catalog on, a
   * search only asks the catalog ('idle') unless the user asks for files.
   */
  fileSearch: 'idle' | 'running' | 'done';
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
  /** Artist and album pages pushed above the current tab, last on top. */
  pages: Page[];
  artistPages: Record<string, Loadable<ArtistPageData>>;
  albumPages: Record<string, Loadable<AlbumPageData>>;
  /**
   * Home content from the listening history only (recent artists and
   * artists like them); null when the catalog is off or nothing was played.
   */
  home: Loadable<HomeData> | null;
  /** Soulseek sources found for catalog tracks, by `CatalogTrack.id`. */
  resolutions: Record<string, Resolution>;
  /** Catalog track of each Soulseek file we matched, by `hitKey`. */
  hitTracks: Record<string, CatalogTrack>;
  /** The catalog list being played (album, top tracks, radio), if any. */
  catalogContext: CatalogPlayContext | null;
  /** A catalog track the user asked for, while its sources are searched. */
  catalogPending: CatalogTrack | null;

  init: () => Promise<void>;
  /**
   * `session`: 'new' (typed on the login screen), 'saved' (stored
   * credentials: stay in the app unless the server refuses them) or 'keep'
   * (settings change: the current session stays whatever happens).
   */
  login: (username: string, password: string, session?: LoginSession) => Promise<boolean>;
  logout: () => Promise<void>;
  reconnect: () => Promise<void>;
  /** Verifies the server connection still works (after the app slept). */
  checkConnection: () => Promise<void>;
  applySettings: (settings: Settings) => Promise<void>;
  setTab: (tab: Tab) => void;
  setQuery: (query: string) => void;
  runSearch: (query?: string) => Promise<void>;
  /** Also searches Soulseek files for the current query (catalog results shown). */
  searchFilesToo: () => Promise<void>;
  cancelSearch: () => void;
  /**
   * Plays a source; on failure falls back to other sources of the same track.
   * `positionSec` resumes a saved session at that second.
   */
  playHit: (hit: SearchHit, options?: { positionSec?: number }) => Promise<void>;
  /** Skips the current source and tries the next one. */
  playNextSource: () => Promise<void>;
  retryPlayback: () => Promise<void>;
  stopPlayback: () => Promise<void>;
  /** Restores the session saved before the app closed, if any. */
  restorePlayback: () => Promise<void>;
  /** Writes a pending playback session now (app going to the background). */
  flushPlaybackSession: () => Promise<void>;
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

  /** Pushes an artist or album page and loads its data. */
  openPage: (page: Page) => void;
  /** Pops the top page. Returns false when there was none. */
  closePage: () => boolean;
  /** Pops every page (e.g. when switching tabs). */
  closeAllPages: () => void;
  loadArtistPage: (id: string, force?: boolean) => Promise<void>;
  loadAlbumPage: (id: string, force?: boolean) => Promise<void>;
  /** Builds `home` from the recently played artists; no-op when unchanged. */
  loadHome: (force?: boolean) => Promise<void>;
  /**
   * Plays a catalog track: finds Soulseek sources (or uses a cached copy) and
   * starts the best one. `context` makes next/previous walk the list, each
   * track being resolved when it is reached.
   */
  playCatalogTrack: (track: CatalogTrack, context?: CatalogPlayContext) => Promise<void>;
  /**
   * Looks for Soulseek sources of a catalog track without playing it. A
   * recent "no source" answer is reused unless `retryMissing` (the user asked).
   */
  resolveTrack: (track: CatalogTrack, retryMissing?: boolean) => Promise<Resolution>;
  /** Adds a catalog track to the queue (resolved when reached). */
  enqueueCatalogTrack: (track: CatalogTrack, first?: boolean) => void;
  /** Catalog track for a Soulseek file, when one was matched. */
  trackForHit: (hit: SearchHit) => CatalogTrack | null;
  /** Plays tracks similar to an artist's ("Radio <artist>"). */
  playArtistRadio: (artistId: string, name: string) => Promise<void>;
  /** A track someone shared (see `core/share.ts`): play it, or search for it. */
  openShared: (target: ShareTarget) => Promise<void>;
}

let service: StreamingService | null = null;
/** Tracks already played; also our shared folder. Created on init. */
let trackCache: TrackCache | null = null;
let initStarted = false;
let searchSequence = 0;
let playSequence = 0;
/** Saves the resume point while a track plays. Created on init. */
let sessionRecorder: SessionRecorder | null = null;
let watchingSession = false;
/** Login resets many fields at once; do not mistake that for "nothing plays". */
let loginInProgress = false;
/** When the user last started a track; see the queue-ended listener. */
let lastPlayStartedAt = 0;

let catalog: CatalogProvider = createDeezerCatalog();
/** Cancels the extra (corrected-query) search of the current search. */
let searchAbort: AbortController | null = null;
let catalogPlaySequence = 0;
/** Recent artist ids the current `home` was built from. */
let homeKey = '';
/** Source searches in flight, by catalog track id. */
const resolving = new Map<string, Promise<Resolution>>();
/** When each resolution was made, by catalog track id. */
const resolvedAt = new Map<string, number>();
/**
 * Played catalog tracks fetched in full (lists leave out featured artists),
 * by id; null while the request runs.
 */
const fullTracks = new Map<string, CatalogTrack | null>();

/** Tests replace the online catalog with recorded answers. */
export function setCatalogProvider(provider: CatalogProvider): void {
  catalog = provider;
}

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
/** Longest stretch of search scoring before the UI gets a turn. */
const SCORE_SLICE_MS = 8;
/** Search results on screen are refreshed at most this often. */
const PUBLISH_EVERY_MS = 400;
/** Stop listening for results once this many sources came in. */
const ENOUGH_RESULTS = 300;
/** Embedded covers above this are not decoded (JS-thread base64 cost). */
const MAX_COVER_BYTES = 1024 * 1024;
/** A tag bigger than this is not waited for (it would delay nothing, but costs memory). */
const MAX_STREAM_TAG_BYTES = 4 * 1024 * 1024;
/** First Soulseek search for one catalog track's sources. */
const RESOLVE_DURATION_MS = 6000;
/**
 * Whole source lookup, every step of the query ladder included. It used to reach 14 s
 * with the music stopped and a spinner when a track had no source at all.
 */
const RESOLVE_BUDGET_MS = 9000;
/** Time kept for each later step of the query ladder. */
const MIN_RETRY_MS = 2000;
/** A step shorter than this would not find anything useful. */
const MIN_STEP_MS = 1500;
/** "No source" is remembered this long, so moving on through a list does not search again. */
const MISSING_TTL_MS = 5 * 60 * 1000;
/** Stop a source search this long after the first good source arrived. */
const RESOLVE_GRACE_MS = 1500;
/** Sources found for a track are reused for this long. */
const RESOLUTION_TTL_MS = 10 * 60 * 1000;
/** Recent artists shown on the home page. */
const HOME_ARTISTS = 8;
/** "Parce que vous écoutez …" shelves on the home page. */
const HOME_SIMILAR_SHELVES = 2;
/** Catalog tracks skipped in a row when none of them has a source. */
const MAX_SKIPPED_TRACKS = 3;
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

/** Artists of the recently played catalog tracks, most recent first. */
export function recentArtists(library: Library, max = HOME_ARTISTS): CatalogArtistRef[] {
  const artists: CatalogArtistRef[] = [];
  const seen = new Set<string>();

  for (const saved of library.history) {
    const artist = saved.catalog?.artist;
    if (artist?.id && !seen.has(artist.id)) {
      seen.add(artist.id);
      artists.push(artist);
      if (artists.length >= max) {
        break;
      }
    }
  }

  return artists;
}

/** Whether the track now playing is worth saving as a resume point. */
function playbackSnapshot(): {
  hit: SearchHit;
  source: 'network' | 'cache';
  queue: SearchHit[];
  context: PlayContext | null;
  catalogContext: CatalogPlayContext | null;
  shuffle: boolean;
  repeat: boolean;
} | null {
  const state = useAppStore.getState();
  const current = state.current;

  if (!current || current.phase !== 'playing') {
    return null;
  }

  return {
    hit: current.hit,
    source: current.source,
    queue: state.queue,
    context: state.context,
    catalogContext: state.catalogContext,
    shuffle: state.shuffle,
    repeat: state.repeat,
  };
}

/**
 * Saves the resume point when what plays changes, and every few seconds while
 * it plays (the recorder debounces both). Clears it when playback stops or
 * fails, so a broken track is not offered back on the next launch.
 */
function watchPlaybackSession(): void {
  if (watchingSession) {
    return;
  }

  watchingSession = true;
  useAppStore.subscribe((state, previous) => {
    if (!sessionRecorder || loginInProgress) {
      return;
    }

    const changed =
      state.current !== previous.current ||
      state.queue !== previous.queue ||
      state.context !== previous.context ||
      state.catalogContext !== previous.catalogContext ||
      state.shuffle !== previous.shuffle ||
      state.repeat !== previous.repeat;

    if (!changed) {
      return;
    }

    if (!state.current || state.current.phase === 'error') {
      void sessionRecorder.clear();
      return;
    }

    if (state.current.phase === 'playing') {
      sessionRecorder.touch();
    }
  });
}

/** Seeks without failing playback when the player is not ready yet. */
async function seekToPosition(positionSec: number): Promise<void> {
  if (!Number.isFinite(positionSec)) {
    return;
  }

  try {
    await TrackPlayer.seekTo(Math.max(0, positionSec));
  } catch {
    // The player reports failures through its state.
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
      // Base64-encoding a cover runs on the JS thread: skip it when the
      // catalog already gives a cover, and for unusually large pictures.
      const picture =
        tags?.picture && !get().trackForHit(hit)?.album?.cover.large && tags.picture.data.length <= MAX_COVER_BYTES
          ? tags.picture
          : null;
      setMeta(key, {
        title: tags?.title,
        artist: tags?.artist,
        album: tags?.album,
        coverUri: picture ? `data:${picture.mime};base64,${encodeBase64(picture.data)}` : null,
      });
    } catch {
      // The transfer ended or failed first: no cover for this one.
    }
  }

  /**
   * What the notification and lock screen show: the catalog track when the
   * file was matched to one, else its tag, else its path. Never the peer.
   */
  function nowPlayingInfo(hit: SearchHit): { title: string; artist: string; album?: string; artwork?: string } {
    const track = get().trackForHit(hit);
    const meta = get().meta[hitKey(hit)];
    const cover = track?.album?.cover;
    return {
      title: track?.title || meta?.title || displayTitle(hit.filename),
      artist: (track ? trackArtists(track) : '') || meta?.artist || displayArtist(hit) || 'SoulStream',
      album: track?.album?.title || meta?.album,
      artwork: cover?.big ?? cover?.large ?? cover?.medium ?? undefined,
    };
  }

  /** The native player holds one track at a time: index 0 is the current one. */
  function refreshNowPlaying(hit: SearchHit): void {
    const current = get().current;
    if (!current || hitKey(current.hit) !== hitKey(hit)) {
      return;
    }
    void Promise.resolve()
      .then(() => TrackPlayer.updateMetadataForTrack(0, nowPlayingInfo(hit)))
      .catch(() => {});
  }

  /**
   * Catalog lists (search, albums) name only the main artist: fetch the
   * playing track in full once, to show everyone on it.
   */
  function completeTrack(hit: SearchHit): void {
    const track = get().trackForHit(hit);
    if (!track || !get().settings.catalogEnabled || fullTracks.has(track.id)) {
      return;
    }

    fullTracks.set(track.id, null);
    catalog
      .track(track.id)
      .then(full => {
        const complete: CatalogTrack = {
          ...track,
          contributors: full.contributors.length > 0 ? full.contributors : track.contributors,
        };
        fullTracks.set(track.id, complete);
        if (trackArtists(complete) === trackArtists(track)) {
          return;
        }
        set(state => {
          const hitTracks: Record<string, CatalogTrack> = {};
          for (const [key, value] of Object.entries(state.hitTracks)) {
            hitTracks[key] = value.id === track.id ? complete : value;
          }
          return { hitTracks };
        });
        updateLibrary(library => withCatalogTrack(library, complete));
        refreshNowPlaying(hit);
      })
      .catch(() => {
        fullTracks.delete(track.id);
      });
  }

  /** Marks the current track as played, once it really started. */
  function recordPlay(hit: SearchHit): void {
    const meta = get().meta[hitKey(hit)];
    updateLibrary(library => addToHistory(library, savedTrack(hit, meta, get().trackForHit(hit))));
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
      `Impossible de joindre ${uploaderPhrase(hit.username, get().settings.showUploaders)}`,
    );
    step('pair joint, QueueUpload envoyé');

    await waitForTransfer(
      id,
      sequence,
      t => t.state === 'awaiting-file' || t.state === 'streaming' || t.state === 'complete',
      hit.slotFree ? playbackTimeouts.acceptFreeSlotMs : playbackTimeouts.acceptNoSlotMs,
      `${uploaderPhrase(hit.username, get().settings.showUploaders)} vous a mis en file d'attente`,
    );
    step('transfert accepté');

    await waitForTransfer(
      id,
      sequence,
      t => t.state === 'streaming' || t.state === 'complete',
      playbackTimeouts.openFileMs,
      `${uploaderPhrase(hit.username, get().settings.showUploaders)} n'a pas ouvert le transfert`,
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
      ...nowPlayingInfo(hit),
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
    // A catalog track: its own matched sources, best first.
    const track = get().hitTracks[hitKey(original)];
    const pool = track ? knownSources(track) : [];

    for (const { hit } of pool) {
      if (!tried.has(hitKey(hit)) && !deniedPeers.has(hit.username.toLowerCase())) {
        return hit;
      }
    }

    if (track && pool.length > 0) {
      return null;
    }

    const title = displayTitle(original.filename);

    for (const { hit } of get().results) {
      if (tried.has(hitKey(hit)) || deniedPeers.has(hit.username.toLowerCase())) {
        continue;
      }

      if (sameSongTitle(title, displayTitle(hit.filename))) {
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

    // Notification, lock screen and headset buttons.
    TrackPlayer.addEventListener(Event.RemoteNext, () => {
      void get().playNext();
    });

    TrackPlayer.addEventListener(Event.RemotePrevious, () => {
      void TrackPlayer.getProgress()
        .then(progress => progress.position)
        .catch(() => 0)
        .then(position => get().playPrevious(position));
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
      ...nowPlayingInfo(hit),
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


  /**
   * Soulseek file search for a query: results are matched to the catalog
   * tracks already known (if any) and scored in small slices.
   */
  async function searchFiles(
    sequence: number,
    rawQuery: string,
    networkQuery: string,
    catalogTracks: CatalogTrack[],
    deviceResults: SearchHit[],
  ): Promise<void> {
    const searchService = service;
    const online = !!searchService && get().connection === 'online';

    if (!searchService || !online) {
      set({
        searching: false,
        fileSearch: 'idle',
        searchError:
          deviceResults.length > 0 || get().catalogResults ? null : messages.notConnected,
      });
      return;
    }

    searchAbort?.abort();
    const abort = new AbortController();
    searchAbort = abort;
    const collected: SearchHit[] = [];
    const collectedKeys = new Set<string>();
    // File/track scores of this search: each regroup only scores new files.
    const unifyScores = new Map<string, number>();
    /**
     * Files scored so far (against the query and the catalog tracks).
     * Scoring runs in slices of SCORE_SLICE_MS so slow phones keep a
     * responsive UI; results only show files already scored.
     */
    let scored = 0;
    let pumpTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPublish = 0;
    let drained: (() => void) | null = null;
    // Accent-free spelling and the catalog's spelling run alongside.
    const extraSearches: Promise<unknown>[] = [];
    const [mainSpelling, ...otherSpellings] = soulseekSpellings(networkQuery);

    const regroup = () => {
      if (sequence !== searchSequence) {
        return;
      }
      const ready = collected.slice(0, scored);
      const unified = unifyResults(networkQuery, ready, catalogTracks, LIST_SCORE, unifyScores);
      set(state => ({
        results: rankHits(networkQuery, ready, LIST_SCORE),
        groups: unified.groups,
        hitTracks: { ...state.hitTracks, ...unified.hitTracks },
      }));
    };

    const pump = () => {
      pumpTimer = null;
      if (sequence !== searchSequence) {
        drained?.();
        drained = null;
        return;
      }

      const deadline = Date.now() + SCORE_SLICE_MS;
      while (scored < collected.length && Date.now() < deadline) {
        primeHitScores(networkQuery, collected[scored], catalogTracks, unifyScores);
        scored++;
      }

      const done = scored >= collected.length;
      if (done || Date.now() - lastPublish >= PUBLISH_EVERY_MS) {
        lastPublish = Date.now();
        regroup();
      }

      if (!done) {
        // Give touches and rendering a turn before the next slice.
        pumpTimer = setTimeout(pump, 0);
      } else if (drained) {
        const resolve = drained;
        drained = null;
        resolve();
      }
    };

    const schedulePump = () => {
      if (!pumpTimer) {
        pumpTimer = setTimeout(pump, 0);
      }
    };

    const onBatch = (batch: SearchHit[]) => {
      if (sequence !== searchSequence) {
        return;
      }

      for (const found of batch) {
        const key = hitKey(found);
        if (!collectedKeys.has(key)) {
          collectedKeys.add(key);
          collected.push(found);
        }
      }

      schedulePump();

      if (collected.length >= ENOUGH_RESULTS) {
        searchService.cancelSearch();
        abort.abort();
      }
    };

    debugLog('play', `recherche de fichiers « ${networkQuery} » (saisie : « ${rawQuery} »)`);
    set({ searching: true, fileSearch: 'running', searchEmpty: false, searchError: null });

    // "daft pnk one mor time" finds nothing on Soulseek, where every word
    // must be in the path: search the catalog's spelling too.
    const top = catalogTracks[0];
    const corrected = top ? soulseekQueryFor(top) : '';
    const sameWords = (a: string, b: string) =>
      normalizeForMatch(a).split(' ').sort().join(' ') === normalizeForMatch(b).split(' ').sort().join(' ');
    const spellings = [
      ...otherSpellings,
      ...(corrected && !sameWords(corrected, networkQuery) ? soulseekSpellings(corrected) : []),
    ];

    try {
      for (const spelling of spellings) {
        debugLog('play', `recherche aussi « ${spelling} »`);
        extraSearches.push(
          searchService
            .search(spelling, onBatch, SEARCH_DURATION_MS, { exclusive: false, signal: abort.signal })
            .catch(() => {}),
        );
      }

      await searchService.search(mainSpelling, onBatch, SEARCH_DURATION_MS);
      await Promise.all(extraSearches);

      if (sequence !== searchSequence) {
        return;
      }

      // Let the last slices finish (still without blocking the UI).
      if (scored < collected.length || pumpTimer) {
        await new Promise<void>(resolve => {
          drained = resolve;
          schedulePump();
        });
      }

      if (sequence !== searchSequence) {
        return;
      }

      regroup();
      const best = rankHits(networkQuery, collected, 0).slice(0, 5);
      debugLog(
        'play',
        best.length > 0
          ? `meilleurs candidats : ${best.map(r => `${r.score.toFixed(2)} ${r.hit.filename}`).join(' | ')}`
          : 'aucun MP3 reçu des pairs',
      );
      debugLog('play', `recherche terminée : ${collected.length} MP3 reçus, ${get().results.length} retenus`);
      set({
        searching: false,
        fileSearch: 'done',
        searchEmpty: get().groups.length === 0 && deviceResults.length === 0,
      });
    } catch (error) {
      debugLog('play', `recherche en erreur : ${errorMessage(error)}`);
      if (sequence === searchSequence) {
        set({ searching: false, fileSearch: 'done', searchError: errorMessage(error) });
      }
    } finally {
      if (pumpTimer && sequence !== searchSequence) {
        clearTimeout(pumpTimer);
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Online catalog                                                          */
  /* ---------------------------------------------------------------------- */

  /** Sources already known for a catalog track: last search, then resolution. */
  function knownSources(track: CatalogTrack): RankedHit[] {
    const fromSearch = get().groups.find(group => group.track?.id === track.id)?.sources ?? [];
    const resolved = get().resolutions[track.id]?.sources ?? [];
    const seen = new Set<string>();

    return [...fromSearch, ...resolved].filter(source => {
      const key = hitKey(source.hit);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function setResolution(track: CatalogTrack, resolution: Resolution): void {
    set(state => {
      const hitTracks = { ...state.hitTracks };
      const known = fullTracks.get(track.id) ?? track;
      for (const source of resolution.sources) {
        hitTracks[hitKey(source.hit)] = known;
      }
      return { resolutions: { ...state.resolutions, [track.id]: resolution }, hitTracks };
    });
  }

  /** Copies of the track already on the device, as top sources. */
  function localSources(track: CatalogTrack): RankedHit[] {
    const cache = trackCache;
    if (!cache) {
      return [];
    }
    const hits = cache.search(soulseekQueryFor(track), LIST_SCORE).map(entry => cache.asHit(entry));
    // Cached copies start instantly: rank them above every peer.
    return sourcesForTrack(track, hits).map(source => ({ ...source, rank: source.rank + 1 }));
  }

  /**
   * Searches Soulseek for one catalog track, alongside any other search.
   * Stops early once a good source answered (plus a short grace period for
   * better ones), so playback starts quickly.
   */
  async function searchSources(track: CatalogTrack, query: string, durationMs: number): Promise<SearchHit[]> {
    const searchService = service;
    if (!searchService || get().connection !== 'online') {
      return [];
    }

    const collected: SearchHit[] = [];
    const seen = new Set<string>();
    const controller = new AbortController();
    let grace: ReturnType<typeof setTimeout> | null = null;
    let goodFree = 0;

    const onBatch = (incoming: SearchHit[]) => {
      // Several spellings run at once: the same file can come back twice.
      const batch = incoming.filter(found => {
        const key = hitKey(found);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      collected.push(...batch);
      const good = sourcesForTrack(track, batch);
          goodFree += good.filter(source => source.hit.slotFree).length;

      if (goodFree >= 3) {
        controller.abort();
      } else if (good.length > 0 && !grace) {
        grace = setTimeout(() => controller.abort(), RESOLVE_GRACE_MS);
      }
    };

    try {
      await Promise.all(
        soulseekSpellings(query).map(spelling =>
          searchService.search(spelling, onBatch, durationMs, { exclusive: false, signal: controller.signal }),
        ),
      );
    } finally {
      if (grace) {
        clearTimeout(grace);
      }
    }

    return collected;
  }

  async function findSources(track: CatalogTrack): Promise<Resolution> {
    const known = knownSources(track);
    const local = localSources(track);

    // Sources from the search the user just ran are enough to start.
    if (known.length > 0 || local.length > 0) {
      return { status: 'found', sources: mergeSources(local, known) };
    }

    if (!service || get().connection !== 'online') {
      return { status: 'error', sources: [] };
    }

    // Query ladder (artist + title, title only, artist + album), stopping at
    // the first step that finds a source, all inside one time budget.
    const steps = soulseekLadder(track);
    debugLog('play', `sources pour « ${track.artist.name} – ${track.title} » : ${steps.length} requête(s) possibles`);
    const startedAt = Date.now();
    let sources: RankedHit[] = [];

    for (const [index, step] of steps.entries()) {
      const remaining = RESOLVE_BUDGET_MS - (Date.now() - startedAt);
      const left = steps.length - index;
      // The first step gets most of the time; later ones share what is left.
      const duration =
        index === 0
          ? Math.min(RESOLVE_DURATION_MS, remaining - MIN_RETRY_MS * (left - 1))
          : Math.floor(remaining / left);
      if (duration < MIN_STEP_MS) {
        break;
      }
      const hits = await searchSources(track, step.query, duration);
      sources = sourcesForTrack(track, hits);
      debugLog(
        'play',
        `étape ${index + 1}/${steps.length} (${step.kind}) « ${step.query} » : ${hits.length} fichier(s), ${sources.length} source(s)`,
      );
      if (sources.length > 0 || get().connection !== 'online') {
        break;
      }
    }

    debugLog('play', `${sources.length} source(s) pour « ${track.title} »`);
    return { status: sources.length > 0 ? 'found' : 'none', sources };
  }

  function mergeSources(...lists: RankedHit[][]): RankedHit[] {
    const seen = new Set<string>();
    return lists
      .flat()
      .sort((a, b) => b.rank - a.rank)
      .filter(source => {
        const key = hitKey(source.hit);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  async function loadPage<T>(
    field: 'artistPages' | 'albumPages',
    id: string,
    force: boolean,
    fetchPage: () => Promise<T>,
  ): Promise<void> {
    const existing = get()[field][id];
    if (existing && !force && existing.status !== 'error') {
      return;
    }

    const put = (value: Loadable<T>) =>
      set(state => ({ [field]: { ...state[field], [id]: value } }) as Partial<AppState>);

    put({ status: 'loading' });
    try {
      put({ status: 'ready', data: await fetchPage() });
    } catch (error) {
      debugLog('app', `catalogue : ${errorMessage(error)}`);
      put({ status: 'error', error: errorMessage(error) });
    }
  }

  /** Next index in a catalog list, honouring shuffle. */
  function nextCatalogIndex(context: CatalogPlayContext): number | null {
    if (get().shuffle && context.tracks.length > 1) {
      let index = Math.floor(Math.random() * (context.tracks.length - 1));
      if (index >= context.index) {
        index++;
      }
      return index;
    }
    return context.index + 1 < context.tracks.length ? context.index + 1 : null;
  }

  /** Plays a file (from the device cache when it is there). */
  async function startHit(hit: SearchHit, positionSec?: number): Promise<void> {
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

      const playing = get().current;
      if (playing && playing.phase === 'playing') {
        if (positionSec !== undefined) {
          await seekToPosition(positionSec);
        }
        completeTrack(playing.hit);
      }
    } catch (error) {
      set(state => ({
        current: state.current
          ? { ...state.current, phase: 'error', error: errorMessage(error) }
          : null,
        searchError: state.current ? state.searchError : errorMessage(error),
      }));
    }
  }

  /**
   * Drops a catalog track still waiting for its sources: anything the user
   * plays or stops meanwhile wins over it.
   */
  function cancelCatalogPlay(): void {
    catalogPlaySequence++;
    set({ catalogPending: null });
  }

  /**
   * `byUser`: the user tapped this track (search it again even if it had no
   * source a moment ago). Moving on through a list (end of track, next,
   * skipping a missing track) reuses recent answers.
   */
  async function playCatalog(
    track: CatalogTrack,
    context: CatalogPlayContext | undefined,
    skipped: number,
    byUser: boolean,
  ): Promise<void> {
    const sequence = ++catalogPlaySequence;
    set({
      catalogPending: track,
      ...(context ? { catalogContext: context, context: null } : { catalogContext: null }),
    });

    const resolution = await get().resolveTrack(track, byUser);

    if (sequence !== catalogPlaySequence) {
      return;
    }

    set({ catalogPending: null });
    const best = resolution.sources[0];

    if (best) {
      await startHit(best.hit);

      // Find the next track's sources while this one plays (not when the
      // user stopped it or moved on meanwhile).
      const upcoming = context ? context.tracks[context.index + 1] : undefined;
      if (upcoming && !get().shuffle && sequence === catalogPlaySequence && get().current) {
        void get().resolveTrack(upcoming);
      }
      return;
    }

    const reason =
      resolution.status === 'error'
        ? 'Non connecté au réseau'
        : `Aucune source pour « ${track.title} »`;

    const nextIndex = context ? nextCatalogIndex(context) : null;
    if (context && nextIndex !== null && skipped + 1 < MAX_SKIPPED_TRACKS && resolution.status !== 'error') {
      set({ notice: `${reason}, morceau suivant.` });
      await playCatalog(context.tracks[nextIndex], { ...context, index: nextIndex }, skipped + 1, false);
      return;
    }

    set({ notice: `${reason}.` });
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
      catalogEnabled: true,
      showUploaders: false,
    },

    username: null,
    prefillUsername: '',
    connection: 'idle',
    connectionError: null,
    loginRejection: null,
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
    fileSearch: 'idle',
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
    home: null,
    resolutions: {},
    hitTracks: {},
    catalogContext: null,
    catalogPending: null,
    notice: null,

    init: async () => {
      if (initStarted) {
        return;
      }

      initStarted = true;

      try {
        const lastCrash = await takeLastCrash();
        if (lastCrash) {
          debugLog('app', `— plantage du ${new Date(lastCrash.at).toLocaleString('fr-FR')} : ${lastCrash.message}`);
          for (const line of lastCrash.log) {
            debugLog('app', `  | ${line}`);
          }
          if (lastCrash.stack) {
            debugLog('app', `  pile : ${lastCrash.stack.split('\n').slice(0, 8).join(' ← ')}`);
          }
          set({
            notice: 'SoulStream s’est fermé après une erreur. Détails dans Réglages → Journal de débogage.',
          });
        }

        // Low-memory kills and native crashes leave no JavaScript trace.
        const exitNotice = await reportPreviousExits();
        if (exitNotice && !lastCrash) {
          set({ notice: exitNotice });
        }

        const settings = await loadSettings();
        const library = await loadLibrary();
        const hitTracks: Record<string, CatalogTrack> = {};
        for (const saved of [...library.history, ...library.liked]) {
          if (saved.catalog) {
            hitTracks[hitKey(saved.hit)] = saved.catalog;
          }
        }
        set({ settings, library, hitTracks });

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
          await get().login(credentials.username, credentials.password, 'saved');
        }

        // Only once login is over: its mass reset must not erase the session
        // the restart is about to restore.
        sessionRecorder = createSessionRecorder({
          store: defaultSessionStore,
          snapshot: playbackSnapshot,
          position: async () => {
            try {
              return (await TrackPlayer.getProgress()).position ?? 0;
            } catch {
              return 0;
            }
          },
        });
        watchPlaybackSession();
      } finally {
        set({ ready: true });
      }
    },

    login: async (username, password, session = 'new') => {
      const settings = get().settings;
      const previousUsername = get().username;

      loginInProgress = true;
      searchSequence++;
      playSequence++;
      deniedPeers.clear();
      await resetPlayer();

      // A new account must not inherit the previous one's resume point.
      if (session === 'new') {
        await clearSession();
      }

      if (service) {
        await service.stop();
        service = null;
      }

      const instance = new StreamingService(settings, trackCache);
      service = instance;
      wire(instance);

      set({
        username: session === 'keep' ? previousUsername : session === 'saved' ? username : null,
        prefillUsername: username,
        connection: 'connecting',
        connectionError: null,
        loginRejection: null,
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
          tab: session === 'new' ? 'home' : get().tab,
        });
        loginInProgress = false;

        if (session === 'saved') {
          void get().restorePlayback();
        }

        return true;
      } catch (error) {
        await instance.stop();

        if (service === instance) {
          service = null;
        }

        // Without network, stored credentials keep the user in the app (offline
        // banner, "Réessayer"); only refused credentials go back to login.
        const keptUsername =
          session === 'keep'
            ? previousUsername
            : session === 'saved' && !(error instanceof LoginError)
              ? username
              : null;

        set({
          username: keptUsername,
          connection: 'error',
          connectionError: errorMessage(error),
          loginRejection: error instanceof LoginError ? error.reason : null,
        });

        loginInProgress = false;
        return false;
      }
    },

    logout: async () => {
      playSequence++;
      searchSequence++;
      await resetPlayer();
      await sessionRecorder?.clear();
      await clearSession();

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
        await get().login(credentials.username, credentials.password, 'saved');
      }
    },

    checkConnection: async () => {
      if (service && get().connection === 'online') {
        const alive = await service.checkConnection();
        debugLog('net', alive ? 'connexion au serveur vérifiée' : 'connexion au serveur perdue, reconnexion');
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

      const ok = await get().login(username, password, 'keep');

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

      if (get().searching && get().query === rawQuery) {
        return;
      }

      const sequence = ++searchSequence;
      searchAbort?.abort();
      searchAbort = null;

      set({
        query: rawQuery,
        searchQuery: networkQuery,
        searching: true,
        fileSearch: 'idle',
        searchEmpty: false,
        searchError: null,
        results: [],
        groups: [],
        catalogResults: null,
        deviceResults,
      });

      // With the catalog on, a search only asks the catalog: Soulseek is
      // searched for a title when it is played (`resolveTrack`), so a broad
      // search such as an artist name costs no Soulseek request at all.
      if (get().settings.catalogEnabled) {
        let result: CatalogSearchResult | null = null;

        try {
          result = await catalog.search(rawQuery);
        } catch (error) {
          debugLog('app', `catalogue : ${errorMessage(error)}`);
        }

        if (sequence !== searchSequence) {
          return;
        }

        const found = result && (result.tracks.length > 0 || result.artists.length > 0 || result.albums.length > 0);
        if (result && found) {
          set({
            catalogResults: result,
            groups: unifyResults(networkQuery, [], result.tracks, LIST_SCORE).groups,
            searching: false,
          });
          return;
        }

        // Nothing in the catalog, or it is unreachable: search the files.
        debugLog('play', `rien dans le catalogue : ${messages.fileSearchOnNetwork}`);
      }

      await searchFiles(sequence, rawQuery, networkQuery, [], deviceResults);
    },

    searchFilesToo: async () => {
      const { searchQuery, query, catalogResults, deviceResults, fileSearch } = get();
      if (!searchQuery || fileSearch === 'running') {
        return;
      }

      const sequence = ++searchSequence;
      set({ searching: true });
      await searchFiles(sequence, query, searchQuery, catalogResults?.tracks ?? [], deviceResults);
    },

    cancelSearch: () => {
      searchSequence++;
      searchAbort?.abort();
      service?.cancelSearch();
      set(state => ({
        searching: false,
        searchEmpty: false,
        fileSearch: state.fileSearch === 'running' ? 'done' : state.fileSearch,
      }));
    },

    playHit: async (hit, options) => {
      cancelCatalogPlay();
      await startHit(hit, options?.positionSec);
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
      debugLog('play', `arrêt demandé (${get().current?.phase ?? 'rien en cours'})`);
      playSequence++;
      cancelCatalogPlay();
      // Clear the UI first: the native reset can take a while.
      set({ current: null, playerOpen: false });
      await sessionRecorder?.clear();
      await clearSession();
      await resetPlayer();
      service?.cancelActive();
    },

    restorePlayback: async () => {
      const saved = await loadSession();

      if (!saved || get().current) {
        return;
      }

      const cached = !!trackCache?.findByHit(saved.hit);
      const plan = planRestore(saved, { online: get().connection === 'online', cached });

      // Offline with no local copy: keep the session for the next launch.
      if (plan === 'wait') {
        return;
      }

      set({
        queue: saved.queue,
        context: saved.context,
        catalogContext: saved.catalogContext,
        shuffle: saved.shuffle,
        repeat: saved.repeat,
      });

      await get().playHit(saved.hit, { positionSec: saved.positionSec });

      const current = get().current;

      if (!current || current.phase === 'error') {
        set({
          current: null,
          playerOpen: false,
          notice: 'La source de la dernière lecture n’est plus disponible.',
        });
        await clearSession();
      }
    },

    flushPlaybackSession: async () => {
      await sessionRecorder?.flush();
    },

    dismissNotice: () => set({ notice: null }),

    playTrack: async (hit, context) => {
      set({ context: context ?? null, catalogContext: null });
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

      const catalogContext = get().catalogContext;
      if (catalogContext) {
        const index = nextCatalogIndex(catalogContext);
        if (index === null) {
          set({ notice: 'Fin de la liste de lecture.' });
          return;
        }
        await playCatalog(catalogContext.tracks[index], { ...catalogContext, index }, 0, false);
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
      const { context, current, catalogContext } = get();
      const list = catalogContext ?? context;

      if (current && (positionSec > RESTART_THRESHOLD_SEC || !list || list.index === 0)) {
        try {
          await TrackPlayer.seekTo(0);
        } catch {
          // The player reports failures through its state.
        }
        return;
      }

      if (catalogContext && catalogContext.index > 0) {
        const index = catalogContext.index - 1;
        await playCatalog(catalogContext.tracks[index], { ...catalogContext, index }, 0, false);
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
      updateLibrary(library => toggleLike(library, savedTrack(hit, meta, get().trackForHit(hit))));
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

    // ---- Online catalog ----
    openPage: (page: Page) => {
      set(state => ({ pages: [...state.pages, page], playerOpen: false, sheet: null }));
      if (page.kind === 'artist') {
        void get().loadArtistPage(page.id);
      } else {
        void get().loadAlbumPage(page.id);
      }
    },

    closePage: () => {
      if (get().pages.length === 0) {
        return false;
      }
      set(state => ({ pages: state.pages.slice(0, -1) }));
      return true;
    },

    closeAllPages: () => set({ pages: [] }),

    loadArtistPage: (id, force = false) => loadPage('artistPages', id, force, () => catalog.artist(id)),
    loadAlbumPage: (id, force = false) => loadPage('albumPages', id, force, () => catalog.album(id)),
    loadHome: async (force = false) => {
      const artists = get().settings.catalogEnabled ? recentArtists(get().library) : [];

      if (artists.length === 0) {
        homeKey = '';
        set({ home: null });
        return;
      }

      const key = artists.map(artist => artist.id).join(',');
      const existing = get().home;
      if (!force && key === homeKey && existing && existing.status !== 'error') {
        return;
      }

      homeKey = key;
      // Keep showing the previous content while it refreshes.
      if (existing?.status !== 'ready') {
        set({ home: { status: 'loading' } });
      }

      const results = await Promise.allSettled(artists.map(artist => catalog.artistWithRelated(artist.id)));
      if (key !== homeKey) {
        return;
      }

      const loaded = results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
      if (loaded.length === 0) {
        const failure = results.find(result => result.status === 'rejected');
        set({
          home: {
            status: 'error',
            error: failure?.status === 'rejected' ? errorMessage(failure.reason) : 'Catalogue indisponible',
          },
        });
        return;
      }

      const known = new Set(loaded.map(entry => entry.artist.id));
      const similar = loaded
        .slice(0, HOME_SIMILAR_SHELVES)
        .map(entry => ({
          artist: entry.artist,
          related: entry.related.filter(artist => !known.has(artist.id)).slice(0, 12),
        }))
        .filter(entry => entry.related.length > 0);

      set({ home: { status: 'ready', data: { artists: loaded.map(entry => entry.artist), similar } } });
    },

    resolveTrack: (track, retryMissing = false) => {
      const existing = get().resolutions[track.id];
      const age = Date.now() - (resolvedAt.get(track.id) ?? 0);

      if (
        (existing?.status === 'found' && age < RESOLUTION_TTL_MS) ||
        (existing?.status === 'none' && !retryMissing && age < MISSING_TTL_MS)
      ) {
        return Promise.resolve(existing);
      }

      const inFlight = resolving.get(track.id);
      if (inFlight) {
        return inFlight;
      }

      setResolution(track, { status: 'searching', sources: existing?.sources ?? [] });

      const promise = findSources(track)
        .catch((error): Resolution => {
          debugLog('play', `sources introuvables : ${errorMessage(error)}`);
          return { status: 'error', sources: [] };
        })
        .then(resolution => {
          resolving.delete(track.id);
          resolvedAt.set(track.id, Date.now());
          setResolution(track, resolution);
          return resolution;
        });

      resolving.set(track.id, promise);
      return promise;
    },

    playCatalogTrack: (track, context) => playCatalog(track, context, 0, true),

    enqueueCatalogTrack: (track, first = false) => {
      set({ notice: 'Recherche de sources…' });
      void get()
        .resolveTrack(track)
        .then(resolution => {
          const best = resolution.sources[0];
          if (best) {
            get().enqueue(best.hit, first);
          } else {
            set({ notice: `Aucune source pour « ${track.title} ».` });
          }
        });
    },

    trackForHit: hit => get().hitTracks[hitKey(hit)] ?? null,

    playArtistRadio: async (artistId, name) => {
      try {
        const tracks = await catalog.artistRadio(artistId);
        if (tracks.length === 0) {
          set({ notice: 'Pas de radio pour cet artiste.' });
          return;
        }
        await get().playCatalogTrack(tracks[0], { label: `Radio ${name}`, tracks, index: 0 });
      } catch (error) {
        set({ notice: errorMessage(error) });
      }
    },

    openShared: async target => {
      set({ sheet: null, pages: [] });

      if (target.kind === 'track' && get().settings.catalogEnabled) {
        try {
          const track = await catalog.track(target.id);
          fullTracks.set(track.id, track);
          set({ notice: `Lien reçu : « ${track.title} »` });
          await get().playCatalogTrack(track);
          return;
        } catch (error) {
          debugLog('app', `lien partagé : ${errorMessage(error)}`);
        }
      }

      if (!target.query) {
        set({ notice: 'Impossible d’ouvrir ce lien : activez le catalogue en ligne dans les Réglages.' });
        return;
      }

      set({ playerOpen: false });
      get().setTab('search');
      await get().runSearch(target.query);
    },

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
