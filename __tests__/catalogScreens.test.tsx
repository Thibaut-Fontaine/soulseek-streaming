/**
 * Catalog UI: artist/album/genre pages, catalog search results, browse
 * section, catalog track menu and the player's catalog links, rendered from
 * store state with realistic catalog data.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
    seekTo: jest.fn(async () => {}),
    addEventListener: jest.fn(),
  },
  State: {
    Playing: 'playing',
    Paused: 'paused',
    Ended: 'ended',
    Error: 'error',
    Buffering: 'buffering',
    Loading: 'loading',
  },
  Event: {},
  usePlaybackState: () => ({ state: 'playing' }),
  useProgress: () => ({ position: 42, duration: 200, buffered: 0 }),
}));
jest.mock('react-native-linear-gradient', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('react-native-svg', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  const Svg = (props: object) => createElement(View, props);
  return { __esModule: true, default: Svg, Circle: Svg, G: Svg, Path: Svg, Rect: Svg };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-keychain', () => ({}));
jest.mock('../src/transport/rnTcpTransport', () => ({ ReactNativeTransport: class {} }));
jest.mock('../src/player/player', () => ({
  ensurePlayer: jest.fn(async () => {}),
  resetPlayer: jest.fn(async () => {}),
}));

import { hitKey } from '../src/core/types';
import { EMPTY_LIBRARY, savedTrack } from '../src/services/library';
import { useAppStore } from '../src/state/store';
import { HomeScreen } from '../src/ui/HomeScreen';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { PageHost } from '../src/ui/pages';
import { PlayerSheet } from '../src/ui/PlayerScreen';
import { SearchScreen } from '../src/ui/SearchScreen';
import { SheetHost } from '../src/ui/Sheets';
import {
  albumMetaLine,
  bestCatalogResult,
  catalogTrackGroups,
  discSections,
  formatFans,
  formatReleaseDate,
  formatTotalDuration,
  pickArtwork,
  splitDiscography,
} from '../src/ui/catalogFormat';
import {
  ALBUM_PAGE,
  ARTIST_PAGE,
  DAFT_PUNK,
  DIGITAL_LOVE,
  DISCOVERY,
  GET_LUCKY,
  HOME,
  OMT_FILE_A,
  OMT_RADIO,
  ONE_MORE_TIME,
  SEARCH_GROUPS,
  SEARCH_RESULT,
  TOP_TRACKS,
  art,
} from '../test-utils/catalogFixtures';

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

function render(element: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  mounted.push(renderer);
  return renderer;
}

function text(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const [node] = renderer.root.findAll(
    item => item.props.accessibilityLabel === label && typeof item.props.onPress === 'function',
  );
  if (!node) {
    throw new Error(`Nothing to press with the label "${label}"`);
  }
  act(() => {
    node.props.onPress();
  });
}

const actions = {
  loadArtistPage: jest.fn(async () => {}),
  loadAlbumPage: jest.fn(async () => {}),
  loadHome: jest.fn(async () => {}),
  playCatalogTrack: jest.fn(async () => {}),
  enqueueCatalogTrack: jest.fn(),
  resolveTrack: jest.fn(async () => ({ status: 'none' as const, sources: [] })),
  playArtistRadio: jest.fn(async () => {}),
  openPage: jest.fn(),
  closePage: jest.fn(() => true),
};

beforeEach(() => {
  Object.values(actions).forEach(fn => fn.mockClear());
  useAppStore.setState({
    username: 'tester',
    connection: 'online',
    playerReady: true,
    query: '',
    searchQuery: '',
    searching: false,
    searchEmpty: false,
    searchError: null,
    results: [],
    deviceResults: [],
    device: [],
    library: { ...EMPTY_LIBRARY },
    meta: {},
    queue: [],
    context: null,
    catalogContext: null,
    current: null,
    playerOpen: false,
    sheet: null,
    pages: [],
    artistPages: {},
    albumPages: {},
    home: null,
    catalogResults: null,
    groups: [],
    resolutions: {},
    hitTracks: {},
    ...actions,
  });
});

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

describe('catalog formatting', () => {
  test('labels', () => {
    expect(formatFans(4_871_265)).toBe('4 871 265 fans');
    expect(formatFans(1)).toBe('1 fan');
    expect(formatTotalDuration(3660)).toBe('1 h 01 min');
    expect(formatTotalDuration(2520)).toBe('42 min');
    expect(formatReleaseDate('2001-03-12')).toBe('12 mars 2001');
    expect(formatReleaseDate('2001')).toBe('2001');
    expect(albumMetaLine(DISCOVERY)).toBe('2001 · Album · 14 titres · 1 h 01 min');
  });

  test('discography, discs and artwork', () => {
    const split = splitDiscography(ARTIST_PAGE.albums);
    expect(split.albums.map(a => a.kind)).toEqual(['album', 'compile', 'album']);
    expect(split.singles.map(a => a.kind)).toEqual(['single', 'ep']);
    expect(discSections(ALBUM_PAGE.tracks).map(s => [s.disc, s.tracks.length])).toEqual([
      [1, 3],
      [2, 1],
    ]);
    expect(pickArtwork(art('x'), 40)).toContain('56x56');
    expect(pickArtwork(art('x'), 200)).toContain('250x250');
    expect(pickArtwork(art('x'), 900)).toContain('1000x1000');
    expect(pickArtwork({ small: null, medium: null, large: 'L' }, 40)).toBe('L');
  });

  test('best result: artist for an artist query, else top track', () => {
    expect(bestCatalogResult('daft punk', SEARCH_RESULT, SEARCH_GROUPS)?.kind).toBe('artist');
    const best = bestCatalogResult('daft punk one more time', SEARCH_RESULT, SEARCH_GROUPS);
    expect(best?.kind === 'track' && best.track.id).toBe(ONE_MORE_TIME.id);
    expect(catalogTrackGroups(SEARCH_RESULT, [])).toHaveLength(3);
  });
});

describe('page host', () => {
  test('nothing when no page is open', () => {
    expect(render(<PageHost />).toJSON()).toBeNull();
  });

  test('artist page loads, shows a skeleton with the known name', () => {
    useAppStore.setState({ pages: [{ kind: 'artist', id: DAFT_PUNK.id, name: 'Daft Punk' }] });
    const out = text(render(<PageHost />));
    expect(actions.loadArtistPage).toHaveBeenCalledWith(DAFT_PUNK.id);
    expect(out).toContain('Daft Punk');
    expect(out).toContain('Chargement…');
  });

  test('artist page ready', () => {
    useAppStore.setState({
      pages: [{ kind: 'artist', id: DAFT_PUNK.id }],
      artistPages: { [DAFT_PUNK.id]: { status: 'ready', data: ARTIST_PAGE } },
    });
    const page = render(<PageHost />);
    const out = text(page);
    expect(actions.loadArtistPage).not.toHaveBeenCalled();
    for (const label of [
      '4 871 265 fans',
      'Titres populaires',
      'Discographie',
      'Singles et EP',
      'Les fans aiment aussi',
      'Justice',
    ]) {
      expect(out).toContain(label);
    }
    expect(out).toContain('daft-punk/1000x1000.jpg');
    expect(out).toContain('Explicite');
    // Top 5 then "Afficher plus" for the rest.
    expect(out).toContain('Harder, Better, Faster, Stronger');
    expect(out).not.toContain('Around the World');
    press(page, 'Afficher plus');
    expect(text(page)).toContain('Around the World');
  });

  test('artist page actions: play, shuffle, radio, related artist, back', () => {
    useAppStore.setState({
      pages: [{ kind: 'artist', id: DAFT_PUNK.id }],
      artistPages: { [DAFT_PUNK.id]: { status: 'ready', data: ARTIST_PAGE } },
    });
    const page = render(<PageHost />);
    press(page, 'Écouter Daft Punk');
    expect(actions.playCatalogTrack).toHaveBeenCalledWith(ONE_MORE_TIME, {
      label: 'Daft Punk',
      tracks: TOP_TRACKS,
      index: 0,
    });
    press(page, 'Lecture aléatoire : Daft Punk');
    expect(useAppStore.getState().shuffle).toBe(true);
    press(page, 'Radio Daft Punk');
    expect(actions.playArtistRadio).toHaveBeenCalledWith(DAFT_PUNK.id, 'Daft Punk');
    press(page, 'Artiste Justice');
    expect(actions.openPage).toHaveBeenCalledWith({ kind: 'artist', id: 'dz:1424', name: 'Justice' });
    press(page, 'Retour');
    expect(actions.closePage).toHaveBeenCalled();
  });

  test('artist page error offers a retry', () => {
    useAppStore.setState({
      pages: [{ kind: 'artist', id: DAFT_PUNK.id, name: 'Daft Punk' }],
      artistPages: { [DAFT_PUNK.id]: { status: 'error', error: 'Délai dépassé' } },
    });
    const page = render(<PageHost />);
    expect(text(page)).toContain('Impossible de charger l’artiste');
    press(page, 'Réessayer');
    expect(actions.loadArtistPage).toHaveBeenCalledWith(DAFT_PUNK.id, true);
  });

  test('album page: discs, version, source status, more by artist', () => {
    useAppStore.setState({
      pages: [{ kind: 'album', id: DISCOVERY.id }],
      albumPages: { [DISCOVERY.id]: { status: 'ready', data: ALBUM_PAGE } },
      resolutions: {
        [AERODYNAMIC_ID]: { status: 'searching', sources: [] },
        [DIGITAL_LOVE.id]: { status: 'none', sources: [] },
      },
    });
    const page = render(<PageHost />);
    const out = text(page);
    for (const label of [
      'Discovery',
      '2001 · Album · 14 titres · 1 h 01 min',
      'Disque 1',
      'Disque 2',
      'Radio Edit · Daft Punk',
      'Recherche de sources…',
      'Aucune source sur le réseau pour l’instant',
      'Plus de Daft Punk',
      '12 mars 2001',
      '© Parlophone (France)',
    ]) {
      expect(out).toContain(label);
    }
    press(page, 'Aller à l’artiste Daft Punk');
    expect(actions.openPage).toHaveBeenCalledWith({ kind: 'artist', id: DAFT_PUNK.id, name: 'Daft Punk' });
    press(page, `Écouter ${DIGITAL_LOVE.title}, Daft Punk`);
    expect(actions.playCatalogTrack).toHaveBeenCalledWith(
      DIGITAL_LOVE,
      expect.objectContaining({ label: 'Discovery', index: 2 }),
    );
  });

  test('album page loading and error', () => {
    useAppStore.setState({ pages: [{ kind: 'album', id: DISCOVERY.id, title: 'Discovery' }] });
    expect(text(render(<PageHost />))).toContain('Discovery');
    expect(actions.loadAlbumPage).toHaveBeenCalledWith(DISCOVERY.id);

    act(() => {
      useAppStore.setState({ albumPages: { [DISCOVERY.id]: { status: 'error', error: 'Hors ligne' } } });
    });
    expect(text(render(<PageHost />))).toContain('Impossible de charger l’album');
  });

  test('stacked pages: only the top one is visible', () => {
    useAppStore.setState({
      pages: [
        { kind: 'artist', id: DAFT_PUNK.id, name: 'Daft Punk' },
        { kind: 'album', id: DISCOVERY.id, title: 'Discovery' },
      ],
      albumPages: { [DISCOVERY.id]: { status: 'ready', data: ALBUM_PAGE } },
    });
    const out = text(render(<PageHost />));
    expect(out).toContain('Discovery');
    expect(out).toContain('"display":"none"');
  });
});

const AERODYNAMIC_ID = 'dz:3135554';

describe('search with the catalog', () => {
  function seedSearch(query: string) {
    useAppStore.setState({
      query,
      searchQuery: query,
      catalogResults: SEARCH_RESULT,
      groups: SEARCH_GROUPS,
      results: SEARCH_GROUPS.flatMap(group => group.sources),
    });
  }

  test('track query: best track, titles with sources, artists, albums, other files', () => {
    seedSearch('daft punk one more time');
    const screen = render(<SearchScreen />);
    const out = text(screen);
    for (const label of [
      'Meilleur résultat',
      'Titres',
      '2 sources',
      'Aucune source',
      'Artistes',
      'Albums',
      'Autres fichiers',
      'Justice',
    ]) {
      expect(out).toContain(label);
    }
    expect(out).toContain('discovery/250x250.jpg');
    expect(out).toContain('live bootleg');

    press(screen, 'Voir les 2 sources');
    const sheet = useAppStore.getState().sheet;
    expect(sheet?.kind === 'sources' && sheet.hits.map(hitKey)).toEqual(
      SEARCH_GROUPS[0].sources.map(r => hitKey(r.hit)),
    );

    press(screen, `Écouter ${OMT_RADIO.title}, Daft Punk`);
    expect(actions.playCatalogTrack).toHaveBeenCalledWith(OMT_RADIO, expect.objectContaining({ index: 1 }));
  });

  test('artist query shows the artist as best result', () => {
    seedSearch('Daft Punk');
    const screen = render(<SearchScreen />);
    expect(text(screen)).toContain('4 871 265 fans');
    press(screen, 'Artiste Daft Punk');
    expect(actions.openPage).toHaveBeenCalledWith({ kind: 'artist', id: DAFT_PUNK.id, name: 'Daft Punk' });
  });

  test('catalog answered before Soulseek: catalog tracks with no sources yet', () => {
    useAppStore.setState({
      query: 'get lucky',
      searchQuery: 'get lucky',
      searching: true,
      catalogResults: { ...SEARCH_RESULT, tracks: [GET_LUCKY] },
    });
    const out = text(render(<SearchScreen />));
    expect(out).toContain('Get Lucky');
    expect(out).toContain('recherche des sources…');
  });

  test('without the catalog the old file-based results stay', () => {
    useAppStore.setState({
      query: 'one more time',
      searchQuery: 'one more time',
      results: [{ hit: OMT_FILE_A, score: 0.95, rank: 3 }],
    });
    const out = text(render(<SearchScreen />));
    expect(out).toContain('1 source');
    expect(out).not.toContain('Autres fichiers');
  });
});

describe('home from the listening history', () => {
  const played = { ...savedTrack(OMT_FILE_A, undefined, ONE_MORE_TIME) };

  test('no history: welcome only, no catalog request', () => {
    const out = text(render(<HomeScreen />));
    expect(out).toContain('Votre musique apparaîtra ici');
    for (const label of ['Top titres', 'Albums du moment', 'Artistes populaires', 'Genres', 'Vos artistes']) {
      expect(out).not.toContain(label);
    }
  });

  test('recent artists, albums of recent tracks and similar artists', () => {
    useAppStore.setState({
      library: { ...EMPTY_LIBRARY, history: [played] },
      home: { status: 'ready', data: HOME },
    });
    const home = render(<HomeScreen />);
    const out = text(home);
    expect(actions.loadHome).toHaveBeenCalled();
    for (const label of ['Vos artistes', 'Albums de vos écoutes', 'Parce que vous écoutez Daft Punk', 'Cassius']) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain('Top titres');
    press(home, 'Artiste Cassius');
    expect(actions.openPage).toHaveBeenCalledWith({ kind: 'artist', id: 'dz:1563', name: 'Cassius' });
    press(home, 'Album Discovery, Daft Punk');
    expect(actions.openPage).toHaveBeenCalledWith({ kind: 'album', id: DISCOVERY.id, title: 'Discovery' });
  });

  test('error offers a retry', () => {
    useAppStore.setState({
      library: { ...EMPTY_LIBRARY, history: [played] },
      home: { status: 'error', error: 'HTTP 503' },
    });
    const home = render(<HomeScreen />);
    expect(text(home)).toContain('Suggestions indisponibles');
    press(home, 'Réessayer');
    expect(actions.loadHome).toHaveBeenCalledWith(true);
  });

  test('catalog disabled: no catalog sections, no request', () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, catalogEnabled: false },
      library: { ...EMPTY_LIBRARY, history: [played] },
    });
    expect(text(render(<HomeScreen />))).not.toContain('Albums de vos écoutes');
    expect(actions.loadHome).not.toHaveBeenCalled();
    act(() => {
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, catalogEnabled: true } });
    });
  });
});

describe('catalog track menu', () => {
  test('lists queue and navigation actions', () => {
    useAppStore.setState({ sheet: { kind: 'catalogActions', track: GET_LUCKY }, groups: SEARCH_GROUPS });
    const sheet = render(<SheetHost />);
    const out = text(sheet);
    for (const label of [
      'Lire ensuite',
      'Ajouter à la file d’attente',
      'Aller à l’artiste',
      'Aller à l’album',
      'Chercher des sources',
    ]) {
      expect(out).toContain(label);
    }
    expect(out).toContain('Daft Punk, Pharrell Williams, Nile Rodgers');
    press(sheet, 'Lire ensuite');
    expect(actions.enqueueCatalogTrack).toHaveBeenCalledWith(GET_LUCKY, true);
  });

  test('shows known sources', () => {
    useAppStore.setState({ sheet: { kind: 'catalogActions', track: ONE_MORE_TIME }, groups: SEARCH_GROUPS });
    expect(text(render(<SheetHost />))).toContain('Voir les sources');
  });
});

describe('player with a matched file', () => {
  beforeEach(() => {
    useAppStore.setState({
      hitTracks: { [hitKey(OMT_FILE_A)]: ONE_MORE_TIME },
      catalogContext: { label: 'Discovery', tracks: ALBUM_PAGE.tracks, index: 0 },
      current: {
        hit: OMT_FILE_A,
        transferId: 't1',
        url: 'http://127.0.0.1/x',
        phase: 'playing',
        error: null,
        bufferTarget: 100,
        attempt: 1,
        fallback: null,
        source: 'network',
        warning: null,
      },
    });
  });

  test('mini player shows the catalog cover', () => {
    const out = text(render(<MiniPlayer />));
    expect(out).toContain('One More Time');
    expect(out).toContain('cdn.example/discovery');
  });

  test('full player: large cover, context label, artist and album links', () => {
    useAppStore.setState({ playerOpen: true });
    const player = render(<PlayerSheet />);
    const out = text(player);
    expect(out).toContain('discovery/1000x1000.jpg');
    expect(out).toContain('Discovery');
    press(player, 'Aller à l’artiste Daft Punk');
    expect(actions.openPage).toHaveBeenCalledWith({ kind: 'artist', id: DAFT_PUNK.id, name: 'Daft Punk' });
    press(player, 'Aller à l’album Discovery');
    expect(actions.openPage).toHaveBeenCalledWith({ kind: 'album', id: DISCOVERY.id, title: 'Discovery' });
  });

  test('liked entries carry their catalog track to library rows', () => {
    const saved = { ...savedTrack(OMT_FILE_A), catalog: ONE_MORE_TIME };
    useAppStore.setState({
      hitTracks: {},
      current: null,
      library: { ...EMPTY_LIBRARY, history: [saved], liked: [saved] },
    });
    expect(text(render(<HomeScreen />))).toContain('cdn.example/discovery');
  });
});
