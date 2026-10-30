import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-keychain', () => ({}));

import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_KEY,
  SETTINGS_KEY,
  formatBufferMb,
  loadSettings,
  saveSettings,
  settingsFromStored,
} from '../src/services/settings';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('playback buffer settings', () => {
  test('a fresh install buffers 500 KiB', async () => {
    const settings = await loadSettings();

    expect(settings.bufferMb).toBe(0.5);
    expect(DEFAULT_SETTINGS.bufferMb).toBe(0.5);
  });

  test('the previous default (2 MiB) is migrated to 500 KiB', async () => {
    await AsyncStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ bufferMb: 2 }));

    const settings = await loadSettings();

    expect(settings.bufferMb).toBe(0.5);
    // The migration is written once: deleting the old key must not bring 2 back.
    await AsyncStorage.removeItem(LEGACY_SETTINGS_KEY);
    expect((await loadSettings()).bufferMb).toBe(0.5);
  });

  test('a buffer size the user chose is kept across the migration', async () => {
    await AsyncStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ bufferMb: 8 }));

    expect((await loadSettings()).bufferMb).toBe(8);
  });

  test('a size saved after the migration is kept as is', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, bufferMb: 2 });

    expect(await AsyncStorage.getItem(SETTINGS_KEY)).not.toBeNull();
    expect((await loadSettings()).bufferMb).toBe(2);
  });

  test('invalid or missing values use the new default', () => {
    for (const bufferMb of [undefined, null, 'small', 0, -1, Number.NaN, 1000]) {
      expect(settingsFromStored({ bufferMb }).bufferMb).toBe(0.5);
    }
  });

  test('the buffer size is shown in Ko below one Mo', () => {
    expect(formatBufferMb(0.5)).toBe('500 Ko');
    expect(formatBufferMb(0.25)).toBe('250 Ko');
    expect(formatBufferMb(2)).toBe('2 Mo');
    expect(formatBufferMb(1.5)).toBe('1,5 Mo');
  });
});
