/**
 * Resuming the last playback session: network source, local copy, and a
 * source that disappeared. The native player is faked.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { MultiPeerNetwork } from '../test-utils/multiPeerNetwork';
import type { FakePeer } from '../test-utils/multiPeerNetwork';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
    seekTo: jest.fn(async () => {}),
    getProgress: jest.fn(async () => ({ position: 0, duration: 0 })),
  },
}));
jest.mock('../src/player/player', () => ({
  ensurePlayer: jest.fn(async () => {}),
  resetPlayer: jest.fn(async () => {}),
}));
jest.mock('../src/services/settings', () => ({
  loadSettings: jest.fn(async () => ({
    serverHost: '127.0.0.1',
    serverPort: 1,
    listenPort: 0,
    streamPort: 0,
    bufferMb: 0.25,
    shareEnabled: false,
    shareWifiOnly: true,
    cacheMb: 1024,
    catalogEnabled: false,
    showUploaders: false,
  })),
  saveSettings: jest.fn(async () => {}),
  loadCredentials: jest.fn(async () => null),
  saveCredentials: jest.fn(async () => {}),
  clearCredentials: jest.fn(async () => {}),
}));
jest.mock('../src/transport/rnTcpTransport', () => ({
  ReactNativeTransport: jest.requireActual('../src/transport/nodeTransport').NodeTransport,
}));
// A fake cache: the test drives which entries exist on the device.
jest.mock('../src/services/trackCache', () => {
  const state: { entry: Record<string, unknown> | null } = { entry: null };

  class FakeTrackCache {
    load = jest.fn(async () => {});
    onChange = jest.fn(() => () => {});
    all = jest.fn(() => []);
    asHit = jest.fn((entry: { hit: unknown }) => entry.hit);
    findByHit = jest.fn(
      (candidate: { username: string; filename: string }) =>
        state.entry && (state.entry.hit as { username: string }).username === candidate.username
          ? state.entry
          : null,
    );
    uriFor = jest.fn((entry: { file: string }) => `file:///cache/${entry.file}`);
    markPlayed = jest.fn();
    search = jest.fn(() => []);
    setLimit = jest.fn();
    readMeta = jest.fn(async () => ({ coverUri: null }));
    clear = jest.fn(async () => {});
  }

  return { TrackCache: FakeTrackCache, __cacheState: state };
});

import TrackPlayer from 'react-native-track-player';
import type { SearchHit } from '../src/core/types';
import { hitKey } from '../src/core/types';
import {
  PLAYBACK_SESSION_KEY,
  PLAYBACK_SESSION_VERSION,
  loadSession,
  saveSession,
} from '../src/services/playbackSession';
import type { PlaybackSession } from '../src/services/playbackSession';
import { playbackTimeouts, useAppStore } from '../src/state/store';

jest.setTimeout(30000);

const TRACK = 'Music\\Fake Artist\\Album\\01 - Stream Me.mp3';
const cacheState = (jest.requireMock('../src/services/trackCache') as { __cacheState: { entry: unknown } })
  .__cacheState;

function hit(username: string, filename = TRACK): SearchHit {
  return {
    username,
    filename,
    size: 300_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 50_000,
    queueLength: 0,
    bitrate: 320,
    durationSec: 200,
  };
}

function session(hitValue: SearchHit, overrides: Partial<PlaybackSession> = {}): PlaybackSession {
  return {
    version: PLAYBACK_SESSION_VERSION,
    hit: hitValue,
    source: 'network',
    queue: [hit('queued_peer', 'Music\\Fake Artist\\Album\\02 - Next.mp3')],
    context: { label: 'Recherche « fake artist »', items: [hitValue], index: 0 },
    catalogContext: null,
    shuffle: true,
    repeat: false,
    positionSec: 42.4,
    savedAt: 1,
    ...overrides,
  };
}

function cacheEntry(hitValue: SearchHit) {
  return {
    sharedPath: `SoulStream\\${hitValue.filename.split('\\').pop()}`,
    file: 'local.mp3',
    size: hitValue.size,
    sourceKey: hitKey(hitValue),
    sourceFilename: hitValue.filename,
    addedAt: 1,
    lastPlayedAt: 1,
    hit: hitValue,
  };
}

async function withNetwork(peers: FakePeer[], run: (network: MultiPeerNetwork) => Promise<void>) {
  const network = new MultiPeerNetwork(peers);
  await network.start();
  useAppStore.setState({
    settings: {
      serverHost: '127.0.0.1',
      serverPort: network.serverPort,
      listenPort: 0,
      streamPort: 0,
      bufferMb: 0.25,
      shareEnabled: false,
      shareWifiOnly: true,
      cacheMb: 1024,
      catalogEnabled: false,
      showUploaders: false,
    },
  });

  try {
    await run(network);
  } finally {
    await useAppStore.getState().logout();
    await network.stop();
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('waitFor timed out'));
      } else {
        setTimeout(tick, 50);
      }
    };
    tick();
  });
}

beforeAll(() => {
  playbackTimeouts.reachPeerMs = 2000;
  playbackTimeouts.acceptFreeSlotMs = 1500;
  playbackTimeouts.acceptNoSlotMs = 1500;
  playbackTimeouts.openFileMs = 2000;
});

beforeEach(async () => {
  cacheState.entry = null;
  await AsyncStorage.removeItem(PLAYBACK_SESSION_KEY);
  (TrackPlayer.seekTo as jest.Mock).mockClear();
});

test('restores the track, queue and context, and seeks to the saved second', async () => {
  await withNetwork([{ username: 'peer_restore', filename: TRACK, behavior: 'ok', avgSpeed: 50_000 }], async () => {
    const saved = hit('peer_restore');
    await saveSession(session(saved));

    expect(await useAppStore.getState().login('tester', 'secret', 'saved')).toBe(true);
    await waitFor(() => useAppStore.getState().current?.phase === 'playing');

    const state = useAppStore.getState();
    expect(state.current?.hit.filename).toBe(TRACK);
    expect(state.current?.hit.username).toBe('peer_restore');
    expect(state.queue[0].username).toBe('queued_peer');
    expect(state.context?.label).toBe('Recherche « fake artist »');
    expect(state.shuffle).toBe(true);
    expect(TrackPlayer.seekTo).toHaveBeenCalledTimes(1);
    expect((TrackPlayer.seekTo as jest.Mock).mock.calls[0][0]).toBeCloseTo(42.4, 5);
  });
});

test('prefers the copy already on the device, without the network', async () => {
  // `init` creates the track cache the app uses on a real launch.
  await useAppStore.getState().init();

  await withNetwork([], async () => {
    const saved = hit('peer_cache');
    cacheState.entry = cacheEntry(saved);
    await saveSession(session(saved, { source: 'cache', positionSec: 12.6 }));

    expect(await useAppStore.getState().login('tester', 'secret', 'saved')).toBe(true);
    await waitFor(() => useAppStore.getState().current?.phase === 'playing');

    const state = useAppStore.getState();
    expect(state.current?.source).toBe('cache');
    expect(state.current?.url).toBe('file:///cache/local.mp3');
    expect((TrackPlayer.seekTo as jest.Mock).mock.calls[0][0]).toBeCloseTo(12.6, 5);
  });
});

test('drops a session whose source disappeared, with a clear notice', async () => {
  await withNetwork([], async () => {
    await saveSession(session(hit('gone_peer')));

    expect(await useAppStore.getState().login('tester', 'secret', 'saved')).toBe(true);
    await waitFor(() => /plus disponible|disparu|reprendre/i.test(useAppStore.getState().notice ?? ''));

    const state = useAppStore.getState();
    expect(state.current).toBeNull();
    expect(await loadSession()).toBeNull();
  });
});

test('explicit logout deletes the resume point', async () => {
  await withNetwork([{ username: 'peer_restore', filename: TRACK, behavior: 'ok', avgSpeed: 50_000 }], async () => {
    await saveSession(session(hit('peer_restore')));

    expect(await useAppStore.getState().login('tester', 'secret', 'saved')).toBe(true);
    await waitFor(() => useAppStore.getState().current?.phase === 'playing');
    await useAppStore.getState().logout();

    expect(await loadSession()).toBeNull();
  });
});
