import { createLogUploader } from '../src/services/logUploader';
import type { RemoteLogStorage, UploadRequestInit } from '../src/services/logUploader';

class MemoryStorage implements RemoteLogStorage {
  readonly data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    this.data.delete(key);
  }
}

function response(status = 202): { ok: boolean; status: number } {
  return { ok: status >= 200 && status < 300, status };
}

function setup(overrides: Partial<Parameters<typeof createLogUploader>[0]> = {}) {
  const storage = new MemoryStorage();
  let enabled = true;
  const fetchImpl = jest.fn(async (_url: string, _init: UploadRequestInit) => response());
  const uploader = createLogUploader({
    endpoint: 'https://logs.example/v1/logs',
    appVersion: '1.3.0',
    platform: 'android',
    storage,
    enabled: () => enabled,
    fetchImpl,
    randomId: () => 'inst_0123456789abcdef',
    ...overrides,
  });
  return {
    storage,
    fetchImpl,
    uploader,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
}

describe('remote log uploader', () => {
  test('sends nothing while the setting is off', async () => {
    const { uploader, fetchImpl, setEnabled } = setup();
    setEnabled(false);
    await uploader.start();
    uploader.enqueue({ at: 1, tag: 'app', message: 'hello' });

    expect(await uploader.flush()).toEqual({ status: 'disabled', sent: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await uploader.stop();
  });

  test('batches, redacts and sends no credential', async () => {
    const { uploader, fetchImpl } = setup();
    await uploader.start();
    uploader.enqueue({ at: 1, tag: 'play', message: 'password=hunter2 /home/alice/a.mp3' });
    uploader.enqueue({ at: 2, tag: 'app', message: 'username=bob started' });

    expect(await uploader.flush()).toEqual({ status: 'ok', sent: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://logs.example/v1/logs');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers['x-installation-id']).toBe('inst_0123456789abcdef');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      schema: 1,
      installationId: 'inst_0123456789abcdef',
      app: { version: '1.3.0', platform: 'android' },
    });
    expect(body.events).toHaveLength(2);
    expect(body.events[0].message).not.toContain('hunter2');
    expect(body.events[0].message).not.toContain('/home/alice');
    expect(body.events[1].message).not.toContain('bob');
    expect(JSON.stringify(body)).not.toMatch(/hunter2|bob|authorization/i);
    expect(await uploader.pending()).toBe(0);
    await uploader.stop();
  });

  test('keeps the queue when offline and retries it', async () => {
    const { uploader, fetchImpl } = setup();
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    await uploader.start();
    uploader.enqueue({ at: 1, tag: 'app', message: 'one' });

    expect(await uploader.flush()).toEqual({ status: 'retry', sent: 0 });
    expect(await uploader.pending()).toBe(1);

    expect(await uploader.flush()).toEqual({ status: 'ok', sent: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await uploader.pending()).toBe(0);
    await uploader.stop();
  });

  test('honours the batch size', async () => {
    const { uploader, fetchImpl } = setup({ batchSize: 2 });
    await uploader.start();
    for (let index = 0; index < 5; index++) {
      uploader.enqueue({ at: index, tag: 'app', message: `line ${index}` });
    }

    expect(await uploader.flush()).toEqual({ status: 'ok', sent: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).events.length),
    ).toEqual([2, 2, 1]);
    await uploader.stop();
  });

  test('persists the installation id and the offline queue across restarts', async () => {
    const storage = new MemoryStorage();
    const first = createLogUploader({
      endpoint: 'https://logs.example/v1/logs',
      appVersion: '1.3.0',
      platform: 'android',
      storage,
      enabled: () => true,
      fetchImpl: async () => response(),
      randomId: () => 'inst_0123456789abcdef',
      flushIntervalMs: 60_000,
    });
    await first.start();
    expect(await first.installationId()).toBe('inst_0123456789abcdef');
    first.enqueue({ at: 1, tag: 'app', message: 'queued offline' });
    await first.stop();

    const fetchImpl = jest.fn(async (_url: string, _init: UploadRequestInit) => response());
    const second = createLogUploader({
      endpoint: 'https://logs.example/v1/logs',
      appVersion: '1.3.0',
      platform: 'android',
      storage,
      enabled: () => true,
      fetchImpl,
      randomId: () => 'inst_other',
      flushIntervalMs: 60_000,
    });
    await second.start();
    expect(await second.installationId()).toBe('inst_0123456789abcdef');
    expect(await second.pending()).toBe(1);
    expect(await second.flush()).toEqual({ status: 'ok', sent: 1 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).installationId).toBe('inst_0123456789abcdef');
    await second.stop();
  });

  test('drops a report the server rejects instead of retrying forever', async () => {
    const { uploader, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(response(400));
    await uploader.start();
    uploader.enqueue({ at: 1, tag: 'app', message: 'bad' });

    expect(await uploader.flush()).toEqual({ status: 'dropped', sent: 0 });
    expect(await uploader.pending()).toBe(0);
    await uploader.stop();
  });

  test('bounds the offline queue', async () => {
    const { uploader } = setup({ maxQueue: 3 });
    await uploader.start();
    for (let index = 0; index < 5; index++) {
      uploader.enqueue({ at: index, tag: 'app', message: `line ${index}` });
    }
    expect(await uploader.pending()).toBe(3);
    await uploader.clear();
    expect(await uploader.pending()).toBe(0);
    await uploader.stop();
  });
});
