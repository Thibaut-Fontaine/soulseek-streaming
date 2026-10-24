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
  return { __esModule: true, default: Svg, Circle: Svg, Path: Svg, Rect: Svg };
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
      { hit: ONE, score: 0.95 },
      { hit: ONE_B, score: 0.95 },
      { hit: TWO, score: 0.7 },
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
  return JSON.stringify(renderer.toJSON());
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

  useAppStore.setState({ sheet: { kind: 'sources', hits: [ONE], title: 'One More Time' } });
  expect(text(render(<SheetHost />))).toContain('Écouter depuis other');
});
