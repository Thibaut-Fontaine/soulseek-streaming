import { MultiPeerNetwork } from '../test-utils/multiPeerNetwork';
import type { FakePeer } from '../test-utils/multiPeerNetwork';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
  },
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
// The app's TCP transport is react-native-tcp-socket; tests use node:net.
jest.mock('../src/transport/rnTcpTransport', () => ({
  ReactNativeTransport: jest.requireActual('../src/transport/nodeTransport').NodeTransport,
}));

import { playbackTimeouts, useAppStore } from '../src/state/store';

jest.setTimeout(30000);

const TRACK = 'Music\\Fake Artist\\Album\\01 - Stream Me.mp3';

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
    },
  });

  try {
    expect(await useAppStore.getState().login('tester', 'secret')).toBe(true);
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
  playbackTimeouts.reachPeerMs = 4000;
  playbackTimeouts.acceptFreeSlotMs = 1500;
  playbackTimeouts.acceptNoSlotMs = 1500;
  playbackTimeouts.openFileMs = 4000;
});

describe('playback with source fallback', () => {
  test('falls back when the best peer refuses us', async () => {
    await withNetwork(
      [
        { username: 'fast_denier', filename: TRACK, behavior: 'deny', avgSpeed: 5_000_000 },
        { username: 'slow_ok', filename: TRACK, behavior: 'ok', avgSpeed: 50_000 },
      ],
      async network => {
        await useAppStore.getState().runSearch('fake artist stream me');
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');

        const current = useAppStore.getState().current!;
        expect(network.queueRequests).toEqual(['fast_denier', 'slow_ok']);
        expect(current.hit.username).toBe('slow_ok');
        expect(current.attempt).toBe(2);
        expect(current.fallback?.username).toBe('fast_denier');
        expect(useAppStore.getState().results.length).toBe(2);
      },
    );
  });

  test('moves on when a peer never answers', async () => {
    await withNetwork(
      [
        { username: 'ghost', filename: TRACK, behavior: 'silent', avgSpeed: 5_000_000 },
        { username: 'steady', filename: TRACK, behavior: 'ok', avgSpeed: 50_000 },
      ],
      async () => {
        await useAppStore.getState().runSearch('fake artist stream me');
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');
        expect(useAppStore.getState().current?.hit.username).toBe('steady');
      },
    );
  });

  test('reports an error after every source failed', async () => {
    await withNetwork(
      [
        { username: 'no1', filename: TRACK, behavior: 'deny' },
        { username: 'no2', filename: TRACK, behavior: 'deny' },
      ],
      async () => {
        await useAppStore.getState().runSearch('fake artist stream me');
        await waitFor(() => useAppStore.getState().current?.phase === 'error');
        expect(useAppStore.getState().current?.error).toMatch(/2 sources essayées/);
      },
    );
  });
});
