import net from 'node:net';
import { inflate } from 'pako';

import { ByteQueue, ByteReader, ByteWriter, readU32 } from '../src/core/bytes';
import { Framer } from '../src/core/framer';
import {
  PeerCode,
  ServerCode,
  encodePeerInitMessage,
  encodePeerMessage,
  encodeServerMessage,
} from '../src/core/protocol';
import { SoulseekClient } from '../src/core/soulseekClient';
import type { ShareLibrary } from '../src/core/uploads';
import { NodeTransport } from '../src/transport/nodeTransport';

jest.setTimeout(20000);

const SHARED_PATH = 'SoulStream\\Fake Artist - Shared Song.mp3';
const DATA = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 13 + 5) % 251);

function wireIp(address: string): Uint8Array {
  const [a, b, c, d] = address.split('.').map(Number);
  return Uint8Array.from([d, c, b, a]);
}

const library: ShareLibrary = {
  files: () => [{ path: SHARED_PATH, size: DATA.length, bitrate: 320, durationSec: 200 }],
  open: async path =>
    path === SHARED_PATH
      ? {
          size: DATA.length,
          read: async (offset, length) => DATA.slice(offset, offset + length),
          close: () => {},
        }
      : null,
};

/** Fake server plus a fake downloader called "bob". */
class DownloaderNetwork {
  readonly server = net.createServer(socket => this.handleServer(socket));
  readonly bobFiles = net.createServer(socket => this.handleBobFile(socket));
  readonly sockets = new Set<net.Socket>();
  serverPort = 0;
  bobPort = 0;
  clientPort = 0;
  firewalled = false;
  shared: [number, number] | null = null;
  peerFrames: Array<{ code: number; payload: Uint8Array }> = [];
  received = new ByteQueue();
  receivedToken = -1;
  onFrame: ((code: number, payload: Uint8Array) => void) | null = null;
  done: Promise<void>;
  private resolveDone!: () => void;
  private bobSocket: net.Socket | null = null;

  constructor() {
    this.done = new Promise(resolve => (this.resolveDone = resolve));
  }

  async start() {
    await new Promise<void>(r => this.server.listen(0, '127.0.0.1', r));
    await new Promise<void>(r => this.bobFiles.listen(0, '127.0.0.1', r));
    this.serverPort = (this.server.address() as net.AddressInfo).port;
    this.bobPort = (this.bobFiles.address() as net.AddressInfo).port;
  }

  async stop() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await new Promise<void>(r => this.server.close(() => r()));
    await new Promise<void>(r => this.bobFiles.close(() => r()));
  }

  private track(socket: net.Socket) {
    this.sockets.add(socket);
    socket.on('error', () => {});
  }

  private handleServer(socket: net.Socket) {
    this.track(socket);
    const framer = new Framer(4);
    socket.on('data', chunk => {
      for (const { code, payload } of framer.push(new Uint8Array(chunk))) {
        if (code === ServerCode.LOGIN) {
          const w = new ByteWriter();
          w.bool(true).string('hi').raw(wireIp('127.0.0.1')).string('x').bool(false);
          socket.write(encodeServerMessage(ServerCode.LOGIN, w.toBytes()));
        } else if (code === ServerCode.SET_WAIT_PORT) {
          this.clientPort = readU32(payload, 0);
        } else if (code === ServerCode.SHARED_FOLDERS_FILES) {
          this.shared = [readU32(payload, 0), readU32(payload, 4)];
        } else if (code === ServerCode.GET_PEER_ADDRESS) {
          const w = new ByteWriter();
          // A firewalled downloader cannot be reached on its port.
          w.string('bob').raw(wireIp('127.0.0.1')).u32(this.firewalled ? 1 : this.bobPort).u32(0).u16(0);
          socket.write(encodeServerMessage(ServerCode.GET_PEER_ADDRESS, w.toBytes()));
        } else if (code === ServerCode.CONNECT_TO_PEER) {
          const token = readU32(payload, 0);
          const reader = new ByteReader(payload.subarray(4));
          reader.string();
          const type = reader.string();
          if (this.firewalled && type === 'F') {
            const pierce = net.createConnection({ host: '127.0.0.1', port: this.clientPort }, () => {
              const w = new ByteWriter();
              w.u32(token);
              pierce.write(encodePeerInitMessage(0, w.toBytes()));
            });
            this.track(pierce);
            this.readFile(pierce, false);
          }
        }
      }
    });
  }

  /** Bob opens a P connection to the client, like any peer would. */
  connectBob(): Promise<void> {
    return new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port: this.clientPort }, () => {
        const w = new ByteWriter();
        w.string('bob').string('P').u32(0);
        socket.write(encodePeerInitMessage(1, w.toBytes()));
        resolve();
      });
      this.track(socket);
      this.bobSocket = socket;
      const framer = new Framer(4);
      socket.on('data', chunk => {
        for (const frame of framer.push(new Uint8Array(chunk))) {
          this.peerFrames.push(frame);
          this.onFrame?.(frame.code, frame.payload);
        }
      });
    });
  }

  sendPeer(code: number, payload: Uint8Array) {
    this.bobSocket!.write(encodePeerMessage(code, payload));
  }

  waitFrame(code: number): Promise<Uint8Array> {
    const found = this.peerFrames.find(f => f.code === code);
    if (found) {
      return Promise.resolve(found.payload);
    }
    return new Promise(resolve => {
      const previous = this.onFrame;
      this.onFrame = (c, p) => {
        previous?.(c, p);
        if (c === code) {
          resolve(p);
        }
      };
    });
  }

  /** Direct F connection from the client: PeerInit(F) first. */
  private handleBobFile(socket: net.Socket) {
    this.track(socket);
    this.readFile(socket, true);
  }

  private readFile(socket: net.Socket, expectPeerInit: boolean) {
    const queue = new ByteQueue();
    let stage: 'init' | 'token' | 'data' = expectPeerInit ? 'init' : 'token';
    socket.on('data', chunk => {
      queue.push(new Uint8Array(chunk));
      if (stage === 'init' && queue.length >= 4) {
        const length = readU32(queue.peek(4), 0);
        if (queue.length >= 4 + length) {
          queue.skip(4 + length);
          stage = 'token';
        }
      }
      if (stage === 'token' && queue.length >= 4) {
        this.receivedToken = readU32(queue.take(4), 0);
        stage = 'data';
        socket.write(Buffer.alloc(8)); // offset 0
      }
      if (stage === 'data' && queue.length > 0) {
        this.received.push(queue.take(queue.length));
        if (this.received.length >= DATA.length) {
          socket.end();
          this.resolveDone();
        }
      }
    });
  }
}

async function scenario(firewalled: boolean) {
  const network = new DownloaderNetwork();
  network.firewalled = firewalled;
  await network.start();
  const client = new SoulseekClient({
    transport: new NodeTransport(),
    username: 'sharer',
    password: 'pw',
    serverHost: '127.0.0.1',
    serverPort: network.serverPort,
    shares: library,
  });

  try {
    await client.connect();
    await new Promise(r => setTimeout(r, 50));
    expect(network.shared).toEqual([1, 1]);

    await network.connectBob();

    // Browse: the share list is a zlib-compressed folder tree.
    network.sendPeer(PeerCode.GET_SHARE_FILE_LIST, new Uint8Array(0));
    const list = new ByteReader(inflate(await network.waitFrame(PeerCode.SHARED_FILE_LIST_RESPONSE)));
    expect(list.u32()).toBe(1);
    expect(list.string()).toBe('SoulStream');
    expect(list.u32()).toBe(1);
    list.u8();
    expect(list.string()).toBe('Fake Artist - Shared Song.mp3');
    expect(list.u64()).toBe(DATA.length);

    network.sendPeer(PeerCode.USER_INFO_REQUEST, new Uint8Array(0));
    const info = new ByteReader(await network.waitFrame(PeerCode.USER_INFO_RESPONSE));
    expect(info.string()).toBe('SoulStream');

    const queue = new ByteWriter();
    queue.string(SHARED_PATH);
    network.sendPeer(PeerCode.QUEUE_UPLOAD, queue.toBytes());

    const request = new ByteReader(await network.waitFrame(PeerCode.TRANSFER_REQUEST));
    expect(request.u32()).toBe(1); // upload
    const token = request.u32();
    expect(request.string()).toBe(SHARED_PATH);
    expect(request.u64()).toBe(DATA.length);

    const answer = new ByteWriter();
    answer.u32(token).bool(true);
    network.sendPeer(PeerCode.TRANSFER_RESPONSE, answer.toBytes());

    await network.done;
    expect(network.receivedToken).toBe(token);
    expect(Array.from(network.received.take(DATA.length))).toEqual(Array.from(DATA));
  } finally {
    client.disconnect();
    await network.stop();
  }
}

describe('sharing and uploads', () => {
  test('reports the share, answers browse and uploads directly', async () => {
    await scenario(false);
  });

  test('uploads to a firewalled downloader through ConnectToPeer', async () => {
    await scenario(true);
  });

  test('refuses files that are not shared', async () => {
    const network = new DownloaderNetwork();
    await network.start();
    const client = new SoulseekClient({
      transport: new NodeTransport(),
      username: 'sharer',
      password: 'pw',
      serverHost: '127.0.0.1',
      serverPort: network.serverPort,
      shares: library,
    });

    try {
      await client.connect();
      await new Promise(r => setTimeout(r, 50));
      await network.connectBob();
      const queue = new ByteWriter();
      queue.string('Private\\secret.mp3');
      network.sendPeer(PeerCode.QUEUE_UPLOAD, queue.toBytes());
      const denied = new ByteReader(await network.waitFrame(PeerCode.UPLOAD_DENIED));
      expect(denied.string()).toBe('Private\\secret.mp3');
      expect(denied.string()).toBe('File not shared.');
    } finally {
      client.disconnect();
      await network.stop();
    }
  });
});
