/**
 * Small, dependency-free log ingest service (feature 7).
 *
 * `handle` is pure enough to test without sockets: the HTTP adapter below
 * reads a bounded body and passes it here. The store keeps recent records in
 * memory, bounded by age and count; `JsonlLogStore` (file-store.ts) is the
 * VPS persistence layer.
 */
import { MAX_LOG_MESSAGE, isInstallationId, parseLogReport } from '../../src/core/logPrivacy';
import type { RemoteLogLevel } from '../../src/core/logPrivacy';

export interface IngestRequest {
  method: string;
  path: string;
  ip: string;
  /** Header names may be in any case. */
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface IngestResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface StoredLogRecord {
  at: number;
  receivedAt: number;
  installationId: string;
  appVersion: string;
  platform: 'android' | 'ios';
  level: RemoteLogLevel;
  tag: string;
  message: string;
}

export interface LogSink {
  readonly records: readonly StoredLogRecord[];
  append(records: StoredLogRecord[]): void;
  prune(now?: number): void;
  deleteInstallation(installationId: string): number;
  stats(): { records: number; installations: number; bytes: number };
}

export interface LogStoreOptions {
  /** Events older than this are dropped. Default: 7 days. */
  retentionMs?: number;
  /** Ring buffer size, the rotation policy. Default: 50 000 events. */
  maxRecords?: number;
  now?: () => number;
}

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 50_000;

export class LogStore implements LogSink {
  private readonly recordsInternal: StoredLogRecord[] = [];
  private readonly retentionMs: number;
  private readonly maxRecords: number;
  private readonly clock: () => number;

  constructor(options: LogStoreOptions = {}) {
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.clock = options.now ?? Date.now;
  }

  get records(): readonly StoredLogRecord[] {
    return this.recordsInternal;
  }

  append(records: StoredLogRecord[]): void {
    this.recordsInternal.push(...records);
    this.prune();
    if (this.recordsInternal.length > this.maxRecords) {
      this.recordsInternal.splice(0, this.recordsInternal.length - this.maxRecords);
    }
  }

  prune(now = this.clock()): void {
    const cutoff = now - this.retentionMs;
    let drop = 0;
    while (drop < this.recordsInternal.length && this.recordsInternal[drop].receivedAt < cutoff) {
      drop++;
    }
    if (drop > 0) {
      this.recordsInternal.splice(0, drop);
    }
  }

  deleteInstallation(installationId: string): number {
    const before = this.recordsInternal.length;
    for (let index = this.recordsInternal.length - 1; index >= 0; index--) {
      if (this.recordsInternal[index].installationId === installationId) {
        this.recordsInternal.splice(index, 1);
      }
    }
    return before - this.recordsInternal.length;
  }

  stats(): { records: number; installations: number; bytes: number } {
    let bytes = 0;
    const installations = new Set<string>();
    for (const record of this.recordsInternal) {
      installations.add(record.installationId);
      bytes += Buffer.byteLength(record.message, 'utf8');
    }
    return { records: this.recordsInternal.length, installations: installations.size, bytes };
  }
}

/** Fixed-window counters. Denied requests do not consume budget. */
class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number): { allowed: boolean; retryAfterSec: number } {
    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSec: Math.ceil(this.windowMs / 1000) };
    }

    if (entry.count >= this.limit) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }

    entry.count++;
    return { allowed: true, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
}

export interface LogIngestOptions extends LogStoreOptions {
  /** Largest accepted body, enforced again by the HTTP adapter. Default 64 KiB. */
  maxBodyBytes?: number;
  perInstallationPerWindow?: number;
  perIpPerWindow?: number;
  windowMs?: number;
  /**
   * Optional shared bearer token (e.g. set in systemd). The app sends no
   * credential by default: its anonymous installation id is the identity.
   */
  ingestToken?: string | null;
  store?: LogSink;
}

export interface LogIngest {
  store: LogSink;
  handle(request: IngestRequest): Promise<IngestResponse>;
}

const DEFAULT_MAX_BODY = 64 * 1024;
const DEFAULT_INSTALL_LIMIT = 120;
const DEFAULT_IP_LIMIT = 300;
const DEFAULT_WINDOW_MS = 60 * 1000;

function header(request: IngestRequest, name: string): string {
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
    }
  }
  return '';
}

function reply(status: number, body?: unknown, headers?: Record<string, string>): IngestResponse {
  return { status, body, headers: { 'cache-control': 'no-store', ...headers } };
}

function errorReply(status: number, error: string, headers?: Record<string, string>): IngestResponse {
  return reply(status, { error }, headers);
}

export function createLogIngest(options: LogIngestOptions = {}): LogIngest {
  const clock = options.now ?? Date.now;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const store = options.store ?? new LogStore(options);
  const installations = new RateLimiter(
    options.perInstallationPerWindow ?? DEFAULT_INSTALL_LIMIT,
    options.windowMs ?? DEFAULT_WINDOW_MS,
  );
  const addresses = new RateLimiter(options.perIpPerWindow ?? DEFAULT_IP_LIMIT, options.windowMs ?? DEFAULT_WINDOW_MS);

  function limited(by: RateLimiter, key: string, now: number): IngestResponse | null {
    const result = by.allow(key, now);
    if (result.allowed) {
      return null;
    }
    return errorReply(429, 'rate_limited', { 'retry-after': String(result.retryAfterSec) });
  }

  return {
    store,

    async handle(request) {
      const now = clock();
      const path = request.path.split('?')[0];

      if (path === '/v1/health' && request.method === 'GET') {
        return reply(200, { ok: true });
      }

      if (path === '/v1/logs' && request.method !== 'POST') {
        return errorReply(405, 'method_not_allowed', { allow: 'POST' });
      }

      if (path !== '/v1/logs' && !/^\/v1\/installations\/[^/]+$/.test(path)) {
        return errorReply(404, 'not_found');
      }

      const installationId = header(request, 'x-installation-id').trim();
      if (!isInstallationId(installationId)) {
        return errorReply(401, 'installation_required');
      }

      if (options.ingestToken) {
        const authorization = header(request, 'authorization');
        if (authorization !== `Bearer ${options.ingestToken}`) {
          return errorReply(401, 'unauthorized');
        }
      }

      const installationLimit = limited(installations, installationId, now);
      if (installationLimit) {
        return installationLimit;
      }

      const ipLimit = limited(addresses, request.ip || 'unknown', now);
      if (ipLimit) {
        return ipLimit;
      }

      if (request.method === 'DELETE') {
        const match = /^\/v1\/installations\/([^/]+)$/.exec(path);
        if (!match) {
          return errorReply(404, 'not_found');
        }
        const target = decodeURIComponent(match[1]);
        if (target !== installationId) {
          return errorReply(403, 'installation_mismatch');
        }
        store.deleteInstallation(installationId);
        return reply(204);
      }

      if (path !== '/v1/logs') {
        return errorReply(404, 'not_found');
      }

      const contentType = header(request, 'content-type').toLowerCase();
      if (!contentType.startsWith('application/json')) {
        return errorReply(415, 'json_required');
      }

      if (Buffer.byteLength(request.body, 'utf8') > maxBodyBytes) {
        return errorReply(413, 'body_too_large');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(request.body);
      } catch {
        return errorReply(400, 'invalid_json');
      }

      const parsed = parseLogReport(payload, installationId);
      if (!parsed.ok) {
        if (
          typeof payload === 'object' &&
          payload !== null &&
          typeof (payload as { installationId?: unknown }).installationId === 'string' &&
          (payload as { installationId: string }).installationId !== installationId &&
          isInstallationId((payload as { installationId: string }).installationId)
        ) {
          return errorReply(403, 'installation_mismatch');
        }
        return errorReply(400, 'invalid_report');
      }

      const report = parsed.report;
      store.append(
        report.events.map(event => ({
          at: event.at,
          receivedAt: now,
          installationId: report.installationId,
          appVersion: report.app.version,
          platform: report.app.platform,
          level: event.level,
          tag: event.tag,
          // Defense in depth: parseLogReport already redacted, but a future
          // caller must not be able to bypass this line.
          message: event.message.slice(0, MAX_LOG_MESSAGE),
        })),
      );

      return reply(202, { accepted: report.events.length });
    },
  };
}
