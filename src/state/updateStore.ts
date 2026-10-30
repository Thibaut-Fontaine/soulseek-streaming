/**
 * The update prompt: check once at startup, download to the cache, verify the
 * manifest digest, then hand the file to the system installer.
 *
 * The check and download implementations are injectable so tests never touch
 * the network or the file system.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { AppVersionManifest } from '../core/update';
import { getAppBuildInfo } from '../services/appVersion';
import { checkForUpdate, defaultUpdatePlatform, startUpdateDownload } from '../services/updates';
import type { DownloadHandle, UpdateFetch, UpdatePlatform } from '../services/updates';

export const DISMISSED_UPDATE_KEY = '@soulstream/update-dismissed/v1';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  manifest: AppVersionManifest | null;
  /** 0–1 while downloading. */
  progress: number;
  error: string | null;
  /** Verified APK path, ready for the system installer. */
  downloadedPath: string | null;
  /** Never throws; offline/errors leave the app untouched. */
  check(): Promise<void>;
  /** Hides the prompt for this versionCode (persisted across launches). */
  dismiss(): Promise<void>;
  download(): Promise<void>;
  cancel(): void;
  /** Opens the Android package installer; the user still confirms. */
  install(): Promise<void>;
}

let platform: UpdatePlatform = defaultUpdatePlatform;
let fetcher: UpdateFetch | undefined;
let downloadTask: DownloadHandle | null = null;

/** Tests replace the file operations and the network call. */
export function setUpdatePlatform(value: UpdatePlatform): void {
  platform = value;
}

export function setUpdateFetcher(value: UpdateFetch | undefined): void {
  fetcher = value;
}

async function dismissedVersionCode(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_UPDATE_KEY);
    const code = Number(raw);
    return Number.isFinite(code) ? code : 0;
  } catch {
    return 0;
  }
}

async function rememberDismissed(versionCode: number): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_UPDATE_KEY, String(versionCode));
  } catch {
    // The prompt may reappear next launch; nothing else breaks.
  }
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  manifest: null,
  progress: 0,
  error: null,
  downloadedPath: null,

  check: async () => {
    const running = get().status;
    if (running === 'checking' || running === 'downloading' || running === 'installing') {
      return;
    }

    set({ status: 'checking', error: null });

    const [build, dismissed] = await Promise.all([getAppBuildInfo(), dismissedVersionCode()]);
    const result = await checkForUpdate({
      currentVersionCode: build.versionCode,
      ...(fetcher ? { fetchImpl: fetcher } : {}),
    });

    if (result.status !== 'available' || result.manifest.versionCode <= dismissed) {
      // Offline, invalid answer, current build or dismissed: stay invisible.
      set({ status: 'idle', manifest: null, progress: 0, error: null, downloadedPath: null });
      return;
    }

    set({
      status: 'available',
      manifest: result.manifest,
      progress: 0,
      error: null,
      downloadedPath: null,
    });
  },

  dismiss: async () => {
    const versionCode = get().manifest?.versionCode;
    if (versionCode) {
      await rememberDismissed(versionCode);
    }
    // A download running in the background must not reopen the prompt later.
    downloadTask?.cancel();
    downloadTask = null;
    set({ status: 'idle', manifest: null, progress: 0, error: null, downloadedPath: null });
  },

  download: async () => {
    const manifest = get().manifest;
    if (!manifest || get().status === 'downloading') {
      return;
    }

    downloadTask?.cancel();
    set({ status: 'downloading', progress: 0, error: null });

    const task = startUpdateDownload(manifest, platform, (received, total) => {
      set({ progress: total > 0 ? Math.min(1, received / total) : 0 });
    });
    downloadTask = task;

    const outcome = await task.promise;

    // Dismissed or replaced while downloading: do not bring the prompt back.
    if (downloadTask !== task) {
      return;
    }

    downloadTask = null;

    switch (outcome.status) {
      case 'ready':
        set({ status: 'ready', downloadedPath: outcome.path, progress: 1, error: null });
        return;
      case 'cancelled':
        set({ status: 'available', progress: 0, error: null });
        return;
      case 'corrupt':
        set({
          status: 'error',
          progress: 0,
          downloadedPath: null,
          error: 'Le fichier téléchargé est incomplet ou corrompu.',
        });
        return;
      default:
        set({
          status: 'error',
          progress: 0,
          downloadedPath: null,
          error: `Téléchargement impossible : ${outcome.error}`,
        });
    }
  },

  cancel: () => {
    downloadTask?.cancel();
    set({ status: 'available', progress: 0, error: null });
  },

  install: async () => {
    const path = get().downloadedPath;
    if (!path) {
      return;
    }

    set({ status: 'installing', error: null });

    try {
      await platform.install(path);
      set({ status: 'ready', error: null });
    } catch {
      set({
        status: 'error',
        error:
          'Impossible d’ouvrir l’installateur. Autorisez l’installation depuis cette source dans les réglages Android, puis réessayez.',
      });
    }
  },
}));
