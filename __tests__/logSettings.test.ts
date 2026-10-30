import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/services/settings';

describe('remote log setting', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('is off by default and survives a round trip', async () => {
    expect(DEFAULT_SETTINGS.logUploadEnabled).toBe(false);
    expect((await loadSettings()).logUploadEnabled).toBe(false);

    await saveSettings({ ...DEFAULT_SETTINGS, logUploadEnabled: true });
    expect((await loadSettings()).logUploadEnabled).toBe(true);
  });

  test('a malformed stored value falls back to off', async () => {
    await AsyncStorage.setItem('@soulstream/settings/v1', JSON.stringify({ logUploadEnabled: 'yes' }));
    expect((await loadSettings()).logUploadEnabled).toBe(false);
  });
});
