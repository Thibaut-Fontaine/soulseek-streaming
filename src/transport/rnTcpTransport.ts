import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';

import type {
  ConnectOptions,
  ListenerLike,
  ListenOptions,
  SocketEvent,
  SocketLike,
  Transport,
} from './types';

type DataListener = (value?: Uint8Array | Error) => void;

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof value === 'string') {
    // react-native-tcp-socket returns Buffers by default, but some versions
    // can hand back strings when an encoding has been set.
    return new Uint8Array(Buffer.from(value, 'base64'));
  }

  return null;
}

class RnSocket implements SocketLike {
  private readonly listeners: Record<SocketEvent, Set<DataListener>> = {
    data: new Set(),
    close: new Set(),
    error: new Set(),
  };

  private closed = false;

  constructor(private readonly socket: any) {
    socket.on('data', (value: unknown) => {
      const bytes = asBytes(value);

      if (bytes) {
        this.emit('data', bytes);
      }
    });

    socket.on('close', () => {
      this.closed = true;
      this.emit('close');
    });

    socket.on('error', (error: Error) => {
      this.emit('error', error);
      this.closed = true;
      this.emit('close', error);
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

    try {
      this.socket.write(Buffer.from(data), undefined, callback);
    } catch (error) {
      callback?.(error as Error);
      this.emit('error', error as Error);
    }
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

  on(event: SocketEvent, listener: DataListener): void {
    this.listeners[event].add(listener);
  }

  setNoDelay(enabled: boolean): void {
    try {
      this.socket.setNoDelay(enabled);
    } catch {
      // Not fatal.
    }
  }

  setKeepAlive(enabled: boolean): void {
    try {
      this.socket.setKeepAlive(enabled);
    } catch {
      // Not fatal.
    }
  }

  private emit(event: SocketEvent, value?: Uint8Array | Error): void {
    for (const listener of Array.from(this.listeners[event])) {
      try {
        listener(value);
      } catch {
        // A listener error must not break the data pump.
      }
    }
  }
}

export class ReactNativeTransport implements Transport {
  connect({ host, port, timeoutMs = 15000 }: ConnectOptions): Promise<SocketLike> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const socket = TcpSocket.createConnection(
        {
          host,
          port,
          connectTimeout: timeoutMs,
          reuseAddress: true,
        },
        () => {
          if (settled) {
            return;
          }

          settled = true;
          try {
            socket.setTimeout(0);
          } catch {
            // Ignore.
          }
          const wrapped = new RnSocket(socket);
          wrapped.setNoDelay(true);
          wrapped.setKeepAlive(true);
          resolve(wrapped);
        },
      );

      socket.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      socket.setTimeout(timeoutMs, () => {
        if (!settled) {
          settled = true;
          try {
            socket.destroy();
          } catch {
            // Ignore.
          }
          reject(new Error(`Connection to ${host}:${port} timed out`));
        }
      });
    });
  }

  listen(
    { host, port }: ListenOptions,
    onConnection: (socket: SocketLike) => void,
  ): Promise<ListenerLike> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const server = TcpSocket.createServer((socket: any) => {
        const wrapped = new RnSocket(socket);
        wrapped.setNoDelay(true);
        onConnection(wrapped);
      });

      server.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      server.listen({ port, host }, () => {
        if (settled) {
          return;
        }

        const address = server.address();
        const actualPort =
          address && typeof address === 'object' && 'port' in address
            ? Number(address.port)
            : port;

        settled = true;
        resolve({
          port: actualPort,
          close: () => {
            try {
              server.close();
            } catch {
              // Ignore.
            }
          },
        });
      });
    });
  }
}

