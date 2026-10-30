/**
 * File-backed log store for the VPS (feature 7).
 *
 * A compact JSON snapshot, rewritten atomically after each batch (the app
 * uploads at most every minute), readable by the retention/rotation policy in
 * `LogStore`. File mode 600: the log file is private to the service user.
 */
import fs from 'node:fs';
import path from 'node:path';

import { isInstallationId } from '../../src/core/logPrivacy';
import { LogStore } from './ingest';
import type { LogSink, LogStoreOptions, StoredLogRecord } from './ingest';

export interface FileLogStoreOptions extends LogStoreOptions {
  /** e.g. /var/lib/soulstream-logs/events.json */
  path: string;
  fileMode?: number;
}

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function validRecord(value: unknown): value is StoredLogRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<StoredLogRecord>;
  return (
    typeof record.at === 'number' &&
    typeof record.receivedAt === 'number' &&
    isInstallationId(record.installationId) &&
    typeof record.appVersion === 'string' &&
    (record.platform === 'android' || record.platform === 'ios') &&
    typeof record.level === 'string' &&
    LEVELS.has(record.level) &&
    typeof record.tag === 'string' &&
    typeof record.message === 'string'
  );
}

export class FileLogStore implements LogSink {
  private readonly memory: LogStore;
  private readonly file: string;
  private readonly mode: number;
  /** Last write error, for `/v1/health` or an operator; never logged content. */
  lastError: Error | null = null;

  constructor(options: FileLogStoreOptions) {
    this.file = options.path;
    this.mode = options.fileMode ?? 0o600;
    this.memory = new LogStore(options);
    this.load();
  }

  get records(): readonly StoredLogRecord[] {
    return this.memory.records;
  }

  append(records: StoredLogRecord[]): void {
    this.memory.append(records);
    this.persist();
  }

  prune(now?: number): void {
    const before = this.memory.records.length;
    this.memory.prune(now);
    if (this.memory.records.length !== before) {
      this.persist();
    }
  }

  deleteInstallation(installationId: string): number {
    const removed = this.memory.deleteInstallation(installationId);
    if (removed > 0) {
      this.persist();
    }
    return removed;
  }

  stats(): { records: number; installations: number; bytes: number } {
    return this.memory.stats();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const records = parsed.filter(validRecord).slice(-50_000);
        // append() also applies retention and the ring size.
        this.memory.append(records);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.memory.records), { mode: this.mode });
      fs.renameSync(temporary, this.file);
      fs.chmodSync(this.file, this.mode);
      this.lastError = null;
    } catch (error) {
      // Keep serving from memory: losing the disk copy is better than losing
      // the service, but the operator can see the failure through lastError.
      this.lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
}
