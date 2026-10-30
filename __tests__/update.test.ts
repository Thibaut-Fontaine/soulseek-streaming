import {
  UPDATE_MANIFEST_URL,
  isTrustedApkUrl,
  isUpdateAvailable,
  parseVersionManifest,
  sha256Matches,
} from '../src/core/update';
import type { AppVersionManifest } from '../src/core/update';
import {
  checkForUpdate,
  startUpdateDownload,
} from '../src/services/updates';
import type { UpdatePlatform } from '../src/services/updates';
import { normalizeBuildInfo } from '../src/services/appVersion';
import { createVersionHandler } from '../server/version-api/handler';

const SHA = 'a'.repeat(64);

function manifest(overrides: Partial<AppVersionManifest> = {}): AppVersionManifest {
  return {
    versionCode: 19,
    versionName: '1.4.0',
    apkUrl: 'https://thibautfontaine.space/streaming/SoulStream.apk',
    sha256: SHA,
    notes: 'Continuite de lecture et confidentialite.',
    sizeBytes: 59_521_454,
    publishedAt: '2026-10-30T10:00:00Z',
    ...overrides,
  };
}

function fakePlatform(overrides: Partial<UpdatePlatform> = {}) {
  let resolveDownload!: (path: string) => void;
  let rejectDownload!: (error: Error) => void;
  const downloadPromise = new Promise<string>((resolve, reject) => {
    resolveDownload = resolve;
    rejectDownload = reject;
  });
  const cancel = jest.fn();
  const platform: UpdatePlatform & {
    resolve: (path: string) => void;
    reject: (error: Error) => void;
    cancel: jest.Mock;
  } = {
    download: jest.fn(() => ({ promise: downloadPromise, cancel })),
    hashFile: jest.fn(async () => SHA),
    install: jest.fn(async () => {}),
    removeFile: jest.fn(async () => {}),
    resolve: (path: string) => resolveDownload(path),
    reject: (error: Error) => rejectDownload(error),
    cancel,
    ...overrides,
  } as never;
  return platform;
}

describe('version manifest', () => {
  it('accepts a complete manifest and computes the update decision', () => {
    const parsed = parseVersionManifest(manifest());
    expect(parsed).toEqual(manifest());
    expect(isUpdateAvailable(18, parsed!)).toBe(true);
    expect(isUpdateAvailable(19, parsed!)).toBe(false);
    expect(isUpdateAvailable(20, parsed!)).toBe(false);
  });

  it('rejects missing fields, unsafe URLs and malformed hashes', () => {
    expect(parseVersionManifest(null)).toBeNull();
    expect(parseVersionManifest({ ...manifest(), versionCode: 0 })).toBeNull();
    expect(parseVersionManifest({ ...manifest(), versionName: '' })).toBeNull();
    expect(parseVersionManifest({ ...manifest(), apkUrl: 'http://example.com/app.apk' })).toBeNull();
    expect(parseVersionManifest({ ...manifest(), apkUrl: 'not a url' })).toBeNull();
    expect(parseVersionManifest({ ...manifest(), sha256: 'abc' })).toBeNull();
    expect(parseVersionManifest({ ...manifest(), sizeBytes: -1 })).toBeNull();
  });

  it('only trusts HTTPS download links', () => {
    expect(isTrustedApkUrl('https://example.com/app.apk')).toBe(true);
    expect(isTrustedApkUrl('http://example.com/app.apk')).toBe(false);
    expect(isTrustedApkUrl('file:///data/app.apk')).toBe(false);
  });

  it('compares SHA-256 digests case-insensitively', () => {
    expect(sha256Matches(SHA, SHA.toUpperCase())).toBe(true);
    expect(sha256Matches(SHA, 'b'.repeat(64))).toBe(false);
    expect(sha256Matches(SHA, '')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  const fetchJson = (body: unknown, ok = true, status = 200) =>
    jest.fn(async () => ({ ok, status, json: async () => body }));

  it('offers a strictly newer build', async () => {
    const result = await checkForUpdate({
      currentVersionCode: 18,
      fetchImpl: fetchJson(manifest()),
    });
    expect(result).toMatchObject({ status: 'available', manifest: { versionCode: 19 } });
  });

  it('stays quiet for the current or an older build', async () => {
    expect(
      await checkForUpdate({ currentVersionCode: 19, fetchImpl: fetchJson(manifest()) }),
    ).toEqual({ status: 'none' });
    expect(
      await checkForUpdate({
        currentVersionCode: 20,
        fetchImpl: fetchJson(manifest({ versionCode: 19 })),
      }),
    ).toEqual({ status: 'none' });
  });

  it('reports offline without throwing', async () => {
    const result = await checkForUpdate({
      currentVersionCode: 18,
      fetchImpl: jest.fn(async () => {
        throw new Error('Network request failed');
      }),
    });
    expect(result.status).toBe('offline');
  });

  it('reports bad HTTP answers and invalid manifests as errors', async () => {
    expect(
      (await checkForUpdate({ currentVersionCode: 18, fetchImpl: fetchJson({}, false, 500) })).status,
    ).toBe('error');
    expect(
      (await checkForUpdate({ currentVersionCode: 18, fetchImpl: fetchJson({ versionCode: 19 }) })).status,
    ).toBe('error');
    expect(
      (
        await checkForUpdate({
          currentVersionCode: 18,
          fetchImpl: jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('bad json');
            },
          })),
        })
      ).status,
    ).toBe('error');
  });

  it('uses the VPS manifest endpoint by default', () => {
    expect(UPDATE_MANIFEST_URL).toBe('https://thibautfontaine.space/api/app/version');
  });
});

describe('download and verification', () => {
  it('downloads, hashes and accepts a matching APK', async () => {
    const platform = fakePlatform();
    const progress = jest.fn();
    const task = startUpdateDownload(manifest(), platform, progress);
    platform.resolve('/cache/update.apk');

    const outcome = await task.promise;
    expect(outcome).toEqual({ status: 'ready', path: '/cache/update.apk' });
    expect(platform.hashFile).toHaveBeenCalledWith('/cache/update.apk');
    expect(platform.removeFile).not.toHaveBeenCalled();
    expect(platform.install).not.toHaveBeenCalled();
  });

  it('deletes a corrupt APK instead of offering it', async () => {
    const platform = fakePlatform({ hashFile: jest.fn(async () => 'b'.repeat(64)) });
    const task = startUpdateDownload(manifest(), platform);
    platform.resolve('/cache/update.apk');

    expect(await task.promise).toEqual({ status: 'corrupt' });
    expect(platform.removeFile).toHaveBeenCalledWith('/cache/update.apk');
    expect(platform.install).not.toHaveBeenCalled();
  });

  it('reports a failed download', async () => {
    const platform = fakePlatform();
    const task = startUpdateDownload(manifest(), platform);
    platform.reject(new Error('connection lost'));

    expect(await task.promise).toMatchObject({ status: 'failed' });
    expect(platform.install).not.toHaveBeenCalled();
  });

  it('cancels a download and never installs it', async () => {
    const platform = fakePlatform();
    const task = startUpdateDownload(manifest(), platform);
    task.cancel();
    platform.reject(new Error('canceled'));

    expect(await task.promise).toEqual({ status: 'cancelled' });
    expect(platform.install).not.toHaveBeenCalled();
  });
});

describe('build info', () => {
  it('reads versionCode safely and falls back to 0', () => {
    expect(normalizeBuildInfo({ versionCode: 18, versionName: '1.3' })).toEqual({
      versionCode: 18,
      versionName: '1.3',
    });
    expect(normalizeBuildInfo({ versionCode: 18.9, versionName: '1.3' }).versionCode).toBe(18);
    expect(normalizeBuildInfo({ versionCode: 'nope', versionName: 4 })).toEqual({
      versionCode: 0,
      versionName: '',
    });
    expect(normalizeBuildInfo(null)).toEqual({ versionCode: 0, versionName: '' });
  });
});

describe('GET /api/app/version contract', () => {
  const fixture = require('../server/version-api/app-version.json');
  const handler = createVersionHandler(fixture);

  it('serves the manifest as JSON', () => {
    const response = handler({ method: 'GET', path: '/api/app/version' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(response.body);
    expect(body.versionCode).toBe(fixture.versionCode);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers only that route and that method', () => {
    expect(handler({ method: 'GET', path: '/api/app/versions' }).statusCode).toBe(404);
    expect(handler({ method: 'POST', path: '/api/app/version' }).statusCode).toBe(405);
    expect(handler({ method: 'GET', path: '/api/app/version', query: 'x=1' }).statusCode).toBe(200);
  });

  it('refuses to serve an invalid manifest', () => {
    const invalid = createVersionHandler({ versionCode: 3 });
    expect(invalid({ method: 'GET', path: '/api/app/version' }).statusCode).toBe(500);
  });
});
