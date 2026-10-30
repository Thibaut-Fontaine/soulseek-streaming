/**
 * Bridge between Android Auto and the existing player (feature 8).
 *
 * The native MediaBrowserService owns the car session. It reads a JSON
 * snapshot built here (library, device, cache) and sends transport commands
 * back through a NativeEventEmitter; this module maps them to the same Zustand
 * actions and TrackPlayer calls as the in-app controls.
 */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import TrackPlayer from 'react-native-track-player';

import { buildAutoBrowseTree, deviceAutoId, savedAutoId } from '../core/autoBrowse';
import type { AutoFolder } from '../core/autoBrowse';
import { trackArtists } from '../core/catalog';
import { hitKey } from '../core/types';
import { useAppStore } from '../state/store';

interface AutoNativeModule {
  update(treeJson: string, playbackJson: string): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

interface AutoCommand {
  action?: string;
  mediaId?: string;
  positionMs?: number;
}

const EVENT = 'SoulStreamAutoCommand';
const SYNC_INTERVAL_MS = 2000;

let snapshot: AutoFolder | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncAt = 0;
let syncing: Promise<void> | null = null;

function nativeModule(): AutoNativeModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  return (NativeModules.SoulStreamAuto as AutoNativeModule | undefined) ?? null;
}

function scheduleSync(): void {
  if (syncTimer !== null) {
    return;
  }
  const wait = Math.max(0, SYNC_INTERVAL_MS - (Date.now() - lastSyncAt));
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void sync();
  }, wait);
}

async function sync(): Promise<void> {
  const native = nativeModule();
  if (!native) {
    return;
  }
  if (syncing) {
    return;
  }

  syncing = (async () => {
    const state = useAppStore.getState();
    const tree = buildAutoBrowseTree({
      library: state.library,
      device: state.device,
      hitTracks: state.hitTracks,
    });
    snapshot = tree;

    let positionMs = 0;
    try {
      const progress = await TrackPlayer.getProgress();
      positionMs = Math.round((progress.position ?? 0) * 1000);
    } catch {
      // The player may not be set up yet.
    }

    const current = state.current;
    const catalog = current ? state.hitTracks[hitKey(current.hit)] : undefined;
    const playback = {
      playing: current?.phase === 'playing',
      positionMs,
      title: catalog?.title ?? '',
      artist: catalog ? trackArtists(catalog) : '',
      album: catalog?.album?.title ?? '',
      artworkUri: catalog?.album?.cover.big ?? catalog?.album?.cover.large ?? '',
      durationMs: (current?.hit.durationSec ?? catalog?.durationSec ?? 0) * 1000,
    };

    lastSyncAt = Date.now();
    try {
      await native.update(JSON.stringify(tree), JSON.stringify(playback));
    } catch {
      // Auto is optional: never disturb playback.
    }
  })();

  try {
    await syncing;
  } finally {
    syncing = null;
  }
}

async function playMediaId(mediaId: string): Promise<void> {
  const state = useAppStore.getState();
  const liked = state.library.liked;
  const history = state.library.history;
  const device = state.device;

  const likedIndex = liked.findIndex(saved => savedAutoId('liked', saved.key) === mediaId);
  if (likedIndex >= 0) {
    await state.playTrack(liked[likedIndex].hit, {
      label: 'Titres likés',
      items: liked.map(saved => saved.hit),
      index: likedIndex,
    });
    return;
  }

  const historyIndex = history.findIndex(saved => savedAutoId('history', saved.key) === mediaId);
  if (historyIndex >= 0) {
    await state.playTrack(history[historyIndex].hit, {
      label: 'Écoutés récemment',
      items: history.map(saved => saved.hit),
      index: historyIndex,
    });
    return;
  }

  const deviceIndex = device.findIndex(hit => deviceAutoId(hit) === mediaId);
  if (deviceIndex >= 0) {
    await state.playTrack(device[deviceIndex], {
      label: 'Sur l’appareil',
      items: device,
      index: deviceIndex,
    });
    return;
  }

  useAppStore.setState({ notice: 'Ce morceau n’est plus disponible.' });
}

async function handleCommand(command: AutoCommand): Promise<void> {
  const state = useAppStore.getState();
  switch (command.action) {
    case 'play_from_id':
      if (command.mediaId) {
        await playMediaId(command.mediaId);
      }
      return;
    case 'play':
      await TrackPlayer.play().catch(() => {});
      return;
    case 'pause':
      await TrackPlayer.pause().catch(() => {});
      return;
    case 'next':
      await state.playNext();
      return;
    case 'previous':
      await state.playPrevious(0);
      return;
    case 'seek':
      await TrackPlayer.seekTo(Math.max(0, (command.positionMs ?? 0) / 1000)).catch(() => {});
      return;
    case 'stop':
      await state.stopPlayback();
      return;
    default:
      return;
  }
}

/** Installs the bridge; call once from the app root. Returns a cleanup. */
export function startAndroidAuto(): () => void {
  const native = nativeModule();
  if (!native) {
    return () => {};
  }

  const emitter = new NativeEventEmitter(native as never);
  const subscription = emitter.addListener(EVENT, (command: AutoCommand) => {
    void handleCommand(command);
  });
  const unsubscribeStore = useAppStore.subscribe(() => scheduleSync());

  scheduleSync();

  return () => {
    subscription.remove();
    unsubscribeStore();
    if (syncTimer !== null) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    snapshot = null;
  };
}

/** Exposed for a future native test / debug screen; null before the first sync. */
export function currentAutoSnapshot(): AutoFolder | null {
  return snapshot;
}
