import TrackPlayer from 'react-native-track-player';

import { TrackCache } from '../src/services/trackCache';
import type { CacheFs } from '../src/services/trackCache';
import type { SearchHit } from '../src/core/types';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
  },
  Event: {},
}));
jest.mock('../src/player/player', () => ({
  ensurePlayer: jest.fn(async () => {}),
  resetPlayer: jest.fn(async () => {}),
}));
jest.mock('../src/services/settings', () => ({
  loadSettings: jest.fn(),
  saveSettings: jest.fn(async () => {}),
  loadCredentials: jest.fn(async () => null),
  saveCredentials: jest.fn(async () => {}),
  clearCredentials: jest.fn(async () => {}),
}));
jest.mock('../src/transport/rnTcpTransport', () => ({
  ReactNativeTransport: jest.requireActual('../src/transport/nodeTransport').NodeTransport,
}));

import { setTrackCacheForTests, useAppStore } from '../src/state/store';

function memoryFs(): CacheFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    dir: '/docs/tracks',
    files,
    exists: async path => path === '/docs/tracks' || files.has(path),
    mkdir: async () => {},
    writeBase64: async (path, data) => void files.set(path, data),
    readBase64: async path => files.get(path) ?? '',
    writeText: async (path, data) => void files.set(path, data),
    readText: async path => files.get(path) ?? '',
    unlink: async path => void files.delete(path),
    move: async (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
  };
}

function hit(filename: string, username = 'peer', bitrate = 128): SearchHit {
  return {
    username,
    filename,
    size: 1000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 0,
    queueLength: 0,
    bitrate,
    durationSec: 200,
  };
}

const DOWNLOADED = 'Music\\Fake Artist\\Album\\01 - Stream Me.mp3';

async function cachedTrack(): Promise<TrackCache> {
  const cache = new TrackCache(memoryFs(), 10_000_000);
  await cache.load();
  await cache.save(hit(DOWNLOADED), new Uint8Array(1000).fill(3));
  return cache;
}

beforeEach(() => {
  useAppStore.setState({
    current: null,
    notice: null,
    searchError: null,
    library: { liked: [], history: [], recentSearches: [] },
    connection: 'idle',
  });
  jest.clearAllMocks();
});

afterEach(() => setTrackCacheForTests(null));

describe('playing without a Soulseek connection', () => {
  test('a downloaded track plays from the device, with no service at all', async () => {
    const cache = await cachedTrack();
    setTrackCacheForTests(cache);

    await useAppStore.getState().playHit(hit(DOWNLOADED));

    const current = useAppStore.getState().current;
    expect(current?.phase).toBe('playing');
    expect(current?.source).toBe('cache');
    expect(current?.url).toContain(cache.findByHit(hit(DOWNLOADED))!.file);
    expect(TrackPlayer.add).toHaveBeenCalledTimes(1);
    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().library.history[0].hit.filename).toBe(DOWNLOADED);
  });

  test('an imported file plays from the device, with no service at all', async () => {
    const fs = memoryFs();
    const cache = new TrackCache(fs, 10_000_000);
    await cache.load();
    fs.files.set('/phone/Ma chanson.mp3', 'data');
    const result = await cache.importFile('/phone/Ma chanson.mp3', 'Ma chanson.mp3', 512);
    expect(result.status).toBe('added');

    setTrackCacheForTests(cache);
    await useAppStore.getState().playHit(hit('Ma chanson.mp3', ''));

    expect(useAppStore.getState().current?.phase).toBe('playing');
    expect(useAppStore.getState().current?.source).toBe('cache');
    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
  });

  test('a track that is not on the device shows a clear offline error', async () => {
    const cache = await cachedTrack();
    setTrackCacheForTests(cache);

    await useAppStore.getState().playHit(hit('Music\\Other\\02 - Nowhere.mp3'));

    expect(useAppStore.getState().current).toBeNull();
    expect(useAppStore.getState().notice).toMatch(/pas téléchargé|hors ligne/i);
    expect(TrackPlayer.play).not.toHaveBeenCalled();
  });
});
