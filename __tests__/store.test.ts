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
      shareEnabled: false,
      shareWifiOnly: true,
      cacheMb: 1024,
      catalogEnabled: false,
      showUploaders: false,
      logUploadEnabled: false,
      autoplayEnabled: false,
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

/** Search, check nothing played by itself, then pick the top result. */
async function searchAndPickBest(): Promise<void> {
  await useAppStore.getState().runSearch('fake artist stream me');
  expect(useAppStore.getState().current).toBeNull();
  const best = useAppStore.getState().results[0]?.hit;
  expect(best).toBeDefined();
  await useAppStore.getState().playTrack(best!);
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
        await searchAndPickBest();
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
        await searchAndPickBest();
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');
        expect(useAppStore.getState().current?.hit.username).toBe('steady');
      },
    );
  });

  test('never falls back to another song with a close title', async () => {
    await withNetwork(
      [
        { username: 'no1', filename: 'Music\\Fake Artist\\Album\\03 - Stream Me 3.mp3', behavior: 'deny' },
        { username: 'part1', filename: 'Music\\Fake Artist\\Album\\01 - Stream Me 1.mp3', behavior: 'ok' },
      ],
      async network => {
        await useAppStore.getState().runSearch('fake artist stream me');
        const wanted = useAppStore
          .getState()
          .results.find(ranked => ranked.hit.username === 'no1')!.hit;
        await useAppStore.getState().playTrack(wanted);
        await waitFor(() => useAppStore.getState().current?.phase === 'error');

        expect(network.queueRequests).toEqual(['no1']);
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
        await searchAndPickBest();
        await waitFor(() => useAppStore.getState().current?.phase === 'error');
        expect(useAppStore.getState().current?.error).toMatch(/2 sources essayées/);
      },
    );
  });
});

describe('search and library', () => {
  test('a search lists results but never starts playback', async () => {
    await withNetwork(
      [{ username: 'only_peer', filename: TRACK, behavior: 'ok' }],
      async network => {
        await useAppStore.getState().runSearch('fake artist stream me');
        const state = useAppStore.getState();
        expect(state.results.map(r => r.hit.username)).toEqual(['only_peer']);
        expect(state.current).toBeNull();
        expect(network.queueRequests).toEqual([]);
        expect(state.library.recentSearches[0]).toBe('fake artist stream me');
      },
    );
  });

  test('playing records history, likes toggle, next follows the queue', async () => {
    const OTHER = 'Music\\Fake Artist\\Album\\02 - Second Song.mp3';
    await withNetwork(
      [
        { username: 'peer_a', filename: TRACK, behavior: 'ok' },
        { username: 'peer_b', filename: OTHER, behavior: 'ok' },
      ],
      async () => {
        await useAppStore.getState().runSearch('fake artist');
        const hits = useAppStore.getState().results.map(r => r.hit);
        const first = hits.find(hit => hit.filename === TRACK)!;
        const second = hits.find(hit => hit.filename === OTHER)!;

        useAppStore.getState().enqueue(second);
        await useAppStore.getState().playTrack(first);
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');
        expect(useAppStore.getState().library.history[0].hit.filename).toBe(TRACK);

        useAppStore.getState().toggleLike(first);
        expect(useAppStore.getState().library.liked).toHaveLength(1);
        useAppStore.getState().toggleLike(first);
        expect(useAppStore.getState().library.liked).toHaveLength(0);

        await useAppStore.getState().playNext();
        await waitFor(
          () =>
            useAppStore.getState().current?.hit.filename === OTHER &&
            useAppStore.getState().current?.phase === 'playing',
        );
        expect(useAppStore.getState().queue).toHaveLength(0);
        expect(useAppStore.getState().library.history.map(t => t.hit.filename)).toEqual([OTHER, TRACK]);
      },
    );
  });
});

describe('login without network', () => {
  async function closedPort(): Promise<number> {
    const net = jest.requireActual<typeof import('node:net')>('node:net');
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
  }

  beforeEach(async () => {
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        serverHost: '127.0.0.1',
        serverPort: await closedPort(),
        listenPort: 0,
      },
    });
  });

  afterEach(() => useAppStore.getState().logout());

  test('stored credentials keep the user in the app, offline', async () => {
    expect(await useAppStore.getState().login('tester', 'secret', 'saved')).toBe(false);

    expect(useAppStore.getState().username).toBe('tester');
    // The client stays alive and keeps retrying: the app must not need a
    // restart when the network comes back.
    expect(useAppStore.getState().connection).toBe('reconnecting');
  });

  test('credentials typed on the login screen stay there', async () => {
    expect(await useAppStore.getState().login('tester', 'secret')).toBe(false);

    expect(useAppStore.getState().username).toBeNull();
    expect(useAppStore.getState().prefillUsername).toBe('tester');
  });
});
