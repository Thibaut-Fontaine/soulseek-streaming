import { ByteQueue, readU32 } from './bytes';
import {
  encodeFileTransferInit,
  encodePlaceInQueueResponse,
  encodeUploadDenied,
  encodeUploadFailed,
  encodeUploadTransferRequest,
} from './protocol';
import type { SharedFileInfo } from './protocol';
import type { SocketLike } from '../transport/types';

/** Reads a shared file. Implemented on top of the device file system. */
export interface ShareFileReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): void;
}

/** What we share. The app shares its cache of tracks already played. */
export interface ShareLibrary {
  files(): SharedFileInfo[];
  open(path: string): Promise<ShareFileReader | null>;
}

/** What the upload manager needs from the client. */
export interface UploadHost {
  /** Sends a message on a P connection to the user, opening one if needed. */
  sendToPeer(username: string, message: Uint8Array): Promise<void>;
  /** Opens an F connection to the user (direct or through the server). */
  openFileConnection(username: string): Promise<{ socket: SocketLike; rest: Uint8Array | null }>;
  nextToken(): number;
  log(message: string): void;
}

export interface UploadOptions {
  /** Whether uploads may start now (sharing on, Wi-Fi only, ...). */
  canUpload: () => boolean;
  slots?: number;
  maxQueued?: number;
  maxQueuedPerUser?: number;
}

export interface UploadStatus {
  active: number;
  queued: number;
  completed: number;
  bytesSent: number;
}

interface QueuedUpload {
  username: string;
  filename: string;
}

const CHUNK_SIZE = 64 * 1024;
const RESPONSE_TIMEOUT_MS = 60000;
const OFFSET_TIMEOUT_MS = 30000;

function sameUser(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function writeAsync(socket: SocketLike, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Upload write timed out')), 60000);
    socket.write(data, error => {
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Serves uploads of shared files to other users, the way regular clients
 * do: QueueUpload → (slot free) TransferRequest → TransferResponse → F
 * connection → FileTransferInit token → peer's offset → file bytes.
 */
export class UploadManager {
  private readonly queue: QueuedUpload[] = [];
  private readonly responseWaiters = new Map<
    number,
    { resolve: (allowed: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private active = 0;
  private completed = 0;
  private bytesSent = 0;
  private stopped = false;
  private readonly openSockets = new Set<SocketLike>();

  constructor(
    private readonly host: UploadHost,
    private readonly library: ShareLibrary,
    private readonly options: UploadOptions,
  ) {}

  get slots(): number {
    return this.options.slots ?? 1;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get hasFreeSlot(): boolean {
    return this.active < this.slots && this.options.canUpload();
  }

  status(): UploadStatus {
    return {
      active: this.active,
      queued: this.queue.length,
      completed: this.completed,
      bytesSent: this.bytesSent,
    };
  }

  private isShared(filename: string): boolean {
    return this.library.files().some(file => file.path === filename);
  }

  /** A peer asked us to queue a file. Replies are sent on `reply`. */
  enqueue(username: string, filename: string, reply: (message: Uint8Array) => void): void {
    if (this.stopped) {
      return;
    }

    if (!this.isShared(filename)) {
      reply(encodeUploadDenied(filename, 'File not shared.'));
      return;
    }

    if (this.queue.some(item => sameUser(item.username, username) && item.filename === filename)) {
      return;
    }

    const maxQueued = this.options.maxQueued ?? 30;
    const perUser = this.options.maxQueuedPerUser ?? 5;

    if (
      this.queue.length >= maxQueued ||
      this.queue.filter(item => sameUser(item.username, username)).length >= perUser
    ) {
      reply(encodeUploadDenied(filename, 'Too many files'));
      return;
    }

    this.queue.push({ username, filename });
    this.pump();
  }

  placeInQueue(username: string, filename: string): Uint8Array {
    const index = this.queue.findIndex(
      item => sameUser(item.username, username) && item.filename === filename,
    );
    return encodePlaceInQueueResponse(filename, index < 0 ? 0 : index + 1);
  }

  /** Answer to one of our TransferRequests. Returns false if not ours. */
  handleTransferResponse(token: number, allowed: boolean): boolean {
    const waiter = this.responseWaiters.get(token);

    if (!waiter) {
      return false;
    }

    clearTimeout(waiter.timer);
    this.responseWaiters.delete(token);
    waiter.resolve(allowed);
    return true;
  }

  /** Starts queued uploads if a slot is free (also call when policy changes). */
  pump(): void {
    while (!this.stopped && this.hasFreeSlot && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active++;

      void this.run(next)
        .catch(error => {
          this.host.log(`Upload vers ${next.username} échoué : ${(error as Error).message}`);
          void this.host.sendToPeer(next.username, encodeUploadFailed(next.filename)).catch(() => {});
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;

    for (const waiter of this.responseWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve(false);
    }

    this.responseWaiters.clear();

    for (const socket of this.openSockets) {
      socket.destroy();
    }

    this.openSockets.clear();
  }

  private async run(item: QueuedUpload): Promise<void> {
    const reader = await this.library.open(item.filename);

    if (!reader) {
      await this.host.sendToPeer(item.username, encodeUploadDenied(item.filename, 'File not shared.'));
      return;
    }

    try {
      const token = this.host.nextToken();
      const response = new Promise<boolean>(resolve => {
        const timer = setTimeout(() => {
          this.responseWaiters.delete(token);
          resolve(false);
        }, RESPONSE_TIMEOUT_MS);
        this.responseWaiters.set(token, { resolve, timer });
      });

      await this.host.sendToPeer(
        item.username,
        encodeUploadTransferRequest(token, item.filename, reader.size),
      );

      if (!(await response)) {
        // The peer no longer wants it, or never answered.
        return;
      }

      const { socket, rest } = await this.host.openFileConnection(item.username);
      this.openSockets.add(socket);

      try {
        // Listen before sending the token: the offset may come back at once.
        const offsetPromise = readOffset(socket, rest);
        offsetPromise.catch(() => {});
        await writeAsync(socket, encodeFileTransferInit(token));
        const offset = await offsetPromise;
        await this.send(socket, reader, offset);
        this.completed++;
      } finally {
        this.openSockets.delete(socket);
        // The downloader closes the connection when it has everything; give
        // it a moment, then make sure the socket is released.
        setTimeout(() => socket.destroy(), 5000);
      }
    } finally {
      reader.close();
    }
  }

  private async send(socket: SocketLike, reader: ShareFileReader, offset: number): Promise<void> {
    let closed = false;
    socket.on('close', () => {
      closed = true;
    });

    let position = Math.max(0, Math.min(offset, reader.size));

    while (position < reader.size) {
      if (closed || this.stopped) {
        throw new Error('Connexion fermée pendant l’envoi');
      }

      const chunk = await reader.read(position, Math.min(CHUNK_SIZE, reader.size - position));

      if (chunk.length === 0) {
        throw new Error('Lecture du fichier impossible');
      }

      await writeAsync(socket, chunk);
      position += chunk.length;
      this.bytesSent += chunk.length;
    }
  }
}

/** Reads the downloader's uint64 start offset from an F connection. */
function readOffset(socket: SocketLike, rest: Uint8Array | null): Promise<number> {
  return new Promise((resolve, reject) => {
    const queue = new ByteQueue();
    let done = false;

    const timer = setTimeout(() => finish(new Error('Pas d’offset reçu')), OFFSET_TIMEOUT_MS);

    function finish(error: Error | null, value = 0) {
      if (done) {
        return;
      }

      done = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    const feed = (chunk: Uint8Array) => {
      if (done) {
        return;
      }

      queue.push(chunk);

      if (queue.length >= 8) {
        const bytes = queue.take(8);
        // uint64 little-endian; files are far below 2^53.
        finish(null, readU32(bytes, 0) + readU32(bytes, 4) * 0x100000000);
      }
    };

    socket.on('data', chunk => {
      if (chunk instanceof Uint8Array) {
        feed(chunk);
      }
    });
    socket.on('close', () => finish(new Error('Connexion fermée avant l’offset')));
    socket.on('error', () => finish(new Error('Erreur de connexion')));

    if (rest && rest.length > 0) {
      feed(rest);
    }
  });
}
