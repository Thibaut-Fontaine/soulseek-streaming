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
jest.mock('../src/transport/rnTcpTransport', () => ({
  ReactNativeTransport: jest.requireActual('../src/transport/nodeTransport').NodeTransport,
}));

import { playbackLimits, playbackTimeouts, useAppStore } from '../src/state/store';

jest.setTimeout(30000);

const TRACK = 'Music\\Fake Artist\\Album\\01 - Stream Me.mp3';

beforeAll(() => {
  playbackTimeouts.reachPeerMs = 3000;
  // Longer than the 5 s rule on purpose: only the start deadline may move on.
  playbackTimeouts.acceptFreeSlotMs = 20000;
  playbackTimeouts.acceptNoSlotMs = 20000;
  playbackTimeouts.openFileMs = 3000;
  playbackTimeouts.startMs = 900;
  playbackLimits.freshSearchMs = 1200;
});

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
        setTimeout(tick, 25);
      }
    };
    tick();
  });
}

async function searchAndPlay(): Promise<void> {
  await useAppStore.getState().runSearch('fake artist stream me');
  const best = useAppStore.getState().results[0]?.hit;
  expect(best).toBeDefined();
  await useAppStore.getState().playTrack(best!);
}

describe('automatic peer fallback', () => {
  test(
    'a peer that sends no bytes is dropped at the start deadline',
    async () => {
      await withNetwork(
        [
          { username: 'queued', filename: TRACK, behavior: 'silent', avgSpeed: 5_000_000 },
          { username: 'steady', filename: TRACK, behavior: 'ok', avgSpeed: 50_000 },
        ],
        async network => {
          await searchAndPlay();

          await waitFor(() => useAppStore.getState().current?.phase === 'playing');
          expect(useAppStore.getState().current?.hit.username).toBe('steady');
          expect(network.queueRequests).toEqual(['queued', 'steady']);
        },
      );
    },
    12000,
  );

  test('a peer reporting too many megabytes is skipped', async () => {
    await withNetwork(
      [
        {
          username: 'full',
          filename: TRACK,
          behavior: 'deny',
          denyReason: 'Too many megabytes',
          avgSpeed: 5_000_000,
        },
        { username: 'roomy', filename: TRACK, behavior: 'ok', avgSpeed: 50_000 },
      ],
      async network => {
        await searchAndPlay();
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');

        expect(useAppStore.getState().current?.hit.username).toBe('roomy');
        expect(network.queueRequests).toEqual(['full', 'roomy']);
      },
    );
  });

  test('searches again for another peer when no known source is left', async () => {
    await withNetwork(
      [
        { username: 'denier', filename: TRACK, behavior: 'deny', avgSpeed: 5_000_000 },
        // Only answers the second search, like a peer that just came online.
        { username: 'late', filename: TRACK, behavior: 'ok', avgSpeed: 50_000, skipSearches: 1 },
      ],
      async network => {
        await searchAndPlay();
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');

        expect(useAppStore.getState().current?.hit.username).toBe('late');
        expect(network.queueRequests).toEqual(['denier', 'late']);
        expect(network.searches.length).toBe(2);
      },
    );
  });

  test('tries every peer found by the recovery search', async () => {
    await withNetwork(
      [
        { username: 'denier', filename: TRACK, behavior: 'deny', avgSpeed: 5_000_000 },
        // Both answer only the recovery search; the first also refuses.
        { username: 'late-no', filename: TRACK, behavior: 'deny', skipSearches: 1 },
        { username: 'late-ok', filename: TRACK, behavior: 'ok', skipSearches: 1, avgSpeed: 50_000 },
      ],
      async network => {
        await searchAndPlay();
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');

        expect(useAppStore.getState().current?.hit.username).toBe('late-ok');
        expect(network.queueRequests).toEqual(['denier', 'late-no', 'late-ok']);
        expect(network.searches.length).toBe(2);
      },
    );
  });

  test('shows one final error, without retrying denied peers', async () => {
    await withNetwork(
      [
        { username: 'no1', filename: TRACK, behavior: 'deny' },
        { username: 'no2', filename: TRACK, behavior: 'deny' },
      ],
      async network => {
        await searchAndPlay();
        await waitFor(() => useAppStore.getState().current?.phase === 'error');

        expect(useAppStore.getState().current?.error).toMatch(/2 sources essayées/);
        expect(network.queueRequests).toEqual(['no1', 'no2']);
        // One typed search and one fresh search: no endless loop.
        expect(network.searches.length).toBe(2);
      },
    );
  });

  test('stopping playback cancels the attempt and starts no search', async () => {
    await withNetwork(
      [{ username: 'silent', filename: TRACK, behavior: 'silent', avgSpeed: 5_000_000 }],
      async network => {
        await useAppStore.getState().runSearch('fake artist stream me');
        const best = useAppStore.getState().results[0]?.hit;
        expect(best).toBeDefined();
        void useAppStore.getState().playTrack(best!);

        await waitFor(() => network.queueRequests.length === 1);
        await useAppStore.getState().stopPlayback();
        await new Promise(resolve => setTimeout(resolve, 1500));

        expect(useAppStore.getState().current).toBeNull();
        expect(network.searches.length).toBe(1);
        expect(network.queueRequests).toEqual(['silent']);
      },
    );
  });
});
