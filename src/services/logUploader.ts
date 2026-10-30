/**
 * Offline queue for the optional remote journal (feature 7).
 *
 * `debugLog` calls `enqueue` synchronously; this module never blocks the JS
 * thread. Events are redacted before they enter the queue, persisted to
 * AsyncStorage and posted in small batches. A failed upload leaves the queue
 * intact and is retried later; a report the server refuses is dropped so one
 * bad event cannot block the queue forever.
 */
import {
  MAX_LOG_MESSAGE,
  isInstallationId,
  redactLogText,
} from '../core/logPrivacy';
import type { RemoteLogEvent, RemoteLogLevel } from '../core/logPrivacy';

export interface RemoteLogStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface UploadRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export type UploadFetch = (url: string, init: UploadRequestInit) => Promise<{ ok: boolean; status: number }>;

export interface UploadEntry {
  at: number;
  tag: string;
  message: string;
  /** Defaults to debug for `perf`, info otherwise. */
  level?: RemoteLogLevel;
}

export type FlushStatus = 'disabled' | 'empty' | 'ok' | 'retry' | 'dropped';

export interface FlushResult {
  status: FlushStatus;
  sent: number;
}

export interface LogUploaderOptions {
  endpoint: string;
  appVersion: string;
  platform: 'android' | 'ios';
  storage: RemoteLogStorage;
  /** Read on every use: the Réglages switch is the source of truth. */
  enabled: () => boolean;
  fetchImpl?: UploadFetch;
  now?: () => number;
  randomId?: () => string;
  batchSize?: number;
  maxQueue?: number;
  flushIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface LogUploader {
  start(): Promise<void>;
  /** Stops the timer, waits for the queue write, never for the network. */
  stop(): Promise<void>;
  enqueue(entry: UploadEntry): void;
  flush(): Promise<FlushResult>;
  pending(): number;
  installationId(): Promise<string>;
  clear(): Promise<void>;
  /** Re-arms the timer after the user enables the setting. */
  wake(): void;
}

export const LOG_QUEUE_KEY = '@soulstream/log-upload/v1/queue';
export const LOG_INSTALLATION_KEY = '@soulstream/log-upload/v1/installation';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_QUEUE = 500;
const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_RETRY_BASE_MS = 30_000;
const DEFAULT_RETRY_MAX_MS = 30 * 60_000;

function generateInstallationId(): string {
  const alphabet = '0123456789abcdef';
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  const bytes = new Uint8Array(32);

  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let id = 'inst_';
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }
  return id;
}

function validEvent(value: unknown): value is RemoteLogEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const event = value as Partial<RemoteLogEvent>;
  return (
    typeof event.at === 'number' &&
    Number.isInteger(event.at) &&
    event.at >= 0 &&
    typeof event.level === 'string' &&
    ['debug', 'info', 'warn', 'error'].includes(event.level) &&
    typeof event.tag === 'string' &&
    /^[a-z0-9_-]{1,16}$/.test(event.tag) &&
    typeof event.message === 'string' &&
    event.message.length > 0 &&
    event.message.length <= MAX_LOG_MESSAGE
  );
}

function dedupe(events: RemoteLogEvent[]): RemoteLogEvent[] {
  const seen = new Set<string>();
  const kept: RemoteLogEvent[] = [];
  // Newest side wins; the queue is chronological.
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    const key = `${event.at}\u0000${event.tag}\u0000${event.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      kept.unshift(event);
    }
  }
  return kept;
}

function retryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function createLogUploader(options: LogUploaderOptions): LogUploader {
  const fetchImpl: UploadFetch =
    options.fetchImpl ??
    ((url, init) => fetch(url, init).then(response => ({ ok: response.ok, status: response.status })));
  const now = options.now ?? Date.now;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const maxQueue = Math.max(1, options.maxQueue ?? DEFAULT_MAX_QUEUE);
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;

  let events: RemoteLogEvent[] = [];
  let hydrated = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<FlushResult> | null = null;
  let failures = 0;
  let persistChain: Promise<void> = Promise.resolve();
  let installationPromise: Promise<string> | null = null;

  function trim(): void {
    if (events.length > maxQueue) {
      events.splice(0, events.length - maxQueue);
    }
  }

  function persistQueue(): Promise<void> {
    const snapshot = JSON.stringify(events);
    persistChain = persistChain
      .then(() => options.storage.setItem(LOG_QUEUE_KEY, snapshot))
      .catch(() => {
        // Storage is best effort: the in-memory queue still uploads.
      });
    return persistChain;
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(ms: number): void {
    if (!started || !options.enabled() || timer !== null) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void uploader.flush().finally(() => {
        if (started && options.enabled() && events.length === 0) {
          schedule(flushIntervalMs);
        }
      });
    }, Math.max(0, ms));
  }

  function scheduleRetry(): void {
    const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.max(0, failures - 1));
    schedule(delay);
  }

  async function sendBatch(): Promise<'ok' | 'retry' | 'dropped'> {
    if (events.length === 0) {
      return 'ok';
    }

    const batch = events.slice(0, batchSize);
    const installationId = await uploader.installationId();
    let response: { ok: boolean; status: number };

    try {
      response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-installation-id': installationId,
        },
        body: JSON.stringify({
          schema: 1,
          installationId,
          app: { version: options.appVersion, platform: options.platform },
          events: batch,
        }),
      });
    } catch {
      failures++;
      return 'retry';
    }

    if (response.ok) {
      events.splice(0, batch.length);
      failures = 0;
      void persistQueue();
      return 'ok';
    }

    if (retryable(response.status)) {
      failures++;
      return 'retry';
    }

    // A malformed report (400/413) or a rejected identity (401/403) will not
    // improve by retrying the same bytes: drop that batch.
    events.splice(0, batch.length);
    void persistQueue();
    return 'dropped';
  }

  const uploader: LogUploader = {
    async start() {
      if (started) {
        return;
      }
      started = true;

      if (!hydrated) {
        hydrated = true;
        try {
          const raw = await options.storage.getItem(LOG_QUEUE_KEY);
          if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              events = dedupe([...parsed.filter(validEvent), ...events]).slice(-maxQueue);
            }
          }
        } catch {
          // A corrupt queue is discarded rather than blocking the app.
        }
      }

      await uploader.installationId();
      if (options.enabled()) {
        // A queue restored from disk is uploaded at once; otherwise wait for
        // the normal interval so start-up stays quiet.
        schedule(events.length > 0 ? 0 : flushIntervalMs);
      }
    },

    async stop() {
      started = false;
      clearTimer();
      await persistQueue();
    },

    enqueue(entry) {
      if (!options.enabled()) {
        return;
      }

      const message = redactLogText(entry.message).slice(0, MAX_LOG_MESSAGE);
      if (!message) {
        return;
      }

      // Keep the queue useful under a burst: a flood of old lines is dropped
      // from the front, never allowed to grow without bound.
      events.push({
        at: Number.isFinite(entry.at) && entry.at >= 0 ? Math.trunc(entry.at) : now(),
        level: entry.level ?? (entry.tag === 'perf' ? 'debug' : 'info'),
        tag: /^[a-z0-9_-]{1,16}$/.test(entry.tag) ? entry.tag : 'app',
        message,
      });
      trim();
      void persistQueue();
      schedule(flushIntervalMs);
    },

    flush() {
      if (inFlight) {
        return inFlight;
      }
      if (!options.enabled()) {
        return Promise.resolve({ status: 'disabled', sent: 0 });
      }
      if (events.length === 0) {
        return Promise.resolve({ status: 'empty', sent: 0 });
      }

      inFlight = (async (): Promise<FlushResult> => {
        let sent = 0;
        let status: FlushStatus = 'ok';

        while (events.length > 0 && options.enabled()) {
          const batchCount = Math.min(batchSize, events.length);
          const result = await sendBatch();
          if (result === 'ok') {
            sent += batchCount;
            continue;
          }
          if (result === 'retry') {
            status = 'retry';
            scheduleRetry();
            break;
          }
          // Dropped: continue with the next batch; keep the status visible.
          status = 'dropped';
        }

        if (events.length === 0 && status === 'ok') {
          sent = Math.max(0, sent);
          schedule(flushIntervalMs);
        }
        await persistQueue();
        return { status, sent };
      })();

      return inFlight.finally(() => {
        inFlight = null;
      });
    },

    pending() {
      return events.length;
    },

    installationId() {
      if (installationPromise) {
        return installationPromise;
      }

      installationPromise = (async () => {
        try {
          const stored = await options.storage.getItem(LOG_INSTALLATION_KEY);
          if (stored && isInstallationId(stored)) {
            return stored;
          }
        } catch {
          // Generate one for this session.
        }

        const generated = options.randomId?.() ?? generateInstallationId();
        const id = isInstallationId(generated) ? generated : generateInstallationId();
        try {
          await options.storage.setItem(LOG_INSTALLATION_KEY, id);
        } catch {
          // Session-only id.
        }
        return id;
      })();

      return installationPromise;
    },

    async clear() {
      events = [];
      clearTimer();
      await options.storage.removeItem(LOG_QUEUE_KEY).catch(() => {});
      await persistChain;
    },

    wake() {
      schedule(0);
    },
  };

  return uploader;
}
