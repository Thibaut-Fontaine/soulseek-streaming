/**
 * App-side singleton for the optional remote journal (feature 7).
 *
 * Opt-in, default off (Réglages → Confidentialité). It sends only an
 * anonymous installation id, the app version, the platform and redacted log
 * lines: never the Soulseek account, password, peer names or file paths.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { version as APP_VERSION } from '../../package.json';
import { createLogUploader } from './logUploader';
import type { LogUploader } from './logUploader';
import type { LogEntry } from './debugLog';

/**
 * The VPS endpoint. The owner adds the nginx location after reviewing the
 * server in `server/logs/`; the setting is off by default, so no request is
 * made until the user enables it.
 */
export const DEFAULT_LOG_ENDPOINT = 'https://thibautfontaine.space/logs/v1/logs';

let enabled = false;
let uploader: LogUploader | null = null;

function instance(): LogUploader {
  if (!uploader) {
    uploader = createLogUploader({
      endpoint: DEFAULT_LOG_ENDPOINT,
      appVersion: APP_VERSION,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      storage: AsyncStorage,
      enabled: () => enabled,
    });
  }
  return uploader;
}

/** Called from the store whenever settings are loaded or changed. */
export function configureRemoteLog(nextEnabled: boolean): void {
  enabled = nextEnabled;
  if (enabled) {
    instance().wake();
  }
}

export async function startRemoteLog(): Promise<void> {
  await instance().start();
}

export async function stopRemoteLog(): Promise<void> {
  await instance().stop();
}

/** `debugLog` calls this on every line; it is a no-op while the setting is off. */
export function enqueueRemoteLog(entry: LogEntry): void {
  if (!enabled) {
    return;
  }
  instance().enqueue(entry);
}

/** Drops queued lines (the setting was just turned off). */
export async function clearRemoteLogQueue(): Promise<void> {
  await instance().clear();
}
