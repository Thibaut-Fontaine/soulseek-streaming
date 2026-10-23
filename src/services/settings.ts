import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

export interface Settings {
  serverHost: string;
  serverPort: number;
  /** Preferred inbound port for peer connections. 0 lets the OS choose. */
  listenPort: number;
  /** Local HTTP port used to feed the native player. 0 lets the OS choose. */
  streamPort: number;
  /** How much of a track to buffer before playback starts, in MiB. */
  bufferMb: number;
}

export interface Credentials {
  username: string;
  password: string;
}

export const DEFAULT_SETTINGS: Settings = {
  serverHost: 'server.slsknet.org',
  serverPort: 2242,
  listenPort: 22345,
  streamPort: 0,
  bufferMb: 2,
};

const SETTINGS_KEY = '@soulstream/settings/v1';
const KEYCHAIN_SERVICE = 'com.soulstream.soulseek';

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);

    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }

    const parsed = JSON.parse(raw) as Partial<Settings>;

    return {
      serverHost:
        typeof parsed.serverHost === 'string' && parsed.serverHost.trim()
          ? parsed.serverHost.trim()
          : DEFAULT_SETTINGS.serverHost,
      serverPort: clampPort(parsed.serverPort, DEFAULT_SETTINGS.serverPort),
      listenPort: clampPort(parsed.listenPort, DEFAULT_SETTINGS.listenPort, true),
      streamPort: clampPort(parsed.streamPort, DEFAULT_SETTINGS.streamPort, true),
      bufferMb:
        typeof parsed.bufferMb === 'number' && parsed.bufferMb >= 0.25 && parsed.bufferMb <= 64
          ? parsed.bufferMb
          : DEFAULT_SETTINGS.bufferMb,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const stored = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });

    if (!stored || !stored.username) {
      return null;
    }

    return { username: stored.username, password: stored.password };
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await Keychain.setGenericPassword(credentials.username, credentials.password, {
    service: KEYCHAIN_SERVICE,
  });
}

export async function clearCredentials(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  } catch {
    // Ignore.
  }
}

function clampPort(value: unknown, fallback: number, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const port = Math.trunc(value);

  if (allowZero && port === 0) {
    return 0;
  }

  return port >= 1 && port <= 65535 ? port : fallback;
}
