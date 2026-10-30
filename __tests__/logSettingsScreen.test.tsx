import React from 'react';
import { act } from 'react-test-renderer';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {},
  Event: {},
  State: {},
}));
jest.mock('react-native-linear-gradient', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
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

import { DEFAULT_SETTINGS } from '../src/services/settings';
import { useAppStore } from '../src/state/store';
import { SettingsScreen } from '../src/ui/SettingsScreen';

describe('remote log setting screen', () => {
  const applySettings = jest.fn(async () => {});

  beforeEach(() => {
    applySettings.mockClear();
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      username: 'tester',
      connection: 'online',
      applySettings,
      cacheStats: () => null,
    });
  });

  test('shows the anonymous journal switch off by default', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<SettingsScreen />);
    });
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('Envoyer les journaux (anonyme)');
    expect(json).toContain('Désactivé par défaut');

    const [toggle] = renderer.root.findAll(
      node =>
        node.props.accessibilityLabel === 'Envoyer les journaux (anonyme)' &&
        typeof node.props.onValueChange === 'function',
    );
    expect(toggle.props.value).toBe(false);
    act(() => toggle.props.onValueChange(true));
    expect(applySettings).toHaveBeenCalledWith(
      expect.objectContaining({ logUploadEnabled: true }),
    );
    act(() => renderer.unmount());
  });
});
