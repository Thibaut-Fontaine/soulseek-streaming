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
  /** Share the tracks already played with other users. */
  shareEnabled: boolean;
  /** Only upload while on Wi-Fi (or Ethernet). */
  shareWifiOnly: boolean;
  /** Disk space for played tracks (the shared folder), in MiB. */
  cacheMb: number;
  /**
   * Use the online catalog (Deezer) for covers, titles, artist and album
   * pages. Off: only Soulseek file names, nothing leaves for another service.
   */
  catalogEnabled: boolean;
  /**
   * Show the names of the people sending files. Off by default: the app hides
   * uploader identities in the player, source lists and shared journals.
   */
  showUploaders: boolean;
  /**
   * Send the redacted debug journal to the SoulStream log service. Off by
   * default; anonymous installation id, no account or peer details.
   */
  logUploadEnabled: boolean;
  /** Continue a finished list with catalog recommendations. Off by default. */
  autoplayEnabled: boolean;
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
  // Starting playback matters more than a long safety margin: 500 KiB is
  // about two seconds of a 192 kb/s MP3, and the native player keeps
  // downloading while it plays.
  bufferMb: 0.5,
  shareEnabled: true,
  shareWifiOnly: true,
  cacheMb: 1024,
  catalogEnabled: true,
  showUploaders: false,
  logUploadEnabled: false,
  autoplayEnabled: false,
};

/**
 * Settings moved to v2 when the default buffer dropped from 2 MiB to 500 KiB:
 * the key itself carries the version, so an explicit choice made after the
 * migration is never confused with the old default.
 */
export const SETTINGS_KEY = '@soulstream/settings/v2';
export const LEGACY_SETTINGS_KEY = '@soulstream/settings/v1';
const KEYCHAIN_SERVICE = 'com.soulstream.soulseek';
/** The old default, replaced by `DEFAULT_SETTINGS.bufferMb` on migration. */
const LEGACY_DEFAULT_BUFFER_MB = 2;

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);

    if (raw) {
      return settingsFromStored(JSON.parse(raw));
    }

    const legacy = await AsyncStorage.getItem(LEGACY_SETTINGS_KEY);

    if (!legacy) {
      return { ...DEFAULT_SETTINGS };
    }

    const migrated = settingsFromStored(JSON.parse(legacy), { legacy: true });
    // Persist the migration so the old default cannot come back later.
    await saveSettings(migrated);
    return migrated;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Validates stored settings. `legacy` reads a v1 payload, where 2 MiB was the
 * default rather than necessarily a deliberate choice.
 */
export function settingsFromStored(value: unknown, options: { legacy?: boolean } = {}): Settings {
  const parsed = value && typeof value === 'object' ? (value as Partial<Settings>) : {};
  const storedBuffer = validBuffer(parsed.bufferMb);
  const bufferMb =
    storedBuffer === null || (options.legacy && storedBuffer === LEGACY_DEFAULT_BUFFER_MB)
      ? DEFAULT_SETTINGS.bufferMb
      : storedBuffer;

  return {
    serverHost:
      typeof parsed.serverHost === 'string' && parsed.serverHost.trim()
        ? parsed.serverHost.trim()
        : DEFAULT_SETTINGS.serverHost,
    serverPort: clampPort(parsed.serverPort, DEFAULT_SETTINGS.serverPort),
    listenPort: clampPort(parsed.listenPort, DEFAULT_SETTINGS.listenPort, true),
    streamPort: clampPort(parsed.streamPort, DEFAULT_SETTINGS.streamPort, true),
    bufferMb,
    shareEnabled:
      typeof parsed.shareEnabled === 'boolean' ? parsed.shareEnabled : DEFAULT_SETTINGS.shareEnabled,
    shareWifiOnly:
      typeof parsed.shareWifiOnly === 'boolean'
        ? parsed.shareWifiOnly
        : DEFAULT_SETTINGS.shareWifiOnly,
    cacheMb:
      typeof parsed.cacheMb === 'number' && parsed.cacheMb >= 100 && parsed.cacheMb <= 20000
        ? Math.round(parsed.cacheMb)
        : DEFAULT_SETTINGS.cacheMb,
    catalogEnabled:
      typeof parsed.catalogEnabled === 'boolean'
        ? parsed.catalogEnabled
        : DEFAULT_SETTINGS.catalogEnabled,
    showUploaders:
      typeof parsed.showUploaders === 'boolean'
        ? parsed.showUploaders
        : DEFAULT_SETTINGS.showUploaders,
    logUploadEnabled:
      typeof parsed.logUploadEnabled === 'boolean'
        ? parsed.logUploadEnabled
        : DEFAULT_SETTINGS.logUploadEnabled,
    autoplayEnabled:
      typeof parsed.autoplayEnabled === 'boolean'
        ? parsed.autoplayEnabled
        : DEFAULT_SETTINGS.autoplayEnabled,
  };
}

/** "500 Ko" under one Mo, "2 Mo" above: sizes are shown as users say them. */
export function formatBufferMb(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '—';
  }

  if (value < 1) {
    // Decimal Ko, as users and file managers show small files: the default
    // 0.5 MiB setting reads "500 Ko".
    return `${Math.round(value * 1000)} Ko`;
  }

  return `${String(Math.round(value * 10) / 10).replace('.', ',')} Mo`;
}

function validBuffer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.25 && value <= 64
    ? value
    : null;
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
