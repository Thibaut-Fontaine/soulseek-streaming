/** Transport abstraction: implemented by React Native TCP sockets and by Node.js. */

export type SocketEvent = 'data' | 'close' | 'error';

export interface SocketLike {
  readonly remoteAddress?: string;
  readonly remotePort?: number;
  readonly localPort?: number;
  write(data: Uint8Array, callback?: (error?: Error) => void): void;
  end(): void;
  destroy(): void;
  on(event: SocketEvent, listener: (value?: Uint8Array | Error) => void): void;
  setNoDelay(enabled: boolean): void;
  setKeepAlive(enabled: boolean): void;
}

export interface ListenerLike {
  readonly port: number;
  close(): void;
}

export interface ConnectOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

export interface ListenOptions {
  host: string;
  port: number;
}

export interface Transport {
  connect(options: ConnectOptions): Promise<SocketLike>;
  listen(
    options: ListenOptions,
    onConnection: (socket: SocketLike) => void,
  ): Promise<ListenerLike>;
}
