import net from 'node:net';

import type {
  ConnectOptions,
  ListenerLike,
  ListenOptions,
  SocketEvent,
  SocketLike,
  Transport,
} from './types';

type Listener = (value?: Uint8Array | Error) => void;

class NodeSocket implements SocketLike {
  private closed = false;
  private readonly listeners: Record<SocketEvent, Set<Listener>> = {
    data: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(private readonly socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.emit('data', new Uint8Array(chunk));
    });

    socket.on('error', (error: Error) => {
      this.emit('error', error);
    });

    socket.on('close', () => {
      if (this.closed) {
        return;
      }

      this.closed = true;
      this.emit('close');
    });
  }

  get remoteAddress(): string | undefined {
    return this.socket.remoteAddress;
  }

  get remotePort(): number | undefined {
    return this.socket.remotePort;
  }

  get localPort(): number | undefined {
    return this.socket.localPort;
  }

  write(data: Uint8Array, callback?: (error?: Error) => void): void {
    if (this.closed) {
      callback?.(new Error('Socket is closed'));
      return;
    }

    this.socket.write(data, error => callback?.(error ?? undefined));
  }

  end(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.socket.end();
  }

  destroy(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.socket.destroy();
  }

  on(event: SocketEvent, listener: Listener): void {
    this.listeners[event].add(listener);
  }

  setNoDelay(enabled: boolean): void {
    this.socket.setNoDelay(enabled);
  }

  setKeepAlive(enabled: boolean): void {
    this.socket.setKeepAlive(enabled);
  }

  private emit(event: SocketEvent, value?: Uint8Array | Error): void {
    for (const listener of Array.from(this.listeners[event])) {
      try {
        listener(value);
      } catch {
        // Ignore listener errors.
      }
    }
  }
}

export class NodeTransport implements Transport {
  connect({ host, port, timeoutMs = 15000 }: ConnectOptions): Promise<SocketLike> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const socket = net.createConnection({ host, port }, () => {
        if (settled) {
          return;
        }

        settled = true;
        socket.setTimeout(0);
        const wrapped = new NodeSocket(socket);
        wrapped.setNoDelay(true);
        wrapped.setKeepAlive(true);
        resolve(wrapped);
      });

      socket.setTimeout(timeoutMs, () => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        reject(new Error(`Connection to ${host}:${port} timed out`));
      });

      socket.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  listen(
    { host, port }: ListenOptions,
    onConnection: (socket: SocketLike) => void,
  ): Promise<ListenerLike> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => {
        const wrapped = new NodeSocket(socket);
        wrapped.setNoDelay(true);
        onConnection(wrapped);
      });

      server.once('error', reject);

      server.listen(port, host, () => {
        server.removeListener('error', reject);

        const address = server.address();
        const actualPort = address && typeof address === 'object' ? address.port : port;

        resolve({
          port: actualPort,
          close: () => {
            server.close();
          },
        });
      });
    });
  }
}
