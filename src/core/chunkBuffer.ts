/* eslint-disable no-bitwise */
/**
 * An append-only, in-memory byte buffer used to expose a Soulseek download as
 * a seekable HTTP resource while it is still being received.
 *
 * Chunks keep their original Uint8Array (no giant re-allocation / copy), and
 * range reads walk the chunk list. This keeps memory usage close to the file
 * size and makes progressive playback cheap.
 */

interface Chunk {
  data: Uint8Array;
  start: number;
}

interface Waiter {
  offset: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export type BufferState = 'open' | 'complete' | 'failed';

export class ChunkBuffer {
  private chunks: Chunk[] = [];
  private waiters = new Set<Waiter>();
  private progressListeners = new Set<(total: number) => void>();
  private stateValue: BufferState = 'open';
  private failure: Error | null = null;
  private totalValue = 0;

  constructor(private readonly maxBytes = 256 * 1024 * 1024) {}

  get total(): number {
    return this.totalValue;
  }

  get state(): BufferState {
    return this.stateValue;
  }

  get error(): Error | null {
    return this.failure;
  }

  append(data: Uint8Array): void {
    if (this.stateValue !== 'open') {
      return;
    }

    if (data.length === 0) {
      return;
    }

    if (this.totalValue + data.length > this.maxBytes) {
      this.fail(new Error('Stream buffer exceeded the maximum in-memory size'));
      return;
    }

    this.chunks.push({ data, start: this.totalValue });
    this.totalValue += data.length;

    this.flushWaiters();

    for (const listener of this.progressListeners) {
      try {
        listener(this.totalValue);
      } catch {
        // Ignore listener errors.
      }
    }
  }

  /**
   * Returns up to `length` bytes starting at `offset`. The result is a copy,
   * because the underlying chunks may be released while it is being written
   * to a socket.
   */
  read(offset: number, length: number): Uint8Array {
    if (length <= 0 || offset < 0 || offset >= this.totalValue) {
      return new Uint8Array(0);
    }

    const available = Math.min(length, this.totalValue - offset);
    const result = new Uint8Array(available);

    let written = 0;
    let index = this.findChunk(offset);

    while (written < available && index < this.chunks.length) {
      const chunk = this.chunks[index];
      const localOffset = offset + written - chunk.start;
      const toCopy = Math.min(chunk.data.length - localOffset, available - written);

      result.set(chunk.data.subarray(localOffset, localOffset + toCopy), written);
      written += toCopy;
      index++;
    }

    return result;
  }

  /** Immediately resolves when the byte at `offset` is available. */
  waitFor(offset: number, timeoutMs = 45000): Promise<void> {
    if (offset < this.totalValue) {
      return Promise.resolve();
    }

    if (this.stateValue === 'complete') {
      return Promise.reject(new Error('Transfer ended before the requested byte'));
    }

    if (this.stateValue === 'failed') {
      return Promise.reject(this.failure ?? new Error('Transfer failed'));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        offset,
        resolve,
        reject,
        timer: null,
      };

      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.waiters.delete(waiter);

          if (this.stateValue === 'failed') {
            reject(this.failure ?? new Error('Transfer failed'));
          } else {
            reject(new Error('Timed out while waiting for more data'));
          }
        }, timeoutMs);
      }

      this.waiters.add(waiter);
    });
  }

  onProgress(listener: (total: number) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  finish(): void {
    if (this.stateValue !== 'open') {
      return;
    }

    this.stateValue = 'complete';
    this.flushWaiters();
  }

  fail(error: Error): void {
    if (this.stateValue !== 'open') {
      return;
    }

    this.stateValue = 'failed';
    this.failure = error;
    this.flushWaiters();
  }

  dispose(): void {
    this.waiters.clear();
    this.progressListeners.clear();
    this.chunks = [];
    this.totalValue = 0;
    this.stateValue = 'failed';
  }

  private findChunk(offset: number): number {
    let low = 0;
    let high = this.chunks.length - 1;
    let result = 0;

    while (low <= high) {
      const middle = (low + high) >> 1;

      if (this.chunks[middle].start <= offset) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return result;
  }

  private flushWaiters(): void {
    if (this.waiters.size === 0) {
      return;
    }

    const isDone = this.stateValue !== 'open';

    for (const waiter of Array.from(this.waiters)) {
      let settle: (() => void) | null = null;

      if (waiter.offset < this.totalValue) {
        settle = () => waiter.resolve();
      } else if (this.stateValue === 'failed') {
        settle = () => waiter.reject(this.failure ?? new Error('Transfer failed'));
      } else if (isDone && this.stateValue === 'complete') {
        settle = () => waiter.reject(new Error('Transfer ended before the requested byte'));
      }

      if (settle) {
        if (waiter.timer) {
          clearTimeout(waiter.timer);
        }

        this.waiters.delete(waiter);
        settle();
      }
    }
  }
}
