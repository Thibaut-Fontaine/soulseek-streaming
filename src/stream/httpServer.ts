import { ByteQueue, utf8Encode } from '../core/bytes';
import type { ChunkBuffer } from '../core/chunkBuffer';
import type { ListenerLike, SocketLike, Transport } from '../transport/types';

export interface StreamSource {
  /** Total file size in bytes. May become known after the peer accepted the transfer. */
  getSize: () => number;
  contentType: string;
  buffer: ChunkBuffer;
}

interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
}

const MAX_HEADER_BYTES = 16 * 1024;
const CHUNK_SIZE = 64 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  ape: 'audio/x-ape',
  wv: 'audio/x-wavpack',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
};

export function contentTypeFor(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const extension = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * A tiny HTTP/1.1 server that exposes in-progress Soulseek downloads to the
 * native audio player with byte-range support.
 *
 * The player asks for `http://127.0.0.1:<port>/stream/<id>`; the server blocks
 * as needed until the Soulseek transfer has delivered each requested byte.
 */
export class RangeHttpServer {
  private readonly sources = new Map<string, StreamSource>();
  private listener: ListenerLike | null = null;
  private actualPort = 0;

  constructor(
    private readonly transport: Transport,
    private readonly preferredPort = 0,
    private readonly host = '127.0.0.1',
  ) {}

  get port(): number {
    return this.actualPort;
  }

  register(id: string, source: StreamSource): void {
    this.sources.set(id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  urlFor(id: string): string {
    return `http://${this.host}:${this.actualPort}/stream/${encodeURIComponent(id)}`;
  }

  async start(): Promise<number> {
    if (this.listener) {
      return this.actualPort;
    }

    try {
      this.listener = await this.transport.listen(
        { host: this.host, port: this.preferredPort },
        socket => this.handleConnection(socket),
      );
    } catch (error) {
      if (this.preferredPort === 0) {
        throw error;
      }

      this.listener = await this.transport.listen(
        { host: this.host, port: 0 },
        socket => this.handleConnection(socket),
      );
    }

    this.actualPort = this.listener.port;
    return this.actualPort;
  }

  stop(): void {
    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    this.actualPort = 0;
    this.sources.clear();
  }

  /* ---------------------------------------------------------------------- */

  private handleConnection(socket: SocketLike): void {
    const queue = new ByteQueue();
    let handled = false;

    const timer = setTimeout(() => {
      if (!handled) {
        socket.destroy();
      }
    }, 15000);

    socket.on('data', chunk => {
      if (handled || !(chunk instanceof Uint8Array)) {
        return;
      }

      queue.push(chunk);

      if (queue.length > MAX_HEADER_BYTES) {
        socket.destroy();
        return;
      }

      const preview = queue.peek(queue.length);
      const request = parseRequest(preview);

      if (!request) {
        return;
      }

      handled = true;
      clearTimeout(timer);
      void this.respond(socket, request);
    });

    socket.on('close', () => clearTimeout(timer));
    socket.on('error', () => clearTimeout(timer));
  }

  private async respond(socket: SocketLike, request: HttpRequest): Promise<void> {
    const prefix = '/stream/';

    if (!request.path.startsWith(prefix)) {
      writeResponse(socket, 404, 'Not Found', {}, new Uint8Array(0));
      return;
    }

    let id: string;

    try {
      id = decodeURIComponent(request.path.slice(prefix.length));
    } catch {
      writeResponse(socket, 400, 'Bad Request', {}, new Uint8Array(0));
      return;
    }

    const source = this.sources.get(id);

    if (!source) {
      writeResponse(socket, 404, 'Not Found', {}, new Uint8Array(0));
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeResponse(
        socket,
        405,
        'Method Not Allowed',
        { Allow: 'GET, HEAD' },
        new Uint8Array(0),
      );
      return;
    }

    const total = Math.max(0, source.getSize());

    if (total === 0) {
      writeResponse(socket, 503, 'Service Unavailable', {}, new Uint8Array(0));
      return;
    }

    const range = parseRange(request.headers.range, total);

    if (range === 'invalid') {
      writeResponse(
        socket,
        416,
        'Range Not Satisfiable',
        { 'Content-Range': `bytes */${total}` },
        new Uint8Array(0),
      );
      return;
    }

    const usingRange = range !== null && request.headers.range !== undefined;
    const start = range ? range.start : 0;
    const end = range ? range.end : total - 1;
    const length = end - start + 1;

    const headers: Record<string, string> = {
      'Content-Type': source.contentType,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      Connection: 'close',
    };

    if (usingRange) {
      headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    }

    writeHead(socket, usingRange ? 206 : 200, usingRange ? 'Partial Content' : 'OK', headers);

    if (request.method === 'HEAD') {
      socket.end();
      return;
    }

    let offset = start;
    let aborted = false;

    socket.on('close', () => {
      aborted = true;
    });

    try {
      let chunksWritten = 0;

      while (offset <= end && !aborted) {
        if (offset >= source.buffer.total) {
          if (source.buffer.state !== 'open') {
            break;
          }

          await source.buffer.waitFor(offset, 60000);
        }

        const bytes = source.buffer.read(offset, Math.min(CHUNK_SIZE, end - offset + 1));

        if (bytes.length === 0) {
          break;
        }

        await writeAsync(socket, bytes);
        offset += bytes.length;

        // The HTTP proxy runs on the JS thread. Yield regularly so touches,
        // tab changes and the player UI remain responsive while a large range
        // is copied to the native player.
        if (++chunksWritten % 2 === 0) {
          await yieldToUi();
        }
      }
    } catch {
      // Transfer failed, timed out, or the player went away.
    }

    if (!aborted) {
      socket.end();
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function parseRequest(bytes: Uint8Array): HttpRequest | null {
  const text = asciiFromBytes(bytes);
  const headerEnd = text.indexOf('\r\n\r\n');

  if (headerEnd < 0) {
    return null;
  }

  const lines = text.slice(0, headerEnd).split('\r\n');
  const requestLine = lines.shift() ?? '';
  const match = /^([A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/.exec(requestLine);

  if (!match) {
    return null;
  }

  const headers: Record<string, string> = {};

  for (const line of lines) {
    const colon = line.indexOf(':');

    if (colon > 0) {
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }

  return { method: match[1], path: match[2], headers };
}

function asciiFromBytes(bytes: Uint8Array): string {
  let output = '';

  for (let i = 0; i < bytes.length; i++) {
    output += String.fromCharCode(bytes[i]);
  }

  return output;
}

function parseRange(
  header: string | undefined,
  total: number,
): { start: number; end: number } | 'invalid' | null {
  if (!header) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  if (!match) {
    return 'invalid';
  }

  const [, rawStart, rawEnd] = match;

  if (rawStart === '' && rawEnd === '') {
    return 'invalid';
  }

  let start: number;
  let end: number;

  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);

    if (!Number.isFinite(suffix) || suffix <= 0) {
      return 'invalid';
    }

    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? total - 1 : Number(rawEnd);

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      return 'invalid';
    }
  }

  if (start >= total) {
    return 'invalid';
  }

  return { start, end: Math.min(end, total - 1) };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

function writeHead(
  socket: SocketLike,
  code: number,
  reason: string,
  headers: Record<string, string>,
): void {
  let head = `HTTP/1.1 ${code} ${reason}\r\n`;

  for (const [name, value] of Object.entries(headers)) {
    head += `${name}: ${value}\r\n`;
  }

  head += '\r\n';
  socket.write(utf8Encode(head));
}

function writeResponse(
  socket: SocketLike,
  code: number,
  reason: string,
  headers: Record<string, string>,
  body: Uint8Array,
): void {
  writeHead(socket, code, reason, {
    'Content-Length': String(body.length),
    'Content-Type': 'text/plain; charset=utf-8',
    Connection: 'close',
    ...headers,
  });

  if (body.length > 0) {
    socket.write(body);
  }

  socket.end();
}

function yieldToUi(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function writeAsync(socket: SocketLike, data: Uint8Array): Promise<void> {
  return new Promise(resolve => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(finish, 30000);
    socket.write(data, finish);
  });
}
