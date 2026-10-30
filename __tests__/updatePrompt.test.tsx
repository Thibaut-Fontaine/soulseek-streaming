import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppVersionManifest } from '../src/core/update';

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

import { UPDATE_MANIFEST_URL } from '../src/core/update';
import { setUpdateFetcher, setUpdatePlatform, useUpdateStore } from '../src/state/updateStore';
import { DISMISSED_UPDATE_KEY } from '../src/state/updateStore';
import { UpdatePrompt } from '../src/ui/UpdatePrompt';

const SHA = 'a'.repeat(64);

function manifest(overrides: Partial<AppVersionManifest> = {}): AppVersionManifest {
  return {
    versionCode: 19,
    versionName: '1.4.0',
    apkUrl: 'https://thibautfontaine.space/streaming/SoulStream.apk',
    sha256: SHA,
    notes: 'Reprise de la lecture et noms des pairs masqués.',
    sizeBytes: 59_521_454,
    ...overrides,
  };
}

function fakePlatform() {
  let progress: ((received: number, total: number) => void) | null = null;
  let resolveDownload!: (path: string) => void;
  let rejectDownload!: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolveDownload = resolve;
    rejectDownload = reject;
  });
  const cancel = jest.fn();
  return {
    platform: {
      download: jest.fn((_url: string, onProgress: (received: number, total: number) => void) => {
        progress = onProgress;
        return { promise, cancel };
      }),
      hashFile: jest.fn(async () => SHA),
      install: jest.fn(async () => {}),
      removeFile: jest.fn(async () => {}),
    },
    resolve: (path: string) => resolveDownload(path),
    reject: (error: Error) => rejectDownload(error),
    report: (received: number, total: number) => progress?.(received, total),
    cancel,
  };
}

function render(element: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  mounted.push(renderer);
  return renderer;
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

function text(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

beforeEach(async () => {
  await AsyncStorage.removeItem(DISMISSED_UPDATE_KEY);
  setUpdateFetcher(undefined);
  useUpdateStore.setState({
    status: 'idle',
    manifest: null,
    progress: 0,
    error: null,
    downloadedPath: null,
  });
});

test('a newer build is offered, never installed by itself', () => {
  useUpdateStore.setState({ status: 'available', manifest: manifest() });
  const out = text(render(<UpdatePrompt />));

  expect(out).toContain('Mise à jour disponible');
  expect(out).toContain('1.4.0');
  expect(out).toContain('Télécharger');
  expect(out).toContain('Plus tard');
  expect(out).toContain('Reprise de la lecture');
});

test('download shows progress, then offers the system installer', async () => {
  const fake = fakePlatform();
  setUpdatePlatform(fake.platform as never);
  useUpdateStore.setState({ status: 'available', manifest: manifest() });
  const renderer = render(<UpdatePrompt />);

  const download = renderer.root.findByProps({ accessibilityLabel: 'Télécharger' });
  act(() => {
    download.props.onPress();
  });
  expect(useUpdateStore.getState().status).toBe('downloading');

  act(() => fake.report(30_000_000, 60_000_000));
  expect(text(renderer)).toContain('50 %');

  await act(async () => {
    fake.resolve('/cache/update.apk');
    await Promise.resolve();
  });
  expect(useUpdateStore.getState().status).toBe('ready');
  expect(fake.platform.install).not.toHaveBeenCalled();
  expect(text(renderer)).toContain('Installer');

  const install = renderer.root.findByProps({ accessibilityLabel: 'Installer' });
  await act(async () => {
    await install.props.onPress();
  });
  expect(fake.platform.install).toHaveBeenCalledWith('/cache/update.apk');
});

test('a corrupt download is explained and cannot be installed', async () => {
  const fake = fakePlatform();
  fake.platform.hashFile.mockResolvedValue('b'.repeat(64));
  setUpdatePlatform(fake.platform as never);
  useUpdateStore.setState({ status: 'available', manifest: manifest() });
  const renderer = render(<UpdatePrompt />);

  act(() => {
    renderer.root.findByProps({ accessibilityLabel: 'Télécharger' }).props.onPress();
  });
  await act(async () => {
    fake.resolve('/cache/update.apk');
    await Promise.resolve();
  });

  expect(useUpdateStore.getState().status).toBe('error');
  expect(text(renderer)).toContain('corrompu');
  expect(fake.platform.removeFile).toHaveBeenCalledWith('/cache/update.apk');
  expect(fake.platform.install).not.toHaveBeenCalled();
});

test('cancelling returns to the prompt without installing', async () => {
  const fake = fakePlatform();
  setUpdatePlatform(fake.platform as never);
  useUpdateStore.setState({ status: 'available', manifest: manifest() });
  const renderer = render(<UpdatePrompt />);

  act(() => {
    renderer.root.findByProps({ accessibilityLabel: 'Télécharger' }).props.onPress();
  });
  act(() => {
    renderer.root.findByProps({ accessibilityLabel: 'Annuler le téléchargement' }).props.onPress();
  });
  await act(async () => {
    fake.reject(new Error('canceled'));
    await Promise.resolve();
  });

  expect(useUpdateStore.getState().status).toBe('available');
  expect(fake.platform.install).not.toHaveBeenCalled();
});

test('dismissing during a download does not bring the prompt back', async () => {
  const fake = fakePlatform();
  setUpdatePlatform(fake.platform as never);
  useUpdateStore.setState({ status: 'available', manifest: manifest() });
  const renderer = render(<UpdatePrompt />);

  act(() => {
    renderer.root.findByProps({ accessibilityLabel: 'Télécharger' }).props.onPress();
  });
  await act(async () => {
    await renderer.root.findByProps({ accessibilityLabel: 'Plus tard' }).props.onPress();
  });
  expect(useUpdateStore.getState().status).toBe('idle');

  await act(async () => {
    fake.resolve('/cache/update.apk');
    await Promise.resolve();
  });

  expect(useUpdateStore.getState().status).toBe('idle');
  expect(fake.platform.install).not.toHaveBeenCalled();
});

test('dismissing a version keeps it quiet until a newer one exists', async () => {
  const fetchManifest = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => manifest(),
  }));
  setUpdateFetcher(fetchManifest);

  await useUpdateStore.getState().check();
  expect(useUpdateStore.getState().status).toBe('available');

  await useUpdateStore.getState().dismiss();
  expect(useUpdateStore.getState().status).toBe('idle');
  expect(await AsyncStorage.getItem(DISMISSED_UPDATE_KEY)).toBe('19');

  await useUpdateStore.getState().check();
  expect(useUpdateStore.getState().status).toBe('idle');

  fetchManifest.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => manifest({ versionCode: 20, versionName: '1.4.1' }),
  }));
  await useUpdateStore.getState().check();
  expect(useUpdateStore.getState().status).toBe('available');
  expect(useUpdateStore.getState().manifest?.versionName).toBe('1.4.1');
});

test('an offline check stays silent and does not block the app', async () => {
  setUpdateFetcher(
    jest.fn(async () => {
      throw new Error('Network request failed');
    }),
  );

  await expect(useUpdateStore.getState().check()).resolves.toBeUndefined();
  expect(useUpdateStore.getState().status).toBe('idle');
});

test('the manifest endpoint is the VPS route', () => {
  expect(UPDATE_MANIFEST_URL).toBe('https://thibautfontaine.space/api/app/version');
});
