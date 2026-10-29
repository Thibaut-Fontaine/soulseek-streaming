import net from 'node:net';
import { deflate } from 'pako';

import { ByteQueue, ByteWriter, readU32 } from '../src/core/bytes';
import { Framer } from '../src/core/framer';
import {
  PeerCode,
  ServerCode,
  TransferDirection,
  encodePeerInitMessage,
  encodePeerMessage,
  encodeServerMessage,
  parsePeerInit,
} from '../src/core/protocol';
import { SoulseekClient } from '../src/core/soulseekClient';
import type { SearchHit } from '../src/core/types';
import { NodeTransport } from '../src/transport/nodeTransport';

jest.setTimeout(30000);

const USERNAME = 'alice';
const FILE_NAME = 'Music\\Fake Artist - Stream Me.mp3';
const FILE_DATA = Uint8Array.from({ length: 120_000 }, (_, i) => (i * 31 + 7) % 251);

function wireIp(address: string): Uint8Array {
  const [a, b, c, d] = address.split('.').map(Number);
  return Uint8Array.from([d, c, b, a]);
}

function buildSearchPayload(token: number): Uint8Array {
  const writer = new ByteWriter();
  writer.string(USERNAME).u32(token).u32(1);
  writer.u8(1).string(FILE_NAME).u64(FILE_DATA.length).string('');
  writer.u32(2).u32(0).u32(320).u32(1).u32(180);
  writer.bool(true).u32(500000).u32(0).u32(0);
  return deflate(writer.toBytes());
}

function takePeerInit(queue: ByteQueue): { code: number; payload: Uint8Array } | null {
  if (queue.length < 5) {
    return null;
  }

  const length = readU32(queue.peek(4), 0);

  if (length < 1 || length > 1024 * 1024 || queue.length < 4 + length) {
    return null;
  }

  queue.skip(4);
  const frame = queue.take(length);
  return { code: frame[0], payload: frame.subarray(1) };
}

function readString(payload: Uint8Array, offset: number): { value: string; next: number } {
  const length = readU32(payload, offset);
  const value = Buffer.from(payload.subarray(offset + 4, offset + 4 + length)).toString('utf8');
  return { value, next: offset + 4 + length };
}

/** A minimal fake Soulseek server + peer that exercises the real client code. */
class FakeNetwork {
  private readonly server: net.Server;
  private readonly peerServer: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private clientPort = 0;
  private clientServerSocket: net.Socket | null = null;
  private readonly peerStates = new Map<
    net.Socket,
    {
      stage: 'init' | 'peer' | 'file';
      queue: ByteQueue;
      framer: Framer;
      streaming: boolean;
    }
  >();

  serverPort = 0;
  peerPort = 0;
  searchToken = 0;
  indirectFile = false;
  /** The peer is firewalled: direct connections fail, ConnectToPeer works. */
  directUnreachable = false;
  /** Drop the server connection once the file starts streaming. */
  dropServerWhileStreaming = false;
  closedPort = 0;
  connectToPeerRequests = 0;
  /** Stop answering, like a server behind a connection that died silently. */
  mute = false;

  constructor() {
    this.server = net.createServer(socket => this.handleServerConnection(socket));
    this.peerServer = net.createServer(socket => this.handlePeerConnection(socket));
  }

  async start(): Promise<void> {
    await new Promise<void>(resolve => this.peerServer.listen(0, '127.0.0.1', resolve));
    this.peerPort = (this.peerServer.address() as net.AddressInfo).port;

    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.serverPort = (this.server.address() as net.AddressInfo).port;

    // A port nobody listens on, to simulate a firewalled peer.
    const probe = net.createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    this.closedPort = (probe.address() as net.AddressInfo).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    await new Promise<void>(resolve => this.server.close(() => resolve()));
    await new Promise<void>(resolve => this.peerServer.close(() => resolve()));
  }

  /* ----------------------------- server side ---------------------------- */

  private handleServerConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    const framer = new Framer(4);

    socket.on('data', chunk => {
      for (const frame of framer.push(new Uint8Array(chunk))) {
        if (this.mute) {
          continue;
        }
        this.handleServerFrame(socket, frame.code, frame.payload);
      }
    });

    socket.on('error', () => {});
  }

  private handleServerFrame(socket: net.Socket, code: number, payload: Uint8Array): void {
    switch (code) {
      case ServerCode.LOGIN: {
        const writer = new ByteWriter();
        writer.bool(true).string('Fake server');
        writer.raw(wireIp('127.0.0.1')).string('checksum').bool(false);
        socket.write(encodeServerMessage(ServerCode.LOGIN, writer.toBytes()));
        break;
      }

      case ServerCode.SET_WAIT_PORT: {
        this.clientPort = readU32(payload, 0);
        this.clientServerSocket = socket;
        break;
      }

      case ServerCode.FILE_SEARCH: {
        this.searchToken = readU32(payload, 0);
        setTimeout(() => this.sendSearchResults(), 20);
        break;
      }

      case ServerCode.GET_PEER_ADDRESS: {
        const writer = new ByteWriter();
        const port = this.directUnreachable ? this.closedPort : this.peerPort;
        writer.string(USERNAME).raw(wireIp('127.0.0.1')).u32(port).u32(0).u16(0);
        socket.write(encodeServerMessage(ServerCode.GET_PEER_ADDRESS, writer.toBytes()));
        break;
      }

      case ServerCode.CONNECT_TO_PEER: {
        // The client asks the server to make us connect to it.
        this.connectToPeerRequests++;
        const token = readU32(payload, 0);
        const { value: type } = readString(payload, 4 + 4 + USERNAME.length);

        if (this.directUnreachable && type === 'P') {
          setTimeout(() => this.pierceClient(token), 10);
        }

        break;
      }

      default:
        break;
    }
  }

  /** Connects to the client's listen port and sends PierceFirewall(token). */
  private pierceClient(token: number): void {
    const socket = net.createConnection({ host: '127.0.0.1', port: this.clientPort }, () => {
      const writer = new ByteWriter();
      writer.u32(token);
      socket.write(encodePeerInitMessage(0, writer.toBytes()));
    });

    this.sockets.add(socket);
    const state = {
      stage: 'peer' as 'init' | 'peer' | 'file',
      queue: new ByteQueue(),
      framer: new Framer(4),
      streaming: false,
    };

    socket.on('data', chunk => {
      state.queue.push(new Uint8Array(chunk));
      this.pumpPeer(socket, state);
    });
    socket.on('error', () => {});
  }

  private sendSearchResults(): void {
    const socket = net.createConnection(
      { host: '127.0.0.1', port: this.clientPort },
      () => {
        const init = new ByteWriter();
        init.string(USERNAME).string('P').u32(0);
        socket.write(encodePeerInitMessage(1, init.toBytes()));

        const response = buildSearchPayload(this.searchToken);
        socket.write(encodePeerMessage(PeerCode.FILE_SEARCH_RESPONSE, response));

        if (this.directUnreachable) {
          // Many clients close the connection once results are delivered.
          socket.end();
        }
      },
    );

    this.sockets.add(socket);
    // Like real clients, the peer also reads requests on the connection it
    // opened (the downloader may reuse it for QueueUpload).
    const state = {
      stage: 'peer' as 'init' | 'peer' | 'file',
      queue: new ByteQueue(),
      framer: new Framer(4),
      streaming: false,
    };
    socket.on('data', chunk => {
      state.queue.push(new Uint8Array(chunk));
      this.pumpPeer(socket, state);
    });
    socket.on('error', () => {});
  }

  /* ------------------------------ peer side ----------------------------- */

  private handlePeerConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    const state = {
      stage: 'init' as 'init' | 'peer' | 'file',
      queue: new ByteQueue(),
      framer: new Framer(4),
      streaming: false,
    };
    this.peerStates.set(socket, state);

    socket.on('data', chunk => {
      state.queue.push(new Uint8Array(chunk));
      this.pumpPeer(socket, state);
    });

    socket.on('close', () => this.peerStates.delete(socket));
    socket.on('error', () => {});
  }

  private pumpPeer(
    socket: net.Socket,
    state: { stage: 'init' | 'peer' | 'file'; queue: ByteQueue; framer: Framer; streaming: boolean },
  ): void {
    if (state.stage === 'init') {
      const init = takePeerInit(state.queue);

      if (!init) {
        return;
      }

      if (init.code === 0) {
        // Indirect file connection: the client pierced our firewall, we now
        // send FileTransferInit (raw uint32) and the file bytes.
        state.stage = 'file';
        this.sendFileToken(socket);
        this.pumpPeer(socket, state);
        return;
      }

      if (init.code !== 1) {
        socket.destroy();
        return;
      }

      parsePeerInit(init.payload);
      state.stage = 'peer';

      if (state.queue.length > 0) {
        const rest = state.queue.take(state.queue.length);

        for (const frame of state.framer.push(rest)) {
          this.handlePeerFrame(socket, frame.code, frame.payload);
        }
      }

      return;
    }

    if (state.stage === 'file') {
      if (!state.streaming && state.queue.length >= 8) {
        state.queue.skip(8);
        state.streaming = true;
        this.streamFile(socket);
      }

      return;
    }

    if (state.queue.length > 0) {
      const rest = state.queue.take(state.queue.length);

      for (const frame of state.framer.push(rest)) {
        this.handlePeerFrame(socket, frame.code, frame.payload);
      }
    }
  }

  private sendFileToken(socket: net.Socket): void {
    const token = 4242;
    const bytes = new Uint8Array(4);
    bytes[0] = token & 0xff;
    bytes[1] = (token >>> 8) & 0xff;
    bytes[2] = (token >>> 16) & 0xff;
    bytes[3] = (token >>> 24) & 0xff;
    socket.write(bytes);
  }

  private handlePeerFrame(socket: net.Socket, code: number, payload: Uint8Array): void {
    if (code === PeerCode.QUEUE_UPLOAD) {
      const { value: filename } = readString(payload, 0);
      const writer = new ByteWriter();
      writer.u32(TransferDirection.UPLOAD).u32(4242).string(filename).u64(FILE_DATA.length);
      socket.write(encodePeerMessage(PeerCode.TRANSFER_REQUEST, writer.toBytes()));
      return;
    }

    if (code === PeerCode.TRANSFER_RESPONSE) {
      const token = readU32(payload, 0);
      const allowed = payload[4] !== 0;

      if (!allowed) {
        return;
      }

      if (this.indirectFile) {
        this.sendConnectToPeer(token);
      } else {
        this.openFileConnection(token);
      }
    }
  }

  private sendConnectToPeer(token: number): void {
    const socket = this.clientServerSocket;

    if (!socket) {
      return;
    }

    const writer = new ByteWriter();
    writer.string(USERNAME).string('F').raw(wireIp('127.0.0.1')).u32(this.peerPort);
    writer.u32(77).bool(false).u32(0).u32(0);
    socket.write(encodeServerMessage(ServerCode.CONNECT_TO_PEER, writer.toBytes()));
    void token;
  }

  private openFileConnection(token: number): void {
    const socket = net.createConnection(
      { host: '127.0.0.1', port: this.clientPort },
      () => {
        const init = new ByteWriter();
        init.string(USERNAME).string('F').u32(0);
        socket.write(encodePeerInitMessage(1, init.toBytes()));

        // FileTransferInit: a raw uint32, no framing.
        const tokenBytes = new Uint8Array(4);
        tokenBytes[0] = token & 0xff;
        tokenBytes[1] = (token >>> 8) & 0xff;
        tokenBytes[2] = (token >>> 16) & 0xff;
        tokenBytes[3] = (token >>> 24) & 0xff;
        socket.write(tokenBytes);
      },
    );

    this.sockets.add(socket);
    let offsetReceived = false;

    socket.on('data', chunk => {
      if (offsetReceived) {
        return;
      }

      const buffer = Buffer.from(chunk);

      if (buffer.length >= 8) {
        offsetReceived = true;
        this.streamFile(socket);
      }
    });

    socket.on('error', () => {});
  }

  private streamFile(socket: net.Socket): void {
    let offset = 0;

    const send = () => {
      if (offset >= FILE_DATA.length) {
        // The downloader closes the connection once the file is complete.
        return;
      }

      const end = Math.min(offset + 8192, FILE_DATA.length);
      socket.write(Buffer.from(FILE_DATA.subarray(offset, end)));
      offset = end;

      if (this.dropServerWhileStreaming && offset === 8192) {
        this.clientServerSocket?.destroy();
      }
      setTimeout(send, 1);
    };

    send();
  }
}

async function runScenario(
  indirectFile: boolean,
  options: { directUnreachable?: boolean; dropServerWhileStreaming?: boolean } = {},
): Promise<FakeNetwork> {
  const network = new FakeNetwork();
  network.indirectFile = indirectFile;
  network.directUnreachable = options.directUnreachable ?? false;
  network.dropServerWhileStreaming = options.dropServerWhileStreaming ?? false;
  await network.start();

  const client = new SoulseekClient({
    transport: new NodeTransport(),
    username: 'test-user',
    password: 'test-pass',
    listenPort: 0,
    serverHost: '127.0.0.1',
    serverPort: network.serverPort,
    searchDurationMs: 700,
  });

  try {
    const login = await client.connect();
    expect(login.ok).toBe(true);
    expect(client.state).toBe('online');

    const hits = await client.search('Fake Artist', { durationMs: 700 });
    expect(hits).toHaveLength(1);
    expect(hits[0].username).toBe(USERNAME);
    expect(hits[0].filename).toBe(FILE_NAME);
    expect(hits[0].bitrate).toBe(320);

    const hit = hits[0] as SearchHit;
    const transfer = client.createTransfer(hit);

    const finished = await new Promise<typeof transfer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Transfer timeout')), 15000);

      const unsubscribe = client.on('transfer', snapshot => {
        if (snapshot.id !== transfer.id) {
          return;
        }

        if (snapshot.state === 'complete') {
          clearTimeout(timer);
          unsubscribe();
          resolve(transfer);
        } else if (snapshot.state === 'failed' || snapshot.state === 'cancelled') {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(snapshot.error ?? snapshot.state));
        }
      });
    });

    expect(finished.state).toBe('complete');
    expect(finished.buffer.total).toBe(FILE_DATA.length);
    expect(Array.from(finished.buffer.read(0, FILE_DATA.length))).toEqual(Array.from(FILE_DATA));
  } finally {
    client.disconnect();
    await network.stop();
  }

  return network;
}

describe('SoulseekClient end to end (fake network)', () => {
  test('logs in, searches and streams a file over a direct peer connection', async () => {
    await runScenario(false);
  });

  test('streams a file through a ConnectToPeer indirect connection', async () => {
    await runScenario(true);
  });

  test('reaches a firewalled peer through our own ConnectToPeer request', async () => {
    const network = await runScenario(false, { directUnreachable: true });
    expect(network.connectToPeerRequests).toBeGreaterThan(0);
  });

  test('keeps streaming when the server connection drops', async () => {
    await runScenario(false, { dropServerWhileStreaming: true });
  });
});

describe('server connection health check', () => {
  test('keeps a live connection and drops a silent one', async () => {
    const network = new FakeNetwork();
    await network.start();
    const client = new SoulseekClient({
      transport: new NodeTransport(),
      username: 'test-user',
      password: 'test-pass',
      listenPort: 0,
      serverHost: '127.0.0.1',
      serverPort: network.serverPort,
    });

    try {
      expect((await client.connect()).ok).toBe(true);
      await expect(client.checkConnection(2000)).resolves.toBe(true);
      expect(client.state).toBe('online');

      // The socket stays open but nothing comes back any more.
      network.mute = true;
      await expect(client.checkConnection(500)).resolves.toBe(false);
      expect(['disconnected', 'reconnecting']).toContain(client.state);
    } finally {
      client.disconnect();
      await network.stop();
    }
  });
});

describe('connections peers ask us to open (ConnectToPeer)', () => {
  test('a burst of P requests cannot hold back a file connection', () => {
    const connects: string[] = [];
    const hanging: import('../src/transport/types').Transport = {
      // Unreachable peers: the attempt neither succeeds nor fails.
      connect: async ({ host }) => {
        connects.push(host);
        return new Promise<never>(() => {});
      },
      listen: async () => ({ port: 0, close: () => {} }),
    };
    const client = new SoulseekClient({
      transport: hanging,
      username: 'test-user',
      password: 'test-pass',
      listenPort: 0,
      serverHost: '127.0.0.1',
      serverPort: 1,
    });
    const accept = (client as unknown as {
      acceptIndirectConnection(request: object): Promise<void>;
    }).acceptIndirectConnection.bind(client);

    for (let i = 0; i < 40; i++) {
      void accept({ username: `peer${i}`, connectionType: 'P', ipAddress: `10.0.0.${i}`, port: 2234, token: i });
    }
    void accept({ username: 'uploader', connectionType: 'F', ipAddress: '10.0.1.1', port: 2234, token: 99 });

    expect(connects.filter(host => host.startsWith('10.0.0.'))).toHaveLength(12);
    expect(connects).toContain('10.0.1.1');
  });

  test('a storm of P requests past the cap costs no server writes and no journal line each', () => {
    const hanging: import('../src/transport/types').Transport = {
      connect: async () => new Promise<never>(() => {}),
      listen: async () => ({ port: 0, close: () => {} }),
    };
    const client = new SoulseekClient({
      transport: hanging,
      username: 'test-user',
      password: 'test-pass',
      listenPort: 0,
      serverHost: '127.0.0.1',
      serverPort: 1,
    });
    const writes: Uint8Array[] = [];
    const internals = client as unknown as {
      serverSocket: { write(data: Uint8Array): void };
      handleServerFrame(code: number, payload: Uint8Array): void;
    };
    internals.serverSocket = { write: data => writes.push(data) };
    const logs: string[] = [];
    client.on('log', message => logs.push(message));

    // A popular title: thousands of peers holding it ask us to connect (we
    // are behind NAT). Seen on the real network: ~9,500 in two minutes.
    for (let i = 0; i < 500; i++) {
      const payload = new ByteWriter()
        .string(`peer${i}`)
        .string('P')
        .u32(0x0a000001 + i)
        .u32(2234)
        .u32(i)
        .bool(false)
        .u32(0)
        .u32(0)
        .toBytes();
      internals.handleServerFrame(18, payload);
    }

    expect(writes).toHaveLength(0);
    expect(logs.length).toBeLessThanOrEqual(13);
  });
});

