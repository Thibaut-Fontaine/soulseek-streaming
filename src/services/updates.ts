/**
 * Update check and APK download against the VPS manifest.
 *
 * Nothing here touches React state: the update store wires it to the UI, so
 * these functions are testable with a fake fetch and a fake platform.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';

import {
  UPDATE_MANIFEST_URL,
  isUpdateAvailable,
  parseVersionManifest,
  sha256Matches,
} from '../core/update';
import type { AppVersionManifest } from '../core/update';

/** The part of `Response` the check uses, so tests need no real HTTP. */
export interface UpdateFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type UpdateFetch = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<UpdateFetchResponse>;

export type UpdateCheckResult =
  | { status: 'available'; manifest: AppVersionManifest }
  | { status: 'none' }
  | { status: 'offline'; error: string }
  | { status: 'error'; error: string };

export interface CheckForUpdateOptions {
  currentVersionCode: number;
  url?: string;
  fetchImpl?: UpdateFetch;
  timeoutMs?: number;
}

const CHECK_TIMEOUT_MS = 8000;

/**
 * Fetches and validates the manifest. Never throws: a failed check must not
 * delay or break the app that is already running.
 */
export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const {
    currentVersionCode,
    url = UPDATE_MANIFEST_URL,
    timeoutMs = CHECK_TIMEOUT_MS,
    fetchImpl = fetch as unknown as UpdateFetch,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: UpdateFetchResponse;

    try {
      response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      return {
        status: 'offline',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (!response.ok) {
      return { status: 'error', error: `HTTP ${response.status}` };
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      return { status: 'error', error: 'Réponse illisible' };
    }

    const manifest = parseVersionManifest(payload);

    if (!manifest) {
      return { status: 'error', error: 'Version invalide' };
    }

    return isUpdateAvailable(currentVersionCode, manifest)
      ? { status: 'available', manifest }
      : { status: 'none' };
  } finally {
    clearTimeout(timer);
  }
}

/** One in-flight APK download. */
export interface ApkDownload {
  promise: Promise<string>;
  cancel(): void;
}

/**
 * The file operations the updater needs. The app implementation uses
 * react-native-blob-util; tests use a fake.
 */
export interface UpdatePlatform {
  download(url: string, onProgress: (received: number, total: number) => void): ApkDownload;
  hashFile(path: string): Promise<string>;
  install(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

export type DownloadOutcome =
  | { status: 'ready'; path: string }
  | { status: 'cancelled' }
  | { status: 'corrupt' }
  | { status: 'failed'; error: string };

export interface DownloadHandle {
  promise: Promise<DownloadOutcome>;
  cancel(): void;
}

/**
 * Downloads the APK and checks it against the manifest digest before it can
 * be offered to the installer. A corrupt or partial file is deleted.
 */
export function startUpdateDownload(
  manifest: AppVersionManifest,
  platform: UpdatePlatform,
  onProgress: (received: number, total: number) => void = () => {},
): DownloadHandle {
  let cancelled = false;
  const download = platform.download(manifest.apkUrl, onProgress);

  const promise = (async (): Promise<DownloadOutcome> => {
    let path: string;

    try {
      path = await download.promise;
    } catch (error) {
      return cancelled
        ? { status: 'cancelled' }
        : { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }

    if (cancelled) {
      await platform.removeFile(path);
      return { status: 'cancelled' };
    }

    try {
      const digest = await platform.hashFile(path);

      if (!sha256Matches(manifest.sha256, digest)) {
        await platform.removeFile(path);
        return { status: 'corrupt' };
      }
    } catch (error) {
      await platform.removeFile(path);
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }

    return { status: 'ready', path };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      download.cancel();
    },
  };
}

/**
 * react-native-blob-util's FileProvider exposes the downloaded file to the
 * system package installer (authority `<applicationId>.provider`, declared by
 * the library). `REQUEST_INSTALL_PACKAGES` lets Android start that installer;
 * the user still has to confirm the installation.
 */
export const defaultUpdatePlatform: UpdatePlatform = {
  download: (url, onProgress) => {
    const task = ReactNativeBlobUtil.config({
      fileCache: true,
      appendExt: 'apk',
    }).fetch('GET', url);

    task.progress({ interval: 250 }, (received, total) => onProgress(Number(received), Number(total)));

    return {
      promise: task.then(response => response.path()),
      cancel: () => task.cancel(),
    };
  },

  hashFile: path => ReactNativeBlobUtil.fs.hash(path, 'sha256'),

  install: async path => {
    await ReactNativeBlobUtil.android.actionViewIntent(path, 'application/vnd.android.package-archive');
  },

  removeFile: async path => {
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
  },
};
