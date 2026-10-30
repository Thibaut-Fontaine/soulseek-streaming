/**
 * Smoke test: every screen and sheet renders with realistic store state,
 * without native modules.
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
  State: { Playing: 'playing', Paused: 'paused', Ended: 'ended', Error: 'error', Buffering: 'buffering', Loading: 'loading' },
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

import type { SearchHit } from '../src/core/types';
import { savedTrack } from '../src/services/library';
import { useAppStore } from '../src/state/store';
import { HomeScreen } from '../src/ui/HomeScreen';
import { LibraryScreen } from '../src/ui/LibraryScreen';
import { MarqueeText } from '../src/ui/components';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { PlayerSheet } from '../src/ui/PlayerScreen';
import { SearchScreen } from '../src/ui/SearchScreen';
import { SheetHost } from '../src/ui/Sheets';

function hit(filename: string, username = 'peer', slotFree = true): SearchHit {
  return {
    username,
    filename,
    size: 5_000_000,
    extension: 'mp3',
    slotFree,
    avgSpeed: 100_000,
    queueLength: slotFree ? 0 : 4,
    bitrate: 320,
    durationSec: 200,
  };
}

const ONE = hit('Music\\Daft Punk\\Discovery\\01 - One More Time.mp3', 'dj_mark');
const ONE_B = hit('Music\\Daft Punk\\Discovery\\01 - One More Time.mp3', 'other', false);
const TWO = hit('Music\\Daft Punk\\Discovery\\03 - Digital Love.mp3', 'leiji');

function seed() {
  useAppStore.setState({
    username: 'tester',
    connection: 'online',
    playerReady: true,
    query: 'daft punk',
    searchQuery: 'daft punk',
    results: [
      { hit: ONE, score: 0.95, rank: 3 },
      { hit: ONE_B, score: 0.95, rank: 2 },
      { hit: TWO, score: 0.7, rank: 1 },
    ],
    deviceResults: [TWO],
    device: [TWO],
    library: {
      liked: [savedTrack(ONE)],
      history: [savedTrack(ONE), savedTrack(TWO)],
      recentSearches: ['daft punk', 'm83'],
    },
    meta: { ['dj_mark\u0000' + ONE.filename]: { title: 'One More Time', artist: 'Daft Punk', coverUri: 'data:image/jpeg;base64,AAAA' } },
    queue: [TWO],
    context: { label: 'Recherche « daft punk »', items: [ONE, TWO], index: 0 },
    current: {
      hit: ONE,
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
    playerOpen: true,
  });
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

function render(element: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  mounted.push(renderer);
  return renderer;
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

function text(renderer: ReactTestRenderer.ReactTestRenderer): string {
  // Lists (FlatList) pass circular objects down to their host views.
  const seen = new WeakSet<object>();
  return JSON.stringify(renderer.toJSON(), (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return undefined;
      }
      seen.add(value);
    }
    return value;
  });
}

beforeEach(seed);

test('home shows recent tracks, the device shelf and recent searches', () => {
  const out = text(render(<HomeScreen />));
  expect(out).toContain('One More Time');
  expect(out).toContain('Sur votre appareil');
  expect(out).toContain('m83');
});

test('search lists the best result and tracks without playing', () => {
  const out = text(render(<SearchScreen />));
  expect(out).toContain('Meilleur résultat');
  expect(out).toContain('2 sources');
  expect(out).toContain('Digital Love');
});

test('library shows collections and history', () => {
  const out = text(render(<LibraryScreen />));
  expect(out).toContain('Titres likés');
  expect(out).toContain('Historique');
  expect(out).toContain('Sur l’appareil');
});

test('mini player and full player render the current track with its cover', () => {
  expect(text(render(<MiniPlayer />))).toContain('One More Time');
  const player = text(render(<PlayerSheet />));
  expect(player).toContain('Recherche « daft punk »');
  expect(player).toContain('data:image/jpeg;base64,AAAA');
});

test('every bottom sheet renders', () => {
  for (const sheet of [
    { kind: 'actions' as const, hit: TWO },
    { kind: 'sources' as const, hits: [ONE], title: 'One More Time' },
    { kind: 'queue' as const },
  ]) {
    useAppStore.setState({ sheet });
    const out = text(render(<SheetHost />));
    expect(out.length).toBeGreaterThan(100);
  }

  act(() => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, showUploaders: true },
      sheet: { kind: 'sources', hits: [ONE], title: 'One More Time' },
    });
  });
  expect(text(render(<SheetHost />))).toContain('Écouter depuis other');
});

test('closing layers let taps through before their animation ends', () => {
  // A closing sheet or player that stayed on top (interrupted or lost
  // animation callback) made the tab bar and the player's buttons dead after
  // switching to another source.
  useAppStore.setState({ sheet: { kind: 'sources', hits: [ONE], title: 'One More Time' } });
  const sheet = render(<SheetHost />);
  const sheetHost = () => sheet.root.findAll(node => typeof node.type === 'string' && 'pointerEvents' in node.props)[0];
  expect(sheetHost().props.pointerEvents).toBe('auto');
  act(() => useAppStore.getState().closeSheet());
  expect(sheet.toJSON()).not.toBeNull();
  expect(sheetHost().props.pointerEvents).toBe('none');

  useAppStore.setState({ playerOpen: true });
  const player = render(<PlayerSheet />);
  const playerHost = () => player.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityViewIsModal)[0];
  expect(playerHost().props.pointerEvents).toBe('auto');
  act(() => useAppStore.getState().closePlayer());
  expect(playerHost().props.pointerEvents).toBe('none');
});

test('a title too long for its line scrolls, a short one stays still', () => {
  jest.useFakeTimers();
  const title = 'A Very Long Title (Extended Club Mix) [Remastered 2024]';
  const marquee = render(<MarqueeText>{title}</MarqueeText>);
  const copies = () => marquee.root.findAll(node => String(node.type) === 'Text' && node.props.children === title).length;
  const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } });
  const [box] = marquee.root.findAll(node => String(node.type) === 'View' && node.props.accessibilityLabel === title);
  const [line] = marquee.root.findAll(node => String(node.type) === 'Text' && node.props.children === title);

  act(() => {
    box.props.onLayout(layout(200));
    line.props.onLayout(layout(150));
  });
  expect(copies()).toBe(1);

  // Wider than its box: a second copy follows it round the loop.
  act(() => {
    line.props.onLayout(layout(420));
  });
  expect(copies()).toBe(2);
  jest.useRealTimers();
});

test('a new search scrolls the kept search tab back to the top', () => {
  const renderer = render(<SearchScreen />);
  const { ScrollView } = require('react-native');
  const scroll = renderer.root.findAllByType(ScrollView)[0].instance;
  const scrollTo = jest.spyOn(scroll, 'scrollTo').mockImplementation(() => {});

  act(() => {
    useAppStore.setState({ searchQuery: 'm83' });
  });

  expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
});

test('a long library list builds only the rows near the screen, and plays in order', () => {
  const { TrackRow } = require('../src/ui/track');
  const { FilterChip } = require('../src/ui/components');
  const many = Array.from({ length: 150 }, (_, index) =>
    savedTrack(hit(`Music\\Artist\\Album\\${String(index).padStart(3, '0')} - Song ${index}.mp3`)),
  );
  const playTrack = jest.fn(async () => {});
  useAppStore.setState(state => ({ library: { ...state.library, history: many }, playTrack }));
  const renderer = render(<LibraryScreen />);

  const chip = renderer.root.findAllByType(FilterChip).find(item => item.props.label === 'Historique')!;
  act(() => chip.props.onPress());

  // TrackRow is a React.memo: the test tree holds its inner component.
  const rows = renderer.root.findAll(node => node.type === TrackRow.type);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(150);

  act(() => rows[3].props.onPress(rows[3].props.hit));
  expect(playTrack).toHaveBeenCalledWith(
    many[3].hit,
    expect.objectContaining({ index: 3, label: 'Historique', items: many.map(track => track.hit) }),
  );
});

test('the player backdrop blurs a small cover, not the 1000 px one', () => {
  const { backdropCoverUri } = require('../src/ui/track');
  const artwork = { small: 's.jpg', medium: 'm.jpg', big: 'b.jpg', large: 'l.jpg' };
  expect(backdropCoverUri({ artwork, coverUri: null })).toBe('m.jpg');
  expect(backdropCoverUri({ artwork: null, coverUri: 'data:image/jpeg;base64,AAAA' })).toBe(
    'data:image/jpeg;base64,AAAA',
  );
});

test('the library shows its overview again after the tab was left', () => {
  const { FilterChip } = require('../src/ui/components');
  useAppStore.setState({ tab: 'library' });
  const renderer = render(<LibraryScreen />);
  const overviewShown = () =>
    renderer.root.findAll(node => (node.type as unknown) === 'Text' && node.props.children === 'Écoutés récemment').length > 0;
  const chip = renderer.root.findAllByType(FilterChip).find(item => item.props.label === 'Sur l’appareil')!;
  act(() => chip.props.onPress());
  expect(overviewShown()).toBe(false);

  act(() => useAppStore.setState({ tab: 'home' }));
  act(() => useAppStore.setState({ tab: 'library' }));

  expect(overviewShown()).toBe(true);
});
