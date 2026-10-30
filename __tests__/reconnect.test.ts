import { ByteWriter } from '../src/core/bytes';
import { LoginRejection, ServerCode, encodeServerMessage } from '../src/core/protocol';
import { SoulseekClient } from '../src/core/soulseekClient';
import type { ConnectOptions, ListenerLike, ListenOptions, SocketEvent, SocketLike, Transport } from '../src/transport/types';
import { MultiPeerNetwork } from '../test-utils/multiPeerNetwork';
import { FlakyTransport } from '../test-utils/flakyTransport';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
  },
}));
jest.mock('../src/player/player', () => ({
  ensurePlayer: jest.fn(async () => {}),
  resetPlayer: jest.fn(async () => {}),
}));
jest.mock('../src/services/settings', () => ({
  loadSettings: jest.fn(),
  saveSettings: jest.fn(async () => {}),
  loadCredentials: jest.fn(async () => null),
  saveCredentials: jest.fn(async () => {}),
  clearCredentials: jest.fn(async () => {}),
}));
jest.mock('../src/transport/rnTcpTransport', () => ({
  ReactNativeTransport: jest.requireActual('../test-utils/flakyTransport').FlakyTransport,
}));

import { AppState } from 'react-native';
import { onAppForeground, useAppStore, watchAppState } from '../src/state/store';

type Listener = (value?: Uint8Array | Error) => void;

class FakeSocket implements SocketLike {
  private readonly listeners: Record<SocketEvent, Listener[]> = { data: [], close: [], error: [] };

  write(): void {}

  end(): void {
    this.emit('close');
  }

  destroy(): void {
    this.emit('close');
  }

  on(event: SocketEvent, listener: Listener): void {
    this.listeners[event].push(listener);
  }

  setNoDelay(): void {}
  setKeepAlive(): void {}

  receive(data: Uint8Array): void {
    this.emit('data', data);
  }

  close(): void {
    this.emit('close');
  }

  private emit(event: SocketEvent, value?: Uint8Array | Error): void {
    for (const listener of [...this.listeners[event]]) {
      listener(value);
    }
  }
}

/** A transport whose first connections fail, like a phone with no network. */
class FakeTransport implements Transport {
  connects = 0;
  readonly sockets: FakeSocket[] = [];

  constructor(private failures: number) {}

  async connect(_options: ConnectOptions): Promise<SocketLike> {
    this.connects++;

    if (this.failures > 0) {
      this.failures--;
      throw new Error('Réseau indisponible');
    }

    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket;
  }

  async listen(_options: ListenOptions): Promise<ListenerLike> {
    return { port: 23456, close: () => {} };
  }
}

function loginAnswer(ok: boolean): Uint8Array {
  const writer = new ByteWriter();

  if (!ok) {
    writer.bool(false).string(LoginRejection.INVALIDPASS);
  } else {
    writer.bool(true).string('Fake server').raw(Uint8Array.from([127, 0, 0, 1])).string('sum').bool(false);
  }

  return encodeServerMessage(ServerCode.LOGIN, writer.toBytes());
}

async function nextSocket(transport: FakeTransport): Promise<FakeSocket> {
  for (let i = 0; i < 20; i++) {
    const socket = transport.sockets[transport.sockets.length - 1];
    if (socket) {
      return socket;
    }
    await Promise.resolve();
  }
  throw new Error('the client never connected');
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Soulseek connection retries', () => {
  test('a failed first connection is retried even with no attempt counter yet', async () => {
    jest.useFakeTimers();
    const transport = new FakeTransport(1);
    const client = new SoulseekClient({
      transport,
      username: 'tester',
      password: 'secret',
      listenPort: 0,
      serverHost: 'server.test',
      serverPort: 1,
    });

    await expect(client.connect()).rejects.toThrow('Réseau indisponible');
    expect(transport.connects).toBe(1);

    await jest.advanceTimersByTimeAsync(2500);

    expect(transport.connects).toBe(2);
    client.disconnect();
  });

  test('a server disconnect is retried instead of staying offline', async () => {
    jest.useFakeTimers();
    const transport = new FakeTransport(0);
    const client = new SoulseekClient({
      transport,
      username: 'tester',
      password: 'secret',
      listenPort: 0,
      serverHost: 'server.test',
      serverPort: 1,
    });

    const connecting = client.connect();
    const socket = await nextSocket(transport);
    socket.receive(loginAnswer(true));

    await expect(connecting).resolves.toMatchObject({ ok: true });
    expect(client.state).toBe('online');

    socket.destroy();
    expect(client.state).toBe('reconnecting');

    await jest.advanceTimersByTimeAsync(2500);

    expect(transport.connects).toBe(2);
    client.disconnect();
  });

  test('an authentication failure stops instead of looping', async () => {
    jest.useFakeTimers();
    const transport = new FakeTransport(0);
    const client = new SoulseekClient({
      transport,
      username: 'tester',
      password: 'wrong',
      listenPort: 0,
      serverHost: 'server.test',
      serverPort: 1,
    });

    const connecting = client.connect();
    const socket = await nextSocket(transport);
    socket.receive(loginAnswer(false));

    await expect(connecting).rejects.toThrow('Mot de passe incorrect');
    expect(client.state).toBe('error');

    await jest.advanceTimersByTimeAsync(300_000);

    expect(transport.connects).toBe(1);
    client.disconnect();
  });
});

function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('waitFor timed out'));
      } else {
        setTimeout(tick, 25);
      }
    };
    tick();
  });
}

describe('staying reachable after a network failure', () => {
  test('a stored login keeps retrying and the foreground reconnects it', async () => {
    const network = new MultiPeerNetwork([
      { username: 'peer', filename: 'Music\\Fake Artist\\Album\\01 - Stream Me.mp3', behavior: 'ok' },
    ]);
    await network.start();

    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        serverHost: '127.0.0.1',
        serverPort: network.serverPort,
        listenPort: 0,
        catalogEnabled: false,
      },
    });

    const appStateListeners: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      listener: (state: string) => void,
    ) => {
      appStateListeners.push(listener);
      return { remove: () => {} };
    }) as unknown as typeof AppState.addEventListener);

    FlakyTransport.failuresLeft = 1;

    try {
      const stopWatching = watchAppState();
      expect(await useAppStore.getState().login('tester', 'secret', 'saved')).toBe(false);

      // The client stays alive and backs off; it must not be torn down.
      expect(useAppStore.getState().connection).toBe('reconnecting');
      expect(useAppStore.getState().username).toBe('tester');

      // Coming back to the foreground skips the backoff.
      appStateListeners.forEach(listener => listener('active'));

      await waitFor(() => useAppStore.getState().connection === 'online');
      expect(useAppStore.getState().connectionError).toBeNull();
      stopWatching();
    } finally {
      FlakyTransport.failuresLeft = 0;
      await useAppStore.getState().logout();
      await network.stop();
    }
  });

  test('the foreground only checks an already online connection', () => {
    useAppStore.setState({ connection: 'idle', username: null });
    expect(() => onAppForeground()).not.toThrow();
  });
});
