import { MultiPeerNetwork } from '../test-utils/multiPeerNetwork';
import type { FakePeer } from '../test-utils/multiPeerNetwork';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
    updateMetadataForTrack: jest.fn(async () => {}),
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
  ReactNativeTransport: jest.requireActual('../src/transport/nodeTransport')
    .NodeTransport,
}));

import { playbackTimeouts, useAppStore } from '../src/state/store';
import { setCatalogProvider } from '../src/state/store';
import type { CatalogProvider } from '../src/core/catalog';
import type { CatalogTrack } from '../src/core/catalogTypes';
import TrackPlayer from 'react-native-track-player';

jest.setTimeout(30000);

const ART = { small: 's.jpg', medium: 'm.jpg', large: 'l.jpg' };

function track(
  id: string,
  title: string,
  durationSec: number,
  artist = 'Fake Artist',
): CatalogTrack {
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
  search: async query => ({
    query,
    tracks: [STREAM_ME, MISSING],
    artists: [],
    albums: [],
  }),
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
  artistWithRelated: async id => ({
    artist: { id, name: 'Fake Artist', picture: ART },
    related: [
      { id: 'dz:2', name: 'Similar One', picture: ART },
      { id, name: 'Fake Artist', picture: ART },
    ],
  }),
  artistRadio: async () => [MISSING, STREAM_ME],
  // Like Deezer's /track: the only answer that names every artist.
  track: async id => ({
    ...(id === STREAM_ME.id ? STREAM_ME : MISSING),
    contributors: [{ id: 'dz:9', name: 'Guest Star' }],
  }),
};

async function withNetwork(
  peers: FakePeer[],
  run: (network: MultiPeerNetwork) => Promise<void>,
) {
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
      showUploaders: false,
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
        {
          username: 'peer_b',
          filename: TRACK,
          behavior: 'ok',
          avgSpeed: 10_000,
        },
        { username: 'peer_c', filename: SPAM, behavior: 'ok' },
      ],
      async network => {
        // A catalog search alone sends nothing to Soulseek.
        await useAppStore.getState().runSearch('fake artst stream me');
        expect(network.searches).toEqual([]);
        expect(useAppStore.getState().fileSearch).toBe('idle');
        expect(useAppStore.getState().groups[0].track?.id).toBe(STREAM_ME.id);

        // The user asks for the files too. A typo: the catalog's spelling is
        // searched on Soulseek as well.
        await useAppStore.getState().searchFilesToo();
        const state = useAppStore.getState();

        expect(state.fileSearch).toBe('done');
        expect(state.catalogResults?.tracks[0].id).toBe(STREAM_ME.id);
        expect([...network.searches].sort()).toEqual(['fake artist stream me', 'fake artst stream me']);
        expect(state.groups[0].track?.id).toBe(STREAM_ME.id);
        expect(
          state.groups[0].sources.map(source => source.hit.username),
        ).toEqual(['peer_a', 'peer_b']);
        expect(state.groups.some(group => group.track?.id === MISSING.id)).toBe(
          true,
        );

        await useAppStore.getState().playCatalogTrack(STREAM_ME);
        await waitFor(
          () => useAppStore.getState().current?.phase === 'playing',
        );

        const current = useAppStore.getState().current!;
        // Known sources were used: no extra search.
        expect(network.searches).toHaveLength(2);
        expect(current.hit.username).toBe('peer_a');
        expect(useAppStore.getState().trackForHit(current.hit)?.id).toBe(
          STREAM_ME.id,
        );
        expect(useAppStore.getState().library.history[0].catalog?.id).toBe(
          STREAM_ME.id,
        );
        expect(useAppStore.getState().library.history[0].title).toBe(
          'Stream Me',
        );

        // The notification names the catalog track, not the peer.
        expect(TrackPlayer.add).toHaveBeenLastCalledWith(
          expect.objectContaining({ title: 'Stream Me', artist: 'Fake Artist', album: 'Album' }),
        );
        // Then every artist, once the full track arrived.
        await waitFor(() => useAppStore.getState().trackForHit(current.hit)?.contributors.length === 1);
        expect(TrackPlayer.updateMetadataForTrack).toHaveBeenLastCalledWith(
          0,
          expect.objectContaining({ artist: 'Fake Artist, Guest Star' }),
        );
        expect(useAppStore.getState().library.history[0].artist).toBe('Fake Artist, Guest Star');
      },
    );
  });

  test('a shared link plays its track; without the catalog it searches', async () => {
    await withNetwork([{ username: 'peer_a', filename: TRACK, behavior: 'ok' }], async network => {
      await useAppStore.getState().openShared({ kind: 'track', id: STREAM_ME.id, query: 'fake artist stream me' });
      await waitFor(() => useAppStore.getState().current?.phase === 'playing');
      const current = useAppStore.getState().current!;
      expect(useAppStore.getState().trackForHit(current.hit)?.id).toBe(STREAM_ME.id);
      // Fetched in full by the link: every artist, no second request needed.
      expect(useAppStore.getState().trackForHit(current.hit)?.contributors).toHaveLength(1);

      await useAppStore.getState().stopPlayback();
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, catalogEnabled: false } });
      await useAppStore.getState().openShared({ kind: 'track', id: STREAM_ME.id, query: 'fake artist stream me' });
      expect(useAppStore.getState().tab).toBe('search');
      expect(network.searches).toContain('fake artist stream me');
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, catalogEnabled: true } });
    });
  });

  test('stopping while sources are searched cancels the track', async () => {
    await withNetwork(
      [{ username: 'peer_a', filename: TRACK, behavior: 'ok' }],
      async () => {
        const playing = useAppStore.getState().playCatalogTrack(STREAM_ME);
        await waitFor(() => useAppStore.getState().resolutions[STREAM_ME.id]?.status === 'searching');

        await useAppStore.getState().stopPlayback();
        await playing;

        expect(useAppStore.getState().current).toBeNull();
        expect(useAppStore.getState().catalogPending).toBeNull();
      },
    );
  });

  test('stopping a list track does not search the next one', async () => {
    await withNetwork(
      [{ username: 'peer_a', filename: TRACK, behavior: 'ok' }],
      async network => {
        // Known sources: playing needs no search, so any search is the next track's.
        await useAppStore.getState().runSearch('fake artist stream me');
        await useAppStore.getState().searchFilesToo();
        const searches = network.searches.length;

        const playing = useAppStore.getState().playCatalogTrack(STREAM_ME, {
          label: 'Album',
          tracks: [STREAM_ME, MISSING],
          index: 0,
        });
        await waitFor(() => useAppStore.getState().current?.phase === 'preparing');
        await useAppStore.getState().stopPlayback();
        await playing;

        expect(useAppStore.getState().resolutions[MISSING.id]?.status).not.toBe('searching');
        expect(network.searches).toHaveLength(searches);
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
        await waitFor(
          () => useAppStore.getState().current?.phase === 'playing',
        );

        const state = useAppStore.getState();
        expect(state.resolutions[MISSING.id].status).toBe('none');
        expect(state.resolutions[STREAM_ME.id].status).toBe('found');
        expect(state.catalogContext?.index).toBe(1);
        expect(state.current?.hit.filename).toBe(TRACK);
        expect(network.searches).toContain('fake artist nowhere to be found -live -karaoke -instrumental -remix');
        expect(network.searches).toContain('fake artist stream me -live -karaoke -instrumental -remix');
      },
    );
  });

  test('queue, then back to an album track nobody shares (crash report)', async () => {
    const OTHER = 'Music\\Fake Artist\\Album\\02 - Other Song.mp3';
    const OTHER_SONG = track('dz:13', 'Other Song', 200);
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    process.on('unhandledRejection', onError);
    process.on('uncaughtException', onError);

    try {
      await withNetwork(
        [
          { username: 'peer_a', filename: TRACK, behavior: 'ok' },
          { username: 'peer_b', filename: OTHER, behavior: 'ok' },
        ],
        async network => {
          // Album: Stream Me, then a track nobody shares, then Other Song.
          const album = { label: 'Album', tracks: [STREAM_ME, MISSING, OTHER_SONG], index: 0 };
          await useAppStore.getState().playCatalogTrack(STREAM_ME, album);
          await waitFor(() => useAppStore.getState().current?.phase === 'playing');
          await waitFor(() => useAppStore.getState().resolutions[MISSING.id]?.status === 'none');

          // The user queues another song, which plays next.
          useAppStore.getState().enqueueCatalogTrack(OTHER_SONG);
          await waitFor(() => useAppStore.getState().queue.length === 1);
          await useAppStore.getState().playNext();
          await waitFor(
            () =>
              useAppStore.getState().current?.hit.filename === OTHER &&
              useAppStore.getState().current?.phase === 'playing',
          );

          // Back to the album: the next track is known to have no source.
          // It is skipped at once (no second search) and the album goes on.
          const searchesBefore = network.searches.length;
          const started = Date.now();
          await useAppStore.getState().playNext();
          await waitFor(
            () =>
              useAppStore.getState().catalogContext?.index === 2 &&
              useAppStore.getState().current?.phase === 'playing',
          );

          const state = useAppStore.getState();
          expect(Date.now() - started).toBeLessThan(3000);
          expect(network.searches.slice(searchesBefore)).not.toContain('fake artist nowhere to be found -live -karaoke -instrumental -remix');
          expect(state.catalogPending).toBeNull();
          expect(state.resolutions[MISSING.id].status).toBe('none');
          expect(state.current?.hit.filename).toBe(OTHER);
        },
      );
    } finally {
      process.off('unhandledRejection', onError);
      process.off('uncaughtException', onError);
    }

    expect(errors).toEqual([]);
  });

  test('a capitalised, accented catalog title is searched in lowercase and without accents', async () => {
    // Deezer writes this title "SYSTÈME D"; the shared file has no accent.
    const SYSTEME = track('dz:14', 'SYSTÈME D', 200, 'Jungle Jack');
    await withNetwork(
      [{ username: 'peer_a', filename: 'Music\\Jungle Jack\\Jungle des illusions vol 2\\05 - Systeme D.mp3', behavior: 'ok' }],
      async network => {
        const resolution = await useAppStore.getState().resolveTrack(SYSTEME);
        expect(network.searches).toEqual(expect.arrayContaining([
          'jungle jack système -live -karaoke -instrumental -remix',
          'jungle jack systeme -live -karaoke -instrumental -remix',
        ]));
        expect(resolution.status).toBe('found');
      },
    );
  });

  test('a dash version and an apostrophe do not hide the file', async () => {
    // The old query was "queen don stop me now 2011": no file has "2011",
    // and "don" is not a word of "Dont".
    const SONG = {
      ...track('dz:15', "Don't Stop Me Now - Remastered 2011", 209, 'Queen'),
      album: { id: 'dz:101', title: 'Jazz (2011 Remaster)', cover: ART },
    };
    await withNetwork(
      [{ username: 'peer_a', filename: 'Music\\Queen\\Jazz\\12 - Dont Stop Me Now.mp3', behavior: 'ok', durationSec: 210, matchQuery: true }],
      async network => {
        const resolution = await useAppStore.getState().resolveTrack(SONG);
        expect(network.searches).toEqual(['queen stop me now -live -karaoke -instrumental -remix']);
        expect(resolution.status).toBe('found');
      },
    );
  });

  test('the album step finds a file whose title is misspelled', async () => {
    const SONG = {
      ...track('dz:16', 'Stream Me', 200),
      album: { id: 'dz:102', title: 'Night Session', cover: ART },
    };
    await withNetwork(
      [{ username: 'peer_a', filename: 'Music\\Fake Artist\\Night Session\\01 - Streem Me.mp3', behavior: 'ok', matchQuery: true }],
      async network => {
        const resolution = await useAppStore.getState().resolveTrack(SONG);
        expect(network.searches).toEqual([
          'fake artist stream me -live -karaoke -instrumental -remix',
          'stream me -live -karaoke -instrumental -remix',
          'fake artist night session -live -karaoke -instrumental -remix',
        ]);
        expect(resolution.status).toBe('found');
      },
    );
  });

  test('a search the catalog cannot answer searches the files', async () => {
    setCatalogProvider({
      ...fakeCatalog,
      search: async query => ({ query, tracks: [], artists: [], albums: [] }),
    });
    await withNetwork([{ username: 'peer_a', filename: TRACK, behavior: 'ok' }], async network => {
      setCatalogProvider({
        ...fakeCatalog,
        search: async query => ({ query, tracks: [], artists: [], albums: [] }),
      });
      await useAppStore.getState().runSearch('stream me bootleg');
      expect(network.searches).toEqual(['stream me bootleg']);
      expect(useAppStore.getState().fileSearch).toBe('done');
    });
  });

  test('a wrong length is not accepted as the track', async () => {
    await withNetwork(
      [
        {
          username: 'peer_a',
          filename: TRACK,
          behavior: 'ok',
          durationSec: 420,
        },
      ],
      async () => {
        const resolution = await useAppStore.getState().resolveTrack(STREAM_ME);
        expect(resolution.status).toBe('none');
      },
    );
  });

  test('home is built from played artists only, and pages load from the catalog', async () => {
    useAppStore.setState({
      library: { liked: [], history: [], recentSearches: [] },
    });
    await useAppStore.getState().loadHome();
    expect(useAppStore.getState().home).toBeNull();

    const hit = {
      username: 'peer_a',
      filename: TRACK,
      size: 1,
      extension: 'mp3',
      slotFree: true,
      avgSpeed: 1,
      queueLength: 0,
    };
    useAppStore.setState({
      library: {
        liked: [],
        recentSearches: [],
        history: [
          {
            key: 'k',
            title: 'Stream Me',
            artist: 'Fake Artist',
            hit,
            catalog: STREAM_ME,
            at: 1,
          },
        ],
      },
    });
    await useAppStore.getState().loadHome();
    const home = useAppStore.getState().home;
    expect(home?.status).toBe('ready');
    if (home?.status === 'ready') {
      expect(home.data.artists.map(artist => artist.name)).toEqual([
        'Fake Artist',
      ]);
      // The artist itself is not suggested as similar to itself.
      expect(home.data.similar[0].related.map(artist => artist.name)).toEqual([
        'Similar One',
      ]);
    }

    useAppStore.getState().openPage({ kind: 'album', id: 'dz:100' });
    await waitFor(
      () => useAppStore.getState().albumPages['dz:100']?.status === 'ready',
    );
    expect(useAppStore.getState().pages).toHaveLength(1);
    expect(useAppStore.getState().closePage()).toBe(true);
    expect(useAppStore.getState().closePage()).toBe(false);

    useAppStore.getState().openPage({ kind: 'artist', id: 'dz:1' });
    await waitFor(
      () => useAppStore.getState().artistPages['dz:1']?.status === 'error',
    );
  });
});
