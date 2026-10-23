import { ChunkBuffer } from './chunkBuffer';
import { encodeFileOffset } from './protocol';
import type { SearchHit } from './types';
import type { SocketLike } from '../transport/types';

export type TransferState =
  | 'requesting'
  | 'queued'
  | 'awaiting-file'
  | 'streaming'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface TransferSnapshot {
  id: string;
  username: string;
  filename: string;
  size: number;
  received: number;
  state: TransferState;
  queuePosition: number | null;
  error: string | null;
  token: number | null;
  startedAt: number;
}

const EMIT_INTERVAL_MS = 250;

/**
 * One file being pulled from a peer. The peer sends a `TransferRequest`, we
 * accept it, then it opens a separate "F" connection and streams raw bytes.
 */
export class StreamTransfer {
  readonly id: string;
  readonly hit: SearchHit;
  readonly buffer: ChunkBuffer;
  readonly startedAt = Date.now();

  state: TransferState = 'requesting';
  token: number | null = null;
  expectedSize: number;
  queuePosition: number | null = null;
  error: string | null = null;

  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = 0;
  private throttle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    hit: SearchHit,
    private readonly onChange: (transfer: StreamTransfer) => void,
  ) {
    this.id = `${hit.username}::${hit.filename}::${Date.now().toString(36)}`;
    this.hit = hit;
    this.expectedSize = hit.size;
    this.buffer = new ChunkBuffer();
  }

  get received(): number {
    return this.buffer.total;
  }

  get isActive(): boolean {
    return (
      this.state === 'requesting' ||
      this.state === 'queued' ||
      this.state === 'awaiting-file' ||
      this.state === 'streaming'
    );
  }

  snapshot(): TransferSnapshot {
    return {
      id: this.id,
      username: this.hit.username,
      filename: this.hit.filename,
      size: this.expectedSize,
      received: this.received,
      state: this.state,
      queuePosition: this.queuePosition,
      error: this.error,
      token: this.token,
      startedAt: this.startedAt,
    };
  }

  markQueued(): void {
    if (!this.isActive) {
      return;
    }

    if (this.state === 'requesting') {
      this.state = 'queued';
      this.emit(true);
    }
  }

  setQueuePosition(position: number): void {
    if (!this.isActive) {
      return;
    }

    this.queuePosition = position;

    if (this.state === 'requesting') {
      this.state = 'queued';
    }

    this.emit(true);
  }

  /** The uploader accepted us and gave us the token used on the F connection. */
  markAwaiting(token: number, size: number, timeoutMs = 180000): void {
    if (!this.isActive) {
      return;
    }

    this.token = token;

    if (size > 0) {
      this.expectedSize = size;
    }

    this.state = 'awaiting-file';
    this.emit(true);

    this.clearTimer();
    this.timer = setTimeout(() => {
      this.fail("Le pair n'a pas ouvert la connexion de transfert");
    }, timeoutMs);
  }

  /** Called when the uploader's file connection is ready. */
  attach(socket: SocketLike, initialData?: Uint8Array): void {
    if (this.state !== 'awaiting-file' && this.state !== 'queued') {
      socket.destroy();
      return;
    }

    this.clearTimer();
    this.socket = socket;
    this.state = 'streaming';
    this.emit(true);

    // A zero offset means "start from the beginning". Seeking a not-yet
    // downloaded region is intentionally not supported at the protocol level
    // (it would occupy an upload slot just for a few bytes).
    socket.write(encodeFileOffset(0));

    socket.on('data', value => {
      if (value instanceof Uint8Array) {
        this.append(value);
      }
    });

    socket.on('error', (value) => {
      if (this.state === 'streaming') {
        this.fail(value instanceof Error ? value.message : 'Erreur de transfert');
      }
    });

    socket.on('close', () => {
      if (this.state === 'streaming' && this.received < this.expectedSize) {
        this.fail('Le pair a interrompu le transfert');
      }
    });

    if (initialData && initialData.length > 0) {
      this.append(initialData);
    }
  }

  append(data: Uint8Array): void {
    if (this.state !== 'streaming') {
      return;
    }

    const remaining = this.expectedSize - this.received;

    if (remaining <= 0) {
      return;
    }

    const slice = data.length > remaining ? data.subarray(0, remaining) : data;
    this.buffer.append(slice);
    this.emit(false);

    if (this.received >= this.expectedSize) {
      this.complete();
    }
  }

  complete(): void {
    if (this.state !== 'streaming') {
      return;
    }

    this.state = 'complete';
    this.clearTimer();
    this.buffer.finish();

    // The downloader is responsible for closing the file connection.
    try {
      this.socket?.end();
    } catch {
      // Ignore.
    }

    this.socket = null;
    this.emit(true, true);
  }

  fail(reason: string): void {
    if (!this.isActive) {
      return;
    }

    this.state = 'failed';
    this.error = reason;
    this.clearTimer();
    this.buffer.fail(new Error(reason));
    this.detachSocket();
    this.emit(true, true);
  }

  cancel(): void {
    if (!this.isActive && this.state !== 'complete') {
      return;
    }

    this.state = 'cancelled';
    this.clearTimer();
    this.buffer.fail(new Error('Transfert annulé'));
    this.detachSocket();
    this.emit(true, true);
  }

  /** Called by the client when the peer connection dies before the token arrives. */
  failFromPeer(reason: string): void {
    if (this.isActive) {
      this.fail(reason);
    }
  }

  private detachSocket(): void {
    if (!this.socket) {
      return;
    }

    try {
      this.socket.destroy();
    } catch {
      // Ignore.
    }

    this.socket = null;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(force: boolean, finished = false): void {
    const now = Date.now();

    if (!force && now - this.lastEmit < EMIT_INTERVAL_MS) {
      if (!this.throttle && !finished) {
        this.throttle = setTimeout(() => {
          this.throttle = null;
          this.lastEmit = Date.now();
          this.onChange(this);
        }, EMIT_INTERVAL_MS - (now - this.lastEmit));
      }

      return;
    }

    this.lastEmit = now;
    this.onChange(this);
  }
}
