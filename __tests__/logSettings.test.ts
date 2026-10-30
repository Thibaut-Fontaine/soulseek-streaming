import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/services/settings';

describe('remote log setting', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('is off by default and survives a round trip', async () => {
    expect(DEFAULT_SETTINGS.logUploadEnabled).toBe(false);
    expect((await loadSettings()).logUploadEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.autoplayEnabled).toBe(false);
    expect((await loadSettings()).autoplayEnabled).toBe(false);

    await saveSettings({ ...DEFAULT_SETTINGS, logUploadEnabled: true, autoplayEnabled: true });
    const saved = await loadSettings();
    expect(saved.logUploadEnabled).toBe(true);
    expect(saved.autoplayEnabled).toBe(true);
  });

  test('a malformed stored value falls back to off', async () => {
    await AsyncStorage.setItem('@soulstream/settings/v1', JSON.stringify({ logUploadEnabled: 'yes' }));
    expect((await loadSettings()).logUploadEnabled).toBe(false);
  });
});
