/**
 * Fast-changing values (playback position 4×/s, transfer progress 4×/s)
 * must only redraw the small parts that show them, not the whole player:
 * a full player redraw costs tens of milliseconds on a low-end phone.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

type Progress = { position: number; duration: number; buffered: number };
const mockProgressListeners = new Set<(value: Progress) => void>();
let mockProgressValue: Progress = { position: 42, duration: 200, buffered: 0 };

function setProgress(position: number) {
  mockProgressValue = { ...mockProgressValue, position };
  mockProgressListeners.forEach(listener => listener(mockProgressValue));
}

jest.mock('react-native-track-player', () => {
  const { useEffect, useState } = require('react');
  return {
    __esModule: true,
    default: {
      play: jest.fn(async () => {}),
      pause: jest.fn(async () => {}),
      seekTo: jest.fn(async () => {}),
      getProgress: jest.fn(async () => mockProgressValue),
      addEventListener: jest.fn(),
    },
    State: { Playing: 'playing', Paused: 'paused', Ended: 'ended', Error: 'error' },
    Event: {},
    usePlaybackState: () => ({ state: 'playing' }),
    useProgress: () => {
      const [value, setValue] = useState(mockProgressValue);
      useEffect(() => {
        mockProgressListeners.add(setValue);
        return () => {
          mockProgressListeners.delete(setValue);
        };
      }, []);
      return value;
    },
  };
});
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
// useTrackInfo runs once per render of MiniPlayer / the full player body:
// counting its calls counts those (big) renders.
const mockTrackInfoCalls = jest.fn();
jest.mock('../src/ui/track', () => {
  const actual = jest.requireActual('../src/ui/track');
  return {
    ...actual,
    useTrackInfo: (...args: unknown[]) => {
      mockTrackInfoCalls();
      return actual.useTrackInfo(...args);
    },
  };
});

import TrackPlayer from 'react-native-track-player';
import type { SearchHit } from '../src/core/types';
import { useAppStore } from '../src/state/store';
import { MiniPlayer } from '../src/ui/MiniPlayer';
import { PlayerSheet } from '../src/ui/PlayerScreen';

const ONE: SearchHit = {
  username: 'dj_mark',
  filename: 'Music\\Daft Punk\\Discovery\\01 - One More Time.mp3',
  size: 5_000_000,
  extension: 'mp3',
  slotFree: true,
  avgSpeed: 100_000,
  queueLength: 0,
  bitrate: 320,
  durationSec: 200,
};

function seed(phase: 'playing' | 'preparing') {
  useAppStore.setState({
    username: 'tester',
    connection: 'online',
    playerReady: true,
    current: {
      hit: ONE,
      transferId: 't1',
      url: 'http://127.0.0.1/x',
      phase,
      error: null,
      bufferTarget: 1_000_000,
      attempt: 1,
      fallback: null,
      source: 'network',
      warning: null,
    },
    transfers: {
      t1: { id: 't1', state: 'streaming', received: 0, size: 5_000_000 } as never,
    },
    playerOpen: true,
  });
}

function setReceived(received: number) {
  useAppStore.setState(state => ({
    transfers: { t1: { ...state.transfers.t1, received } },
  }));
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

beforeEach(() => {
  mockTrackInfoCalls.mockClear();
  mockProgressValue = { position: 42, duration: 200, buffered: 0 };
});

const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());

test('playback progress redraws only the full player’s scrubber', () => {
  seed('playing');
  const renderer = render(<PlayerSheet />);
  const before = mockTrackInfoCalls.mock.calls.length;

  for (let second = 43; second < 48; second++) {
    act(() => setProgress(second));
  }

  expect(mockTrackInfoCalls.mock.calls.length).toBe(before);
  expect(texts(renderer)).toContain('0:47');
});

test('playback progress redraws only the mini player’s bar', () => {
  seed('playing');
  render(<MiniPlayer />);
  const before = mockTrackInfoCalls.mock.calls.length;

  for (let second = 43; second < 48; second++) {
    act(() => setProgress(second));
  }

  expect(mockTrackInfoCalls.mock.calls.length).toBe(before);
});

test('download progress redraws only the transfer status while a track loads', () => {
  seed('preparing');
  render(
    <>
      <MiniPlayer />
      <PlayerSheet />
    </>,
  );
  const before = mockTrackInfoCalls.mock.calls.length;

  for (let step = 1; step <= 5; step++) {
    act(() => setReceived(step * 100_000));
  }

  expect(mockTrackInfoCalls.mock.calls.length).toBe(before);
});

test('"Précédent" sends the current position, read when tapped', async () => {
  seed('playing');
  const playPrevious = jest.fn(async () => {});
  useAppStore.setState({ playPrevious });
  const renderer = render(<PlayerSheet />);
  mockProgressValue = { ...mockProgressValue, position: 2 };

  const button = renderer.root.findByProps({ accessibilityLabel: 'Précédent' });
  await act(async () => {
    button.props.onPress();
  });

  expect(TrackPlayer.getProgress).toHaveBeenCalled();
  expect(playPrevious).toHaveBeenCalledWith(2);
});
