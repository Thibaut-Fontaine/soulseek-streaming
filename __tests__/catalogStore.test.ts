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
import { setCatalogProvider } from '../src/state/store';
import type { CatalogProvider } from '../src/core/catalog';
import type { CatalogTrack } from '../src/core/catalogTypes';

jest.setTimeout(30000);

const ART = { small: 's.jpg', medium: 'm.jpg', large: 'l.jpg' };

function track(id: string, title: string, durationSec: number, artist = 'Fake Artist'): CatalogTrack {
  return {
    id,
    title,
    titleShort: title,
    version: '',
    artist: { id: 'dz:1', name: artist },
    contributors: [],
    album: { id: 'dz:100', title: 'Album', cover: ART },
    durationSec,
    explicit: false,
  };
}

const STREAM_ME = track('dz:11', 'Stream Me', 200);
const MISSING = track('dz:12', 'Nowhere To Be Found', 180);
const TRACK = 'Music\\Fake Artist\\Album\\01 - Stream Me.mp3';
const SPAM = 'Music\\Someone Else\\Album\\Totally Unrelated.mp3';

const fakeCatalog: CatalogProvider = {
  name: 'fake',
  search: async query => ({ query, tracks: [STREAM_ME, MISSING], artists: [], albums: [] }),
  searchTracks: async () => [STREAM_ME],
  artist: async () => {
    throw new Error('unused');
  },
  album: async id => ({
    album: {
      id,
      title: 'Album',
      cover: ART,
      artist: { id: 'dz:1', name: 'Fake Artist' },
      kind: 'album',
      releaseDate: '2020-01-01',
    },
    tracks: [STREAM_ME, MISSING],
    moreByArtist: [],
  }),
  genre: async () => {
    throw new Error('unused');
  },
  browse: async () => ({ chartTracks: [STREAM_ME], chartAlbums: [], chartArtists: [], genres: [] }),
  artistRadio: async () => [MISSING, STREAM_ME],
};

async function withNetwork(peers: FakePeer[], run: (network: MultiPeerNetwork) => Promise<void>) {
  const network = new MultiPeerNetwork(peers);
  await network.start();
  setCatalogProvider(fakeCatalog);
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
      catalogEnabled: true,
    },
    resolutions: {},
    hitTracks: {},
    groups: [],
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

describe('catalog search and playback', () => {
  test('search results become one card per catalog track, playable directly', async () => {
    await withNetwork(
      [
        { username: 'peer_a', filename: TRACK, behavior: 'ok' },
        { username: 'peer_b', filename: TRACK, behavior: 'ok', avgSpeed: 10_000 },
        { username: 'peer_c', filename: SPAM, behavior: 'ok' },
      ],
      async network => {
        // A typo: the catalog's spelling is searched on Soulseek as well.
        await useAppStore.getState().runSearch('fake artst stream me');
        const state = useAppStore.getState();

        expect(state.catalogResults?.tracks[0].id).toBe(STREAM_ME.id);
        expect(network.searches).toEqual(['fake artst stream me', 'Fake Artist Stream Me']);
        expect(state.groups[0].track?.id).toBe(STREAM_ME.id);
        expect(state.groups[0].sources.map(source => source.hit.username)).toEqual(['peer_a', 'peer_b']);
        expect(state.groups.some(group => group.track?.id === MISSING.id)).toBe(true);

        await useAppStore.getState().playCatalogTrack(STREAM_ME);
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');

        const current = useAppStore.getState().current!;
        // Known sources were used: no extra search.
        expect(network.searches).toHaveLength(2);
        expect(current.hit.username).toBe('peer_a');
        expect(useAppStore.getState().trackForHit(current.hit)?.id).toBe(STREAM_ME.id);
        expect(useAppStore.getState().library.history[0].catalog?.id).toBe(STREAM_ME.id);
        expect(useAppStore.getState().library.history[0].title).toBe('Stream Me');
      },
    );
  });

  test('an album plays track by track, skipping tracks nobody shares', async () => {
    await withNetwork(
      [{ username: 'peer_a', filename: TRACK, behavior: 'ok' }],
      async network => {
        await useAppStore.getState().playCatalogTrack(MISSING, {
          label: 'Album',
          tracks: [MISSING, STREAM_ME],
          index: 0,
        });
        await waitFor(() => useAppStore.getState().current?.phase === 'playing');

        const state = useAppStore.getState();
        expect(state.resolutions[MISSING.id].status).toBe('none');
        expect(state.resolutions[STREAM_ME.id].status).toBe('found');
        expect(state.catalogContext?.index).toBe(1);
        expect(state.current?.hit.filename).toBe(TRACK);
        expect(network.searches).toContain('Fake Artist Nowhere To Be Found');
        expect(network.searches).toContain('Fake Artist Stream Me');
      },
    );
  });

  test('a wrong length is not accepted as the track', async () => {
    await withNetwork(
      [{ username: 'peer_a', filename: TRACK, behavior: 'ok', durationSec: 420 }],
      async () => {
        const resolution = await useAppStore.getState().resolveTrack(STREAM_ME);
        expect(resolution.status).toBe('none');
      },
    );
  });

  test('pages load from the catalog and the browse tab caches its data', async () => {
    await useAppStore.getState().loadBrowse();
    expect(useAppStore.getState().browse).toMatchObject({ status: 'ready' });

    useAppStore.getState().openPage({ kind: 'album', id: 'dz:100' });
    await waitFor(() => useAppStore.getState().albumPages['dz:100']?.status === 'ready');
    expect(useAppStore.getState().pages).toHaveLength(1);
    expect(useAppStore.getState().closePage()).toBe(true);
    expect(useAppStore.getState().closePage()).toBe(false);

    useAppStore.getState().openPage({ kind: 'artist', id: 'dz:1' });
    await waitFor(() => useAppStore.getState().artistPages['dz:1']?.status === 'error');
  });
});
