/**
 * Version manifest published by the VPS (`GET /api/app/version`).
 *
 * The app only trusts an HTTPS APK link and a SHA-256 digest: a manifest is
 * data from the network, so it is validated before it can change anything.
 */

export const UPDATE_MANIFEST_URL = 'https://thibautfontaine.space/api/app/version';

export interface AppVersionManifest {
  /** Monotonic Android versionCode; compared with the installed one. */
  versionCode: number;
  /** Human version shown in the prompt ("1.4.0"). */
  versionName: string;
  apkUrl: string;
  /** Lower-case hex SHA-256 of the APK. */
  sha256: string;
  notes?: string;
  sizeBytes?: number;
  publishedAt?: string;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** URL objects exist in Hermes and Node; any malformed link is refused. */
export function isTrustedApkUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns a clean manifest, or null when the answer cannot be trusted.
 * Optional fields are kept only when valid.
 */
export function parseVersionManifest(value: unknown): AppVersionManifest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<AppVersionManifest>;

  if (!positiveInteger(raw.versionCode)) {
    return null;
  }

  if (typeof raw.versionName !== 'string' || raw.versionName.trim().length === 0) {
    return null;
  }

  if (typeof raw.apkUrl !== 'string' || !isTrustedApkUrl(raw.apkUrl)) {
    return null;
  }

  if (typeof raw.sha256 !== 'string' || !SHA256_PATTERN.test(raw.sha256.trim())) {
    return null;
  }

  if (raw.sizeBytes !== undefined && !positiveInteger(raw.sizeBytes)) {
    return null;
  }

  if (raw.notes !== undefined && typeof raw.notes !== 'string') {
    return null;
  }

  if (raw.publishedAt !== undefined && typeof raw.publishedAt !== 'string') {
    return null;
  }

  return {
    versionCode: raw.versionCode,
    versionName: raw.versionName,
    apkUrl: raw.apkUrl,
    sha256: raw.sha256.trim().toLowerCase(),
    ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
    ...(raw.sizeBytes !== undefined ? { sizeBytes: raw.sizeBytes } : {}),
    ...(raw.publishedAt !== undefined ? { publishedAt: raw.publishedAt } : {}),
  };
}

/** Strictly newer builds only: reinstalling the same code changes nothing. */
export function isUpdateAvailable(currentVersionCode: number, manifest: AppVersionManifest): boolean {
  return Number.isFinite(currentVersionCode) && manifest.versionCode > currentVersionCode;
}

export function sha256Matches(expected: string, actual: string): boolean {
  const clean = actual.trim().toLowerCase();
  return SHA256_PATTERN.test(expected) && clean.length === 64 && clean === expected.trim().toLowerCase();
}
