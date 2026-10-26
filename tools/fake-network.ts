/**
 * Development-only fake Soulseek server + peer.
 *
 * Run it with:
 *   npx tsx tools/fake-network.ts
 *
 * Then point the app at 10.0.2.2:<SERVER_PORT> (Android emulator) and make sure
 * the app's listening port is forwarded to the host:
 *   adb forward tcp:22345 tcp:22345
 *
 * This is only used to smoke-test the UI and the media pipeline without a real
 * Soulseek account. It is not part of the shipped application.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

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

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 22420);
const PEER_PORT = Number(process.env.PEER_PORT ?? 22421);
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 22345);
const PEER_IP = process.env.PEER_IP ?? '10.0.2.2';
const FILE_PATH = process.env.FILE ?? path.resolve(process.cwd(), 'tools/demo.mp3');
const DURATION_SEC = Number(process.env.DURATION ?? 28);
// Slow peer, to test what happens while a track loads: wait before accepting
// the upload, and between 16 KiB chunks.
const ACCEPT_DELAY_MS = Number(process.env.ACCEPT_DELAY_MS ?? 0);
const CHUNK_DELAY_MS = Number(process.env.CHUNK_DELAY_MS ?? 5);
// ECHO=1: answer every search with a file named after the query, so catalog
// tracks (searched by artist + title when played) find a source too.
const ECHO = process.env.ECHO === '1';
const sourceFile = fs.existsSync(FILE_PATH) ? FILE_PATH : null;
const extension = sourceFile ? path.extname(sourceFile).slice(1).toLowerCase() || 'mp3' : 'wav';
const USERNAME = 'alice';

function generateDemoWav(): Buffer {
  const sampleRate = 44100;
  const duration = 25;
  const samples = sampleRate * duration;
  const pcm = Buffer.alloc(samples * 2);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const fade = Math.max(0, Math.min(1, t * 4, (duration - t) * 4));
    const value = Math.sin(2 * Math.PI * 440 * t) * 0.18 * fade;
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const data = sourceFile ? fs.readFileSync(sourceFile) : generateDemoWav();
const sockets = new Set<net.Socket>();

if (!sourceFile) {
  log(
    'No FILE provided and tools/demo.mp3 is missing: generated WAV demo. ' +
      'The MP3-only app will ignore it.',
  );
}

let clientPort = CLIENT_PORT;

function log(...args: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

function wireIp(address: string): Uint8Array {
  const [a, b, c, d] = address.split('.').map(Number);
  return Uint8Array.from([d, c, b, a]);
}

function readString(payload: Uint8Array, offset: number): { value: string; next: number } {
  const length = readU32(payload, offset);
  const value = Buffer.from(payload.subarray(offset + 4, offset + 4 + length)).toString('utf8');
  return { value, next: offset + 4 + length };
}

function buildSearchPayload(token: number, query: string): Uint8Array {
  const words = query
    .split(/\s+/)
    .filter(word => word && !word.startsWith('-'))
    .join(' ');
  const files = ECHO
    ? [`Music\\${words}.${extension}`]
    : [1, 2, 3].map(
        index => `Music\\Fake Artist\\Fake Album\\0${index} - Fake Song ${index}.${extension}`,
      );

  const writer = new ByteWriter();
  writer.string(USERNAME).u32(token).u32(files.length);

  for (const filename of files) {
    writer.u8(1).string(filename).u64(data.length).string('');
    // bitrate (0), duration (1), sample rate (4)
    writer.u32(3).u32(0).u32(192).u32(1).u32(ECHO ? 0 : DURATION_SEC).u32(4).u32(44100);
  }

  writer.bool(true).u32(500000).u32(0).u32(0);
  return deflate(writer.toBytes());
}

function handleServerConnection(socket: net.Socket): void {
  sockets.add(socket);
  const framer = new Framer(4);
  let loggedIn = false;

  socket.on('data', chunk => {
    let frames;

    try {
      frames = framer.push(new Uint8Array(chunk));
    } catch {
      socket.destroy();
      return;
    }

    for (const frame of frames) {
      switch (frame.code) {
        case ServerCode.LOGIN: {
          const writer = new ByteWriter();
          writer.bool(true).string('Fake server').raw(wireIp('127.0.0.1'));
          writer.string('checksum').bool(false);
          socket.write(encodeServerMessage(ServerCode.LOGIN, writer.toBytes()));
          loggedIn = true;
          log('client logged in');
          break;
        }

        case ServerCode.SET_WAIT_PORT: {
          clientPort = readU32(frame.payload, 0) || CLIENT_PORT;
          log('client listening port', clientPort);
          break;
        }

        case ServerCode.FILE_SEARCH: {
          const token = readU32(frame.payload, 0);
          const { value: query } = readString(frame.payload, 4);
          log('search token', token, JSON.stringify(query));

          if (!query.toLowerCase().includes('none')) {
            setTimeout(() => sendSearchResults(token, query), 120);
          }

          break;
        }

        case ServerCode.GET_PEER_ADDRESS: {
          const writer = new ByteWriter();
          writer
            .string(USERNAME)
            .raw(wireIp(PEER_IP))
            .u32(PEER_PORT)
            .u32(0)
            .u16(0);
          socket.write(encodeServerMessage(ServerCode.GET_PEER_ADDRESS, writer.toBytes()));
          log('sent peer address', PEER_IP, PEER_PORT);
          break;
        }

        default:
          if (loggedIn && frame.code !== ServerCode.SERVER_PING) {
            log('server message', frame.code);
          }
      }
    }
  });

  socket.on('close', () => {
    sockets.delete(socket);
    log('server connection closed');
  });
  socket.on('error', () => {});
}

function sendSearchResults(token: number, query: string): void {
  const socket = net.createConnection({ host: '127.0.0.1', port: clientPort }, () => {
    const init = new ByteWriter();
    init.string(USERNAME).string('P').u32(0);
    socket.write(encodePeerInitMessage(1, init.toBytes()));
    socket.write(encodePeerMessage(PeerCode.FILE_SEARCH_RESPONSE, buildSearchPayload(token, query)));
    log('sent search result');
  });

  sockets.add(socket);
  // The client may reuse this connection to ask for the file.
  const framer = new Framer(4);
  socket.on('data', chunk => {
    for (const frame of framer.push(new Uint8Array(chunk))) {
      answerPeerFrame(socket, frame);
    }
  });
  socket.on('error', error => log('search connection error', error.message));
  // Real peers close this idle connection after a while too.
  setTimeout(() => socket.destroy(), Number(process.env.RESULT_CONN_MS ?? 5000));
}

function startFileConnection(token: number): void {
  const fileSocket = net.createConnection({ host: '127.0.0.1', port: clientPort }, () => {
    const init = new ByteWriter();
    init.string(USERNAME).string('F').u32(0);
    fileSocket.write(encodePeerInitMessage(1, init.toBytes()));

    const tokenBytes = new Uint8Array(4);
    tokenBytes[0] = token & 0xff;
    tokenBytes[1] = (token >>> 8) & 0xff;
    tokenBytes[2] = (token >>> 16) & 0xff;
    tokenBytes[3] = (token >>> 24) & 0xff;
    fileSocket.write(tokenBytes);
    log('file connection opened, token', token);
  });

  sockets.add(fileSocket);
  let offsetReceived = false;

  fileSocket.on('data', chunk => {
    if (offsetReceived) {
      return;
    }

    if (Buffer.from(chunk).length >= 8) {
      offsetReceived = true;
      log('offset received, streaming', data.length, 'bytes');
      let offset = 0;
      const send = () => {
        if (offset >= data.length) {
          log('file fully sent');
          return;
        }
        if (fileSocket.destroyed) {
          log('file connection closed by the client at', offset);
          return;
        }

        const end = Math.min(offset + 16384, data.length);
        fileSocket.write(data.subarray(offset, end));
        offset = end;
        setTimeout(send, CHUNK_DELAY_MS);
      };
      send();
    }
  });

  fileSocket.on('error', error => log('file connection error', error.message));
}

/** Upload requests, on whichever P connection they arrive. */
function answerPeerFrame(socket: net.Socket, frame: { code: number; payload: Uint8Array }): void {
  if (frame.code === PeerCode.QUEUE_UPLOAD) {
    const { value: requestedName } = readString(frame.payload, 0);
    const writer = new ByteWriter();
    writer
      .u32(TransferDirection.UPLOAD)
      .u32(4242)
      .string(requestedName)
      .u64(data.length);
    setTimeout(() => {
      socket.write(encodePeerMessage(PeerCode.TRANSFER_REQUEST, writer.toBytes()));
      log('sent TransferRequest');
    }, ACCEPT_DELAY_MS);
  } else if (frame.code === PeerCode.TRANSFER_RESPONSE) {
    const allowed = frame.payload[4] !== 0;
    const token = readU32(frame.payload, 0);
    log('TransferResponse', allowed, 'token', token);

    if (allowed) {
      startFileConnection(token);
    }
  } else {
    log('peer message', frame.code);
  }
}

function handlePeerConnection(socket: net.Socket): void {
  sockets.add(socket);
  const queue = new ByteQueue();
  const framer = new Framer(4);
  let stage: 'init' | 'peer' = 'init';


  const pump = () => {
    if (stage === 'init') {
      if (queue.length < 5) {
        return;
      }

      const declared = readU32(queue.peek(4), 0);

      if (declared < 1 || queue.length < declared + 4) {
        return;
      }

      queue.skip(4);
      const frame = queue.take(declared);
      const code = frame[0];

      if (code !== 1) {
        socket.destroy();
        return;
      }

      parsePeerInit(frame.subarray(1));
      stage = 'peer';
      log('peer P connection established');
      pump();
      return;
    }

    if (queue.length > 0) {
      const chunk = queue.take(queue.length);

      for (const frame of framer.push(chunk)) {
        answerPeerFrame(socket, frame);
      }
    }
  };

  socket.on('data', chunk => {
    queue.push(new Uint8Array(chunk));
    pump();
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    sockets.delete(socket);
  });
}

const server = net.createServer(handleServerConnection);
const peer = net.createServer(handlePeerConnection);

server.listen(SERVER_PORT, '0.0.0.0', () => {
  log(`fake server listening on 0.0.0.0:${SERVER_PORT}`);
});

peer.listen(PEER_PORT, '0.0.0.0', () => {
  log(`fake peer listening on 0.0.0.0:${PEER_PORT}`);
});

process.on('SIGINT', () => {
  for (const socket of sockets) {
    socket.destroy();
  }

  server.close();
  peer.close();
  process.exit(0);
});
