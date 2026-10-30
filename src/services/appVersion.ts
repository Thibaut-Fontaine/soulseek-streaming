import { NativeModules } from 'react-native';

/**
 * The installed build's versionCode/versionName, read from Android's
 * BuildConfig through a tiny native module. Reading it must never throw: a
 * missing module (Jest, iOS) simply means no update check.
 */

export interface AppBuildInfo {
  versionCode: number;
  versionName: string;
}

interface BuildInfoNative {
  getBuildInfo(): Promise<{ versionCode?: unknown; versionName?: unknown }>;
}

export function normalizeBuildInfo(value: unknown): AppBuildInfo {
  if (!value || typeof value !== 'object') {
    return { versionCode: 0, versionName: '' };
  }

  const raw = value as { versionCode?: unknown; versionName?: unknown };
  const code = typeof raw.versionCode === 'number' && Number.isFinite(raw.versionCode)
    ? Math.trunc(raw.versionCode)
    : 0;

  return {
    versionCode: code > 0 ? code : 0,
    versionName: typeof raw.versionName === 'string' ? raw.versionName : '',
  };
}

function nativeModule(): BuildInfoNative | null {
  return (NativeModules.SoulStreamBuildInfo as BuildInfoNative | undefined) ?? null;
}

export async function getAppBuildInfo(): Promise<AppBuildInfo> {
  try {
    const native = nativeModule();
    return native ? normalizeBuildInfo(await native.getBuildInfo()) : normalizeBuildInfo(null);
  } catch {
    return normalizeBuildInfo(null);
  }
}
