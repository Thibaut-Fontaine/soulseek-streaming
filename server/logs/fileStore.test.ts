import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileLogStore } from './fileStore';
import type { StoredLogRecord } from './ingest';

const INSTALL = 'inst_0123456789abcdef';
const OTHER = 'inst_fedcba9876543210';

function record(message: string, installationId = INSTALL, receivedAt = 0): StoredLogRecord {
  return {
    at: receivedAt,
    receivedAt,
    installationId,
    appVersion: '1.3.0',
    platform: 'android',
    level: 'info',
    tag: 'app',
    message,
  };
}

describe('FileLogStore', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soulstream-logs-'));
    file = path.join(directory, 'events.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('writes a private file and reloads it after a restart', () => {
    const store = new FileLogStore({ path: file, now: () => 100 });
    store.append([record('one', INSTALL, 100), record('two', OTHER, 100)]);

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const reloaded = new FileLogStore({ path: file, now: () => 100 });
    expect(reloaded.records.map(item => item.message)).toEqual(['one', 'two']);
  });

  test('deletion is persisted', () => {
    const store = new FileLogStore({ path: file, now: () => 100 });
    store.append([record('one', INSTALL, 100), record('two', OTHER, 100)]);
    expect(store.deleteInstallation(INSTALL)).toBe(1);

    const reloaded = new FileLogStore({ path: file, now: () => 100 });
    expect(reloaded.records.map(item => item.installationId)).toEqual([OTHER]);
  });

  test('retention is applied on append and reload', () => {
    let now = 0;
    const store = new FileLogStore({ path: file, retentionMs: 1000, now: () => now });
    store.append([record('old', INSTALL, 0)]);
    now = 5000;
    store.append([record('new', INSTALL, 5000)]);

    const reloaded = new FileLogStore({ path: file, retentionMs: 1000, now: () => now });
    expect(reloaded.records.map(item => item.message)).toEqual(['new']);
  });

  test('a corrupt file starts empty without throwing', () => {
    fs.writeFileSync(file, '{not json');
    const store = new FileLogStore({ path: file, now: () => 100 });
    expect(store.records).toHaveLength(0);
    expect(store.lastError).toBeInstanceOf(Error);
  });
});
