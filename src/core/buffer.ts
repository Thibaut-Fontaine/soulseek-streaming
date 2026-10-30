/**
 * How many bytes of a track to receive before handing it to the player.
 *
 * Starting playback is what users feel: a small buffer starts fast, and the
 * native player keeps downloading through the local HTTP proxy meanwhile. The
 * target grows with the file (15 %) but never beyond the configured size, and
 * never below 256 KiB, where the MP3 frame parser needs a little data.
 */

export const MIN_BUFFER_BYTES = 256 * 1024;

export function bufferTargetFor(size: number, bufferMb: number): number {
  if (size <= 0) {
    return MIN_BUFFER_BYTES;
  }

  const cap = Math.max(MIN_BUFFER_BYTES, bufferMb * 1024 * 1024);
  const proportional = Math.floor(size * 0.15);
  return Math.min(size, Math.max(MIN_BUFFER_BYTES, Math.min(cap, proportional)));
}
