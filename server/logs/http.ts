/**
 * HTTP adapter for the log ingest service (feature 7).
 *
 * TLS is terminated by the reverse proxy on the VPS; this server listens on
 * localhost only. It bounds the request body before parsing anything and never
 * writes request content to stdout.
 */
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createLogIngest } from './ingest';
import type { LogIngest, LogIngestOptions } from './ingest';

export interface LogHttpOptions extends LogIngestOptions {
  /** Read the client address from X-Forwarded-For (nginx on the same host). */
  trustProxy?: boolean;
  maxBodyBytes?: number;
}

export interface LogHttpServer {
  server: http.Server;
  ingest: LogIngest;
}

class BodyTooLarge extends Error {}
class BadBody extends Error {}

const DEFAULT_MAX_BODY = 64 * 1024;

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const length = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(length) && length > maxBytes) {
    return Promise.reject(new BodyTooLarge());
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    request.on('error', () => fail(new BadBody()));
    request.on('aborted', () => fail(new BadBody()));
  });
}

function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const address = first?.split(',')[0]?.trim();
    if (address) {
      return address;
    }
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function send(response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    ...(payload ? { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(payload)) } : {}),
    ...headers,
  });
  response.end(payload);
}

export function createLogServer(options: LogHttpOptions = {}): LogHttpServer {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const ingest = createLogIngest({ ...options, maxBodyBytes });

  const server = http.createServer((request, response) => {
    void (async () => {
      let path: string;
      try {
        path = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        send(response, 400, { error: 'invalid_url' });
        return;
      }

      let body = '';
      try {
        body = await readBody(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          // Refuse the exchange and close it: there may be megabytes still on
          // the wire, and keeping the socket would let them block the server.
          response.once('finish', () => request.destroy());
          send(response, 413, { error: 'body_too_large' }, { connection: 'close' });
          request.resume();
        } else {
          send(response, 400, { error: 'invalid_body' });
        }
        return;
      }

      try {
        const result = await ingest.handle({
          method: request.method ?? 'GET',
          path,
          ip: clientAddress(request, options.trustProxy === true),
          headers: request.headers,
          body,
        });
        send(response, result.status, result.body, result.headers);
      } catch {
        send(response, 500, { error: 'internal_error' });
      }
    })();
  });

  // Large uploads are refused early rather than buffered by Node.
  server.headersTimeout = 15_000;
  server.requestTimeout = 20_000;

  return { server, ingest };
}
