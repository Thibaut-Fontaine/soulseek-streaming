/**
 * Contract of `GET /api/app/version`, ready to be mounted on the VPS.
 *
 * This file is not deployed by the app release: it documents and tests the
 * answer the updater expects. The manifest is validated with the same parser
 * as the client, so a malformed file is never served.
 */
import { parseVersionManifest } from '../../src/core/update';
import type { AppVersionManifest } from '../../src/core/update';

export const VERSION_PATH = '/api/app/version';

export interface VersionApiRequest {
  method: string;
  path: string;
  /** Ignored by the contract: only the path and method select the route. */
  query?: string;
}

export interface VersionApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // New builds are published seldom; a short cache is enough and keeps the
  // check cheap when many clients start at once.
  'cache-control': 'public, max-age=300',
};

function response(statusCode: number, body: unknown, headers: Record<string, string> = JSON_HEADERS): VersionApiResponse {
  return { statusCode, headers, body: JSON.stringify(body) };
}

export function createVersionHandler(fixture: unknown) {
  const manifest: AppVersionManifest | null = parseVersionManifest(fixture);

  return (request: VersionApiRequest): VersionApiResponse => {
    if (request.method.toUpperCase() !== 'GET') {
      return response(405, { error: 'method_not_allowed' }, { ...JSON_HEADERS, allow: 'GET' });
    }

    if (request.path !== VERSION_PATH) {
      return response(404, { error: 'not_found' });
    }

    if (!manifest) {
      return response(500, { error: 'invalid_manifest' });
    }

    return response(200, manifest);
  };
}
