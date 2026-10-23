import net from 'node:net';

import { ChunkBuffer } from '../src/core/chunkBuffer';
import { NodeTransport } from '../src/transport/nodeTransport';
import { RangeHttpServer } from '../src/stream/httpServer';

jest.setTimeout(20000);

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

function httpRequest(port: number, raw: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(raw);
    });

    const chunks: Buffer[] = [];

    socket.on('data', chunk => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const buffer = Buffer.concat(chunks);
      const headerEnd = buffer.indexOf('\r\n\r\n');

      if (headerEnd < 0) {
        reject(new Error('Incomplete HTTP response'));
        return;
      }

      const head = buffer.subarray(0, headerEnd).toString('ascii').split('\r\n');
      const status = Number(head[0].split(' ')[1]);
      const headers: Record<string, string> = {};

      for (const line of head.slice(1)) {
        const colon = line.indexOf(':');

        if (colon > 0) {
          headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
      }

      resolve({ status, headers, body: buffer.subarray(headerEnd + 4) });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ChunkBuffer', () => {
  test('reads across chunk boundaries', () => {
    const buffer = new ChunkBuffer();
    buffer.append(Uint8Array.from([1, 2, 3]));
    buffer.append(Uint8Array.from([4, 5, 6]));

    expect(Array.from(buffer.read(1, 4))).toEqual([2, 3, 4, 5]);
    expect(Array.from(buffer.read(0, 10))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(buffer.read(6, 1)).toHaveLength(0);
  });

  test('waitFor resolves once the byte is appended', async () => {
    const buffer = new ChunkBuffer();
    const wait = buffer.waitFor(5, 1000);

    buffer.append(Uint8Array.from([0, 1, 2]));
    buffer.append(Uint8Array.from([3, 4, 5]));

    await expect(wait).resolves.toBeUndefined();
  });

  test('waitFor rejects on failure', async () => {
    const buffer = new ChunkBuffer();
    const wait = buffer.waitFor(10, 5000);
    buffer.fail(new Error('boom'));
    await expect(wait).rejects.toThrow('boom');
  });
});

describe('RangeHttpServer', () => {
  test('serves byte ranges and waits for progressive data', async () => {
    const transport = new NodeTransport();
    const server = new RangeHttpServer(transport);
    const port = await server.start();

    const buffer = new ChunkBuffer();
    const total = 2000;
    const all = Uint8Array.from({ length: total }, (_, i) => i % 251);
    buffer.append(all.subarray(0, 1000));
    server.register('track-1', {
      getSize: () => total,
      contentType: 'audio/mpeg',
      buffer,
    });

    setTimeout(() => buffer.append(all.subarray(1000)), 150);

    const response = await httpRequest(
      port,
      'GET /stream/track-1 HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=1500-1999\r\n\r\n',
    );

    expect(response.status).toBe(206);
    expect(response.headers['content-type']).toBe('audio/mpeg');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe('bytes 1500-1999/2000');
    expect(response.body).toHaveLength(500);
    expect(Array.from(response.body)).toEqual(Array.from(all.subarray(1500, 2000)));

    server.stop();
  });

  test('serves a full request without Range', async () => {
    const transport = new NodeTransport();
    const server = new RangeHttpServer(transport);
    const port = await server.start();

    const data = Buffer.from('hello soulseek');
    const buffer = new ChunkBuffer();
    buffer.append(data);
    buffer.finish();

    server.register('full', {
      getSize: () => data.length,
      contentType: 'audio/wav',
      buffer,
    });

    const response = await httpRequest(port, 'GET /stream/full HTTP/1.1\r\nHost: x\r\n\r\n');
    expect(response.status).toBe(200);
    expect(response.headers['content-length']).toBe(String(data.length));
    expect(response.body.toString()).toBe('hello soulseek');

    server.stop();
  });

  test('rejects unsatisfiable ranges', async () => {
    const transport = new NodeTransport();
    const server = new RangeHttpServer(transport);
    const port = await server.start();

    const buffer = new ChunkBuffer();
    buffer.append(Uint8Array.from([1, 2, 3]));
    server.register('tiny', {
      getSize: () => 3,
      contentType: 'audio/mpeg',
      buffer,
    });

    const response = await httpRequest(
      port,
      'GET /stream/tiny HTTP/1.1\r\nHost: x\r\nRange: bytes=100-\r\n\r\n',
    );

    expect(response.status).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */3');

    server.stop();
  });

  test('answers HEAD and 404', async () => {
    const transport = new NodeTransport();
    const server = new RangeHttpServer(transport);
    const port = await server.start();

    const buffer = new ChunkBuffer();
    buffer.append(Uint8Array.from([1, 2, 3]));
    server.register('x', { getSize: () => 3, contentType: 'audio/mpeg', buffer });

    const head = await httpRequest(port, 'HEAD /stream/x HTTP/1.1\r\nHost: x\r\n\r\n');
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe('3');
    expect(head.body).toHaveLength(0);

    const missing = await httpRequest(port, 'GET /stream/nope HTTP/1.1\r\nHost: x\r\n\r\n');
    expect(missing.status).toBe(404);

    server.stop();
  });

  test('placeholder: sleep helper', async () => {
    await sleep(1);
  });
});
