import { MAX_LOG_EVENTS, MAX_LOG_MESSAGE } from '../../src/core/logPrivacy';
import { createLogIngest, LogStore } from './ingest';

const INSTALL = 'inst_0123456789abcdef';
const OTHER = 'inst_fedcba9876543210';

function report(installationId = INSTALL, message = 'source failed') {
  return {
    schema: 1,
    installationId,
    app: { version: '1.3.0', platform: 'android' },
    events: [{ at: 1_700_000_000_000, level: 'error' as const, tag: 'play', message }],
  };
}

function post(
  service: ReturnType<typeof createLogIngest>,
  body: unknown,
  headers: Record<string, string> = {},
  ip = '203.0.113.10',
) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return service.handle({
    method: 'POST',
    path: '/v1/logs',
    ip,
    headers: {
      'content-type': 'application/json',
      'x-installation-id': INSTALL,
      ...headers,
    },
    body: payload,
  });
}

describe('log ingest API', () => {
  test('accepts a valid report and stores redacted events', async () => {
    const service = createLogIngest();
    const response = await post(service, report(INSTALL, 'password=hunter2 /home/alice/a.mp3'));

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: 1 });
    const stored = service.store.records;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ installationId: INSTALL, tag: 'play', level: 'error' });
    expect(stored[0].message).not.toContain('hunter2');
    expect(stored[0].message).not.toContain('/home/alice');
    // The client's address is used for rate limiting only, never stored.
    expect(JSON.stringify(stored)).not.toContain('203.0.113.10');
  });

  test('validates headers, content type, size, JSON and schema', async () => {
    const service = createLogIngest({ maxBodyBytes: 64 * 1024 });

    expect((await post(service, report(), { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(service, report(), { 'x-installation-id': '' })).status).toBe(401);
    expect((await post(service, report(), { 'x-installation-id': 'not valid id' })).status).toBe(401);
    expect((await post(service, report(OTHER))).status).toBe(403);
    expect((await post(service, '{"schema":')).status).toBe(400);
    expect((await post(service, { schema: 1 })).status).toBe(400);
    expect((await post(service, 'x'.repeat(70 * 1024))).status).toBe(413);
    expect((await post(service, report(INSTALL, 'x'.repeat(MAX_LOG_MESSAGE + 1)))).status).toBe(400);
    expect((await post(service, { ...report(), events: [] })).status).toBe(400);
    expect(
      (await post(service, { ...report(), events: Array.from({ length: MAX_LOG_EVENTS + 1 }, () => report().events[0]) }))
        .status,
    ).toBe(400);
    expect(service.store.records).toHaveLength(0);
  });

  test('rate limits per installation and per IP, with retry information', async () => {
    let now = 1_000_000;
    const service = createLogIngest({
      now: () => now,
      perInstallationPerWindow: 2,
      perIpPerWindow: 3,
      windowMs: 60_000,
    });

    expect((await post(service, report())).status).toBe(202);
    expect((await post(service, report())).status).toBe(202);
    const limited = await post(service, report());
    expect(limited.status).toBe(429);
    expect(limited.headers?.['retry-after']).toBeDefined();
    expect(limited.body).toEqual({ error: 'rate_limited' });

    // Another installation from the same address still has its own budget,
    // until the address itself is over its limit.
    expect(
      (await post(service, report(OTHER), { 'x-installation-id': OTHER }, '203.0.113.10')).status,
    ).toBe(202);
    expect(
      (await post(service, report('inst_aaaabbbbccccdddd'), { 'x-installation-id': 'inst_aaaabbbbccccdddd' })).status,
    ).toBe(429);

    now += 61_000;
    expect((await post(service, report())).status).toBe(202);
  });

  test('optional ingest token protects the endpoint', async () => {
    const service = createLogIngest({ ingestToken: 'topsecret' });

    expect((await post(service, report())).status).toBe(401);
    expect(
      (await post(service, report(), { authorization: 'Bearer wrong' })).status,
    ).toBe(401);
    expect(
      (await post(service, report(), { authorization: 'Bearer topsecret' })).status,
    ).toBe(202);
  });

  test('retention drops old events, rotation keeps the newest', async () => {
    let now = 10_000;
    const service = createLogIngest({ now: () => now, retentionMs: 1000, maxRecords: 2 });

    await post(service, report());
    now += 500;
    await post(service, report());
    expect(service.store.records).toHaveLength(2);

    now += 600;
    await post(service, report(OTHER, 'latest'), { 'x-installation-id': OTHER });
    expect(service.store.records).toHaveLength(2);
    expect(service.store.records[0].message).toBe('source failed');
    expect(service.store.records[1].message).toBe('latest');

    now += 2000;
    expect(service.store.stats().records).toBe(2);
    service.store.prune();
    expect(service.store.stats().records).toBe(0);
  });

  test('an installation can delete everything stored for it', async () => {
    const service = createLogIngest();
    await post(service, report());
    await post(service, report(OTHER), { 'x-installation-id': OTHER });

    const noAuth = await service.handle({
      method: 'DELETE',
      path: `/v1/installations/${INSTALL}`,
      ip: '203.0.113.10',
      headers: {},
      body: '',
    });
    expect(noAuth.status).toBe(401);

    const wrong = await service.handle({
      method: 'DELETE',
      path: `/v1/installations/${INSTALL}`,
      ip: '203.0.113.10',
      headers: { 'x-installation-id': OTHER },
      body: '',
    });
    expect(wrong.status).toBe(403);

    const deleted = await service.handle({
      method: 'DELETE',
      path: `/v1/installations/${INSTALL}`,
      ip: '203.0.113.10',
      headers: { 'x-installation-id': INSTALL },
      body: '',
    });
    expect(deleted.status).toBe(204);
    expect(service.store.records.map(record => record.installationId)).toEqual([OTHER]);
    expect(service.store.stats().installations).toBe(1);
  });

  test('health, unknown routes and methods', async () => {
    const service = createLogIngest();
    expect(
      (await service.handle({ method: 'GET', path: '/v1/health', ip: 'x', headers: {}, body: '' })).status,
    ).toBe(200);
    expect(
      (await service.handle({ method: 'GET', path: '/nope', ip: 'x', headers: {}, body: '' })).status,
    ).toBe(404);
    expect(
      (
        await service.handle({
          method: 'PUT',
          path: '/v1/logs',
          ip: 'x',
          headers: {},
          body: '',
        })
      ).status,
    ).toBe(405);
  });
});

describe('LogStore', () => {
  test('bounds memory and expires records by age', () => {
    let now = 0;
    const store = new LogStore({ retentionMs: 100, maxRecords: 3, now: () => now });

    for (let index = 0; index < 5; index++) {
      now += 10;
      store.append([
        {
          at: now,
          receivedAt: now,
          installationId: INSTALL,
          appVersion: '1',
          platform: 'android',
          level: 'info',
          tag: 'app',
          message: String(index),
        },
      ]);
    }
    expect(store.records.map(record => record.message)).toEqual(['2', '3', '4']);

    now = 1000;
    store.prune();
    expect(store.records).toHaveLength(0);
  });
});
