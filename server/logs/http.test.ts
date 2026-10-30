import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createLogServer } from './http';

const INSTALL = 'inst_0123456789abcdef';

function report() {
  return {
    schema: 1,
    installationId: INSTALL,
    app: { version: '1.3.0', platform: 'android' },
    events: [{ at: Date.now(), level: 'info', tag: 'app', message: 'started' }],
  };
}

interface Answer {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function call(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'content-type': 'application/json',
          'x-installation-id': INSTALL,
          ...options.headers,
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body ?? '');
  });
}

describe('log ingest HTTP adapter', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const created = createLogServer({ maxBodyBytes: 1024 });
    server = created.server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  test('health and a bounded JSON report', async () => {
    const health = await call(port, 'GET', '/v1/health', { headers: { 'x-installation-id': '' } });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true });

    const posted = await call(port, 'POST', '/v1/logs', { body: JSON.stringify(report()) });
    expect(posted.status).toBe(202);
    expect(JSON.parse(posted.body)).toEqual({ accepted: 1 });
    expect(posted.headers['cache-control']).toBe('no-store');
  });

  test('refuses an oversized Content-Length before reading it', async () => {
    const answer = await call(port, 'POST', '/v1/logs', {
      headers: { 'content-length': '70000' },
      body: '{}',
    });
    expect(answer.status).toBe(413);
    expect(JSON.parse(answer.body)).toEqual({ error: 'body_too_large' });
  });

  test('deletes an installation over HTTP', async () => {
    const deleted = await call(port, 'DELETE', `/v1/installations/${INSTALL}`);
    expect(deleted.status).toBe(204);
    expect(deleted.body).toBe('');
  });

  test('unknown route is a generic JSON error', async () => {
    const answer = await call(port, 'GET', '/admin', { headers: { 'x-installation-id': '' } });
    expect(answer.status).toBe(404);
    expect(JSON.parse(answer.body)).toEqual({ error: 'not_found' });
  });
});
