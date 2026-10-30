/**
 * Uploader names are hidden by default everywhere the user can see them, and
 * the network is no longer named in the interface. A setting reveals the
 * names again.
 */
import React from 'react';
import { Share } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
    seekTo: jest.fn(async () => {}),
    getProgress: jest.fn(async () => ({ position: 30, duration: 200 })),
    addEventListener: jest.fn(),
  },
  State: { Playing: 'playing', Paused: 'paused', Ended: 'ended', Error: 'error' },
  Event: {},
  usePlaybackState: () => ({ state: 'playing' }),
  useProgress: () => ({ position: 30, duration: 200, buffered: 0 }),
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
import { debugLog, clearDebugLog } from '../src/services/debugLog';
import { DEFAULT_SETTINGS, loadSettings } from '../src/services/settings';
import { useAppStore } from '../src/state/store';
import { redactUploaderNames, uploaderLabel } from '../src/strings';
import { Banners } from '../src/ui/Banners';
import { DebugLogScreen } from '../src/ui/DebugLogScreen';
import { LoginScreen } from '../src/ui/LoginScreen';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { PlayerSheet } from '../src/ui/PlayerScreen';
import { SearchScreen } from '../src/ui/SearchScreen';
import { SettingsScreen } from '../src/ui/SettingsScreen';
import { SheetHost } from '../src/ui/Sheets';

const SECRET = 'dj_secret_uploader';

function hit(username = SECRET): SearchHit {
  return {
    username,
    filename: 'Music\\01 - One More Time.mp3',
    size: 5_000_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 100_000,
    queueLength: 0,
    bitrate: 320,
    durationSec: 200,
  };
}

function seed(showUploaders: boolean) {
  const currentHit = hit();
  act(() => {
    useAppStore.setState({
      username: 'tester',
      connection: 'online',
      playerReady: true,
      query: 'daft punk',
      searchQuery: 'daft punk',
      settings: { ...DEFAULT_SETTINGS, showUploaders },
      results: [{ hit: currentHit, score: 0.9, rank: 1 }],
      meta: {},
      current: {
        hit: currentHit,
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
      transfers: { t1: { id: 't1', state: 'streaming', received: 0, size: 5_000_000 } as never },
      playerOpen: true,
    });
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

function text(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

beforeEach(() => {
  clearDebugLog();
});

test('the setting is off by default and survives a reload', async () => {
  expect(DEFAULT_SETTINGS.showUploaders).toBe(false);
  expect((await loadSettings()).showUploaders).toBe(false);

  await require('@react-native-async-storage/async-storage').default.setItem(
    '@soulstream/settings/v1',
    JSON.stringify({ showUploaders: true }),
  );
  expect((await loadSettings()).showUploaders).toBe(true);
});

test('uploader labels hide the name until the setting is on', () => {
  expect(uploaderLabel(SECRET, false)).toBe('Pair');
  expect(uploaderLabel(SECRET, true)).toBe(`@${SECRET}`);
});

test('the player and mini player never show the uploader by default', () => {
  seed(false);
  expect(text(render(<MiniPlayer />))).not.toContain(SECRET);
  expect(text(render(<PlayerSheet />))).not.toContain(SECRET);

  seed(true);
  expect(text(render(<MiniPlayer />))).toContain(`@${SECRET}`);
  expect(text(render(<PlayerSheet />))).toContain(`@${SECRET}`);
});

test('the source sheet hides uploader names by default', () => {
  seed(false);
  act(() => {
    useAppStore.setState({ sheet: { kind: 'sources', hits: [hit()], title: 'One More Time' } });
  });
  expect(text(render(<SheetHost />))).not.toContain(SECRET);

  seed(true);
  act(() => {
    useAppStore.setState({ sheet: { kind: 'sources', hits: [hit()], title: 'One More Time' } });
  });
  expect(text(render(<SheetHost />))).toContain(`@${SECRET}`);
});

test('search results use a neutral artist instead of the uploader', () => {
  seed(false);
  const out = text(render(<SearchScreen />));
  expect(out).not.toContain(SECRET);
  expect(out).toContain('Pair');
});

test('the debug journal shared with the developer is redacted', async () => {
  seed(false);
  debugLog('play', `source 1 : ${SECRET} — Music\\01 - One More Time.mp3`);
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' } as never);
  const renderer = render(<DebugLogScreen onBack={() => {}} />);

  const button = renderer.root.findByProps({ accessibilityLabel: 'Partager' });
  await act(async () => {
    button.props.onPress();
  });

  expect(share).toHaveBeenCalled();
  expect(String(share.mock.calls[0][0].message)).not.toContain(SECRET);
  expect(String(share.mock.calls[0][0].message)).toContain('Pair');
  share.mockRestore();
});

test('redaction replaces every known uploader name, case-insensitively', () => {
  expect(redactUploaderNames(`@DJ_Secret_Uploader and dj_secret_uploader`, [SECRET])).toBe(
    'Pair and Pair',
  );
});

test('no screen still shows the network name in its interface', () => {
  seed(false);
  const output = [
    text(render(<LoginScreen />)),
    text(render(<SettingsScreen />)),
    text(render(<Banners />)),
  ].join(' ');

  expect(output.toLowerCase()).not.toContain('soulseek');
  expect(output).toContain('Afficher les noms des pairs');
});
