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
} from '../src/core/protocol';

/** How a fake peer answers our QueueUpload. */
export type PeerBehavior = 'ok' | 'deny' | 'silent';

export interface FakePeer {
  username: string;
  filename: string;
  behavior: PeerBehavior;
  slotFree?: boolean;
  queueLength?: number;
  avgSpeed?: number;
  bitrate?: number;
  /** Delay before this peer's search response, in ms. */
  delayMs?: number;
}

export const FILE_DATA = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 31 + 7) % 251);

function wireIp(address: string): Uint8Array {
  const [a, b, c, d] = address.split('.').map(Number);
  return Uint8Array.from([d, c, b, a]);
}

function readString(payload: Uint8Array, offset: number): { value: string; next: number } {
  const length = readU32(payload, offset);
  const value = Buffer.from(payload.subarray(offset + 4, offset + 4 + length)).toString('utf8');
  return { value, next: offset + 4 + length };
}

function u32Bytes(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

/**
 * A fake Soulseek server with several peers. Each peer answers searches and
 * reacts to QueueUpload according to its behaviour. Used to test source
 * ranking and fallback through the real client.
 */
export class MultiPeerNetwork {
  private readonly server = net.createServer(socket => this.handleServer(socket));
  private readonly peerServers = new Map<string, { server: net.Server; port: number }>();
  private readonly sockets = new Set<net.Socket>();
  private clientPort = 0;

  serverPort = 0;
  /** QueueUpload requests received, in order, by peer username. */
  readonly queueRequests: string[] = [];

  constructor(private readonly peers: FakePeer[]) {}

  async start(): Promise<void> {
    for (const peer of this.peers) {
      const server = net.createServer(socket => this.handlePeerSocket(peer, socket));
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      this.peerServers.set(peer.username, { server, port: (server.address() as net.AddressInfo).port });
    }

    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.serverPort = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    await new Promise<void>(resolve => this.server.close(() => resolve()));

    for (const { server } of this.peerServers.values()) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
  }

  private handleServer(socket: net.Socket): void {
    this.track(socket);
    const framer = new Framer(4);

    socket.on('data', chunk => {
      for (const frame of framer.push(new Uint8Array(chunk))) {
        this.handleServerFrame(socket, frame.code, frame.payload);
      }
    });
  }

  private handleServerFrame(socket: net.Socket, code: number, payload: Uint8Array): void {
    switch (code) {
      case ServerCode.LOGIN: {
        const writer = new ByteWriter();
        writer.bool(true).string('Fake server').raw(wireIp('127.0.0.1')).string('sum').bool(false);
        socket.write(encodeServerMessage(ServerCode.LOGIN, writer.toBytes()));
        break;
      }

      case ServerCode.SET_WAIT_PORT:
        this.clientPort = readU32(payload, 0);
        break;

      case ServerCode.FILE_SEARCH: {
        const token = readU32(payload, 0);

        for (const peer of this.peers) {
          setTimeout(() => this.sendResults(peer, token), peer.delayMs ?? 20);
        }

        break;
      }

      case ServerCode.GET_PEER_ADDRESS: {
        const { value: username } = readString(payload, 0);
        const port = this.peerServers.get(username)?.port ?? 0;
        const writer = new ByteWriter();
        writer.string(username).raw(wireIp('127.0.0.1')).u32(port).u32(0).u16(0);
        socket.write(encodeServerMessage(ServerCode.GET_PEER_ADDRESS, writer.toBytes()));
        break;
      }

      default:
        break;
    }
  }

  private sendResults(peer: FakePeer, token: number): void {
    const socket = net.createConnection({ host: '127.0.0.1', port: this.clientPort }, () => {
      const init = new ByteWriter();
      init.string(peer.username).string('P').u32(0);
      socket.write(encodePeerInitMessage(1, init.toBytes()));

      const writer = new ByteWriter();
      writer.string(peer.username).u32(token).u32(1);
      writer.u8(1).string(peer.filename).u64(FILE_DATA.length).string('');
      writer.u32(2).u32(0).u32(peer.bitrate ?? 320).u32(1).u32(200);
      writer.bool(peer.slotFree ?? true).u32(peer.avgSpeed ?? 500_000).u32(peer.queueLength ?? 0);
      socket.write(encodePeerMessage(PeerCode.FILE_SEARCH_RESPONSE, deflate(writer.toBytes())));
      // Close it, so the client opens its own P connection for the request.
      socket.end();
    });

    this.track(socket);
  }

  private handlePeerSocket(peer: FakePeer, socket: net.Socket): void {
    this.track(socket);
    const queue = new ByteQueue();
    const framer = new Framer(4);
    let initDone = false;

    socket.on('data', chunk => {
      if (!initDone) {
        queue.push(new Uint8Array(chunk));

        if (queue.length < 4) {
          return;
        }

        const length = readU32(queue.peek(4), 0);

        if (queue.length < 4 + length) {
          return;
        }

        queue.skip(4 + length);
        initDone = true;
        chunk = Buffer.from(queue.take(queue.length));
      }

      for (const frame of framer.push(new Uint8Array(chunk))) {
        this.handlePeerFrame(peer, socket, frame.code, frame.payload);
      }
    });
  }

  private handlePeerFrame(peer: FakePeer, socket: net.Socket, code: number, payload: Uint8Array): void {
    if (code === PeerCode.QUEUE_UPLOAD) {
      const { value: filename } = readString(payload, 0);
      this.queueRequests.push(peer.username);

      if (peer.behavior === 'deny') {
        const writer = new ByteWriter();
        writer.string(filename).string('Banned');
        socket.write(encodePeerMessage(PeerCode.UPLOAD_DENIED, writer.toBytes()));
        return;
      }

      if (peer.behavior === 'silent') {
        return;
      }

      const writer = new ByteWriter();
      writer.u32(TransferDirection.UPLOAD).u32(9000).string(filename).u64(FILE_DATA.length);
      socket.write(encodePeerMessage(PeerCode.TRANSFER_REQUEST, writer.toBytes()));
      return;
    }

    if (code === PeerCode.TRANSFER_RESPONSE && payload[4] !== 0) {
      this.openFileConnection(peer, readU32(payload, 0));
    }
  }

  private openFileConnection(peer: FakePeer, token: number): void {
    const socket = net.createConnection({ host: '127.0.0.1', port: this.clientPort }, () => {
      const init = new ByteWriter();
      init.string(peer.username).string('F').u32(0);
      socket.write(encodePeerInitMessage(1, init.toBytes()));
      socket.write(u32Bytes(token));
    });

    this.track(socket);
    let started = false;

    socket.on('data', chunk => {
      if (started || chunk.length < 8) {
        return;
      }

      started = true;
      let offset = 0;

      const send = () => {
        if (offset >= FILE_DATA.length || socket.destroyed) {
          return;
        }

        const end = Math.min(offset + 16384, FILE_DATA.length);
        socket.write(Buffer.from(FILE_DATA.subarray(offset, end)));
        offset = end;
        setTimeout(send, 1);
      };

      send();
    });
  }
}
