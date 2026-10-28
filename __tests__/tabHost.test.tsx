/**
 * Tabs stay mounted once visited: switching back to a tab shows it at once
 * instead of rebuilding it (hundreds of milliseconds on a low-end phone).
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockMounts: Record<string, number> = {};

function mockScreen(name: string) {
  const { useEffect, createElement } = require('react');
  const { Text } = require('react-native');
  return function Screen() {
    useEffect(() => {
      mockMounts[name] = (mockMounts[name] ?? 0) + 1;
    }, []);
    return createElement(Text, null, name);
  };
}

jest.mock('../src/ui/HomeScreen', () => ({ HomeScreen: mockScreen('home') }));
jest.mock('../src/ui/SearchScreen', () => ({ SearchScreen: mockScreen('search') }));
jest.mock('../src/ui/LibraryScreen', () => ({ LibraryScreen: mockScreen('library') }));
jest.mock('../src/ui/Banners', () => ({ Banners: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

import type { Tab } from '../src/state/store';
import { TabHost, type TabResets } from '../src/ui/TabHost';

const NO_RESETS: TabResets = { home: 0, search: 0, library: 0 };

function renderAt(tab: Tab, resets: TabResets = NO_RESETS) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<TabHost tab={tab} resets={resets} />);
  });
  return {
    renderer,
    go: (next: Tab, nextResets: TabResets = resets) =>
      act(() => renderer.update(<TabHost tab={next} resets={nextResets} />)),
  };
}

function wrapperOf(renderer: ReactTestRenderer.ReactTestRenderer, name: string) {
  return renderer.root.findByProps({ testID: `tab-${name}` });
}

beforeEach(() => {
  Object.keys(mockMounts).forEach(key => delete mockMounts[key]);
});

test('a tab visited again is the same screen, not a new one', () => {
  const { go } = renderAt('search');
  go('library');
  go('search');
  go('library');
  expect(mockMounts).toEqual({ search: 1, library: 1 });
});

test('tabs never visited are not built', () => {
  renderAt('home');
  expect(mockMounts).toEqual({ home: 1 });
});

test('a hidden tab takes no space, touches or accessibility focus', () => {
  const { renderer, go } = renderAt('search');
  go('library');
  const hidden = wrapperOf(renderer, 'search');
  expect(JSON.stringify(hidden.props.style)).toContain('"display":"none"');
  expect(hidden.props.pointerEvents).toBe('none');
  expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(JSON.stringify(wrapperOf(renderer, 'library').props.style)).not.toContain('none');
});

test('settings hides every kept tab', () => {
  const { renderer, go } = renderAt('home');
  go('settings');
  expect(JSON.stringify(wrapperOf(renderer, 'home').props.style)).toContain('"display":"none"');
});

test('a reset (tapping the current tab again) rebuilds that tab only', () => {
  const { go } = renderAt('search');
  go('library');
  go('search', { ...NO_RESETS, search: 1 });
  expect(mockMounts).toEqual({ search: 2, library: 1 });
});
