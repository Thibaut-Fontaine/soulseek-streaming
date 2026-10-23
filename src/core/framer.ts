import { ByteQueue, readU32 } from './bytes';

export interface Frame {
  code: number;
  payload: Uint8Array;
}

/** 16 MiB is far above anything the network sends (search responses included). */
export const MAX_FRAME_SIZE = 16 * 1024 * 1024;

/**
 * Splits a TCP stream into Soulseek frames.
 *
 * - Server and peer messages: `uint32 length | uint32 code | payload`
 *   where `length` counts the 4-byte code and the payload.
 * - Peer-init messages: `uint32 length | uint8 code | payload`
 *   where `length` counts the 1-byte code and the payload.
 */
export class Framer {
  private queue = new ByteQueue();

  constructor(private readonly headerSize: 4 | 1) {}

  push(chunk: Uint8Array): Frame[] {
    this.queue.push(chunk);

    const frames: Frame[] = [];

    while (this.queue.length >= 4 + this.headerSize) {
      const header = this.queue.peek(4);
      const declaredLength = readU32(header, 0);

      if (declaredLength < this.headerSize || declaredLength > MAX_FRAME_SIZE) {
        throw new Error(`Invalid frame length: ${declaredLength}`);
      }

      const totalLength = declaredLength + 4;

      if (this.queue.length < totalLength) {
        break;
      }

      this.queue.skip(4);
      const frame = this.queue.take(declaredLength);

      let code: number;
      let payload: Uint8Array;

      if (this.headerSize === 4) {
        if (declaredLength < 4) {
          throw new Error(`Invalid frame length: ${declaredLength}`);
        }

        code = readU32(frame, 0);
        payload = frame.subarray(4);
      } else {
        code = frame[0];
        payload = frame.subarray(1);
      }

      frames.push({ code, payload });
    }

    return frames;
  }

  reset(): void {
    this.queue.clear();
  }
}
