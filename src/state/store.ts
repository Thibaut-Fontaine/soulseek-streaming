import { PermissionsAndroid, Platform } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import { create } from 'zustand';

import type { ConnectionState } from '../core/soulseekClient';
import type { TransferSnapshot } from '../core/transfer';
import { displayArtist, displayTitle, hitKey, isStreamableFile } from '../core/types';
import type { SearchHit } from '../core/types';
import { ensurePlayer, resetPlayer } from '../player/player';
import { clearCredentials, loadCredentials, loadSettings, saveCredentials, saveSettings } from '../services/settings';
import type { Credentials, Settings } from '../services/settings';
import { StreamingService } from '../services/streaming';
import { contentTypeFor } from '../stream/httpServer';

export type Tab = 'search' | 'player' | 'settings';

export interface CurrentPlayback {
  hit: SearchHit;
  transferId: string;
  url: string;
  phase: 'preparing' | 'playing' | 'error';
  error: string | null;
  bufferTarget: number;
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
  hits: SearchHit[];
  searchError: string | null;

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
  playHit: (hit: SearchHit) => Promise<void>;
  retryPlayback: () => Promise<void>;
  stopPlayback: () => Promise<void>;
  dismissNotice: () => void;
}

let service: StreamingService | null = null;
let initStarted = false;
let searchSequence = 0;
let playSequence = 0;

const MAX_TRANSFER_HISTORY = 20;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mergeHits(existing: SearchHit[], incoming: SearchHit[]): SearchHit[] {
  if (incoming.length === 0) {
    return existing;
  }

  const known = new Set(existing.map(hitKey));
  const merged = existing.slice();

  for (const hit of incoming) {
    const key = hitKey(hit);

    if (!known.has(key)) {
      known.add(key);
      merged.push(hit);
    }
  }

  return merged;
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
        const current =
          state.current && state.current.transferId === snapshot.id &&
          (snapshot.state === 'failed' || snapshot.state === 'cancelled')
            ? {
                ...state.current,
                phase: 'error' as const,
                error: snapshot.error ?? 'Le transfert a été interrompu',
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

  async function waitForBuffer(
    transferId: string,
    target: number,
    sequence: number,
  ): Promise<void> {
    const started = Date.now();

    while (Date.now() - started < 10 * 60 * 1000) {
      if (sequence !== playSequence) {
        throw new Error('Lecture annulée');
      }

      const transfer = service?.getTransfer(transferId);

      if (!transfer) {
        throw new Error('Transfert introuvable');
      }

      if (transfer.state === 'failed' || transfer.state === 'cancelled') {
        throw new Error(transfer.error ?? 'Le transfert a échoué');
      }

      if (transfer.buffer.total >= Math.min(target, transfer.expectedSize)) {
        return;
      }

      if (transfer.state === 'complete') {
        return;
      }

      await sleep(200);
    }

    throw new Error('Délai de mise en mémoire tampon dépassé');
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
    hits: [],
    searchError: null,

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
      await resetPlayer();

      if (service) {
        await service.stop();
        service = null;
      }

      const instance = new StreamingService(settings);
      service = instance;
      wire(instance);

      set({
        username: keepSessionOnFailure ? previousUsername : null,
        prefillUsername: username,
        connection: 'connecting',
        connectionError: null,
        hits: [],
        searching: false,
        searchError: null,
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
        hits: [],
        searchError: null,
        transfers: {},
        current: null,
        notice: null,
      });
    },

    reconnect: async () => {
      if (get().connection === 'connecting' || get().connection === 'online') {
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

    setQuery: query => set({ query }),

    runSearch: async (input?: string) => {
      const query = (input ?? get().query).trim();

      if (!query) {
        return;
      }

      const searchService = service;

      if (!searchService || get().connection !== 'online') {
        set({ searchError: 'Non connecté au réseau Soulseek' });
        return;
      }

      // Pressing Enter twice (or submitting while the same search is running)
      // must not send another FileSearch to the network.
      if (get().searching && get().query === query) {
        return;
      }

      const sequence = ++searchSequence;
      let firstBatch = true;

      // Keep the previous results visible while the new search runs. They are
      // replaced by the first batch of the new search, or cleared when the
      // search ends without a single match.
      set({
        query,
        searching: true,
        searchError: null,
      });

      const watchdog = setTimeout(() => {
        if (sequence !== searchSequence) {
          return;
        }

        searchService.cancelSearch();
        set({ searching: false });
      }, 25000);

      try {
        const results = await searchService.search(
          query,
          hits => {
            if (sequence !== searchSequence) {
              return;
            }

            if (firstBatch) {
              firstBatch = false;
              set({ hits: mergeHits([], hits) });
            } else {
              set(state => ({ hits: mergeHits(state.hits, hits) }));
            }
          },
          20000,
        );

        if (sequence !== searchSequence) {
          return;
        }

        if (firstBatch) {
          set({ hits: [], searching: false });
        } else {
          set(state => ({
            hits: mergeHits(state.hits, results),
            searching: false,
          }));
        }
      } catch (error) {
        if (sequence === searchSequence) {
          set({ searching: false, searchError: errorMessage(error) });
        }
      } finally {
        clearTimeout(watchdog);
      }
    },

    cancelSearch: () => {
      searchSequence++;
      service?.cancelSearch();
      set({ searching: false });
    },

    playHit: async hit => {
      if (!service) {
        return;
      }

      if (!isStreamableFile(hit.filename)) {
        set({ notice: 'Seuls les fichiers MP3 sont proposés par SoulStream.' });
        return;
      }

      const sequence = ++playSequence;
      const settings = get().settings;
      const bufferTarget = bufferTargetFor(hit.size, settings.bufferMb);

      try {
        await ensurePlayer();
        set({ playerReady: true });
        await requestNotificationPermission();
        await resetPlayer();

        if (sequence !== playSequence) {
          return;
        }

        service.cancelActive();
        const prepared = service.prepareStream(hit);

        set({
          tab: 'player',
          current: {
            hit,
            transferId: prepared.transferId,
            url: prepared.url,
            phase: 'preparing',
            error: null,
            bufferTarget,
          },
        });

        await waitForBuffer(prepared.transferId, bufferTarget, sequence);

        if (sequence !== playSequence) {
          return;
        }

        await TrackPlayer.add({
          id: prepared.transferId,
          url: prepared.url,
          title: displayTitle(hit.filename),
          artist: displayArtist(hit) ?? hit.username,
          album: hit.username,
          duration: hit.durationSec,
          contentType: contentTypeFor(hit.filename),
        });

        await TrackPlayer.play();

        if (sequence === playSequence) {
          set(state => ({
            current: state.current ? { ...state.current, phase: 'playing' } : null,
          }));
        }
      } catch (error) {
        if (sequence !== playSequence) {
          return;
        }

        service.cancelActive();
        set(state => ({
          playerReady: state.playerReady,
          current: state.current
            ? { ...state.current, phase: 'error', error: errorMessage(error) }
            : null,
        }));
      }
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
      set({ current: null });
    },

    dismissNotice: () => set({ notice: null }),
  };
});
