/**
 * How much of a track to receive before playback starts.
 *
 * Automatic mode (the default) starts after 0.5 MB from a peer that sends
 * much faster than the track plays, and waits up to 1 MB for a slow one,
 * so fast sources start sooner without slow ones stalling right away.
 */

export const AUTO_BUFFER_MIN = 512 * 1024;
export const AUTO_BUFFER_MAX = 1024 * 1024;
/** Download rate / playback rate at or above which the minimum is enough. */
const FAST_RATIO = 4;
/** At or below this ratio, wait for the maximum. */
const SLOW_RATIO = 1.5;
/** Too little time to trust a rate: wait for the maximum meanwhile. */
const MIN_MEASURE_MS = 300;
/** Assumed when the file gives neither bitrate nor duration. */
const DEFAULT_KBPS = 320;

/** Fixed buffer, as chosen in Réglages: 15 % of the file, capped by the choice. */
export function fixedBufferTarget(size: number, bufferMb: number): number {
  if (size <= 0) {
    return 256 * 1024;
  }
  const cap = Math.max(256 * 1024, bufferMb * 1024 * 1024);
  const proportional = Math.floor(size * 0.15);
  return Math.min(size, Math.max(256 * 1024, Math.min(cap, proportional)));
}

/** Upper bound of the automatic target, shown while buffering. */
export function autoBufferCeiling(size: number): number {
  return size > 0 ? Math.min(size, AUTO_BUFFER_MAX) : AUTO_BUFFER_MAX;
}

/** Bytes per second the track needs to play. */
export function playbackBytesPerSecond(file: { size: number; bitrate?: number; durationSec?: number }): number {
  if (file.durationSec && file.durationSec > 0 && file.size > 0) {
    return file.size / file.durationSec;
  }
  return ((file.bitrate && file.bitrate > 0 ? file.bitrate : DEFAULT_KBPS) * 1000) / 8;
}

/** Automatic target for the rate measured so far (bytes per second, or null). */
export function autoBufferTarget(size: number, downloadRate: number | null, playbackRate: number): number {
  let target = AUTO_BUFFER_MAX;
  if (downloadRate !== null && playbackRate > 0) {
    const ratio = downloadRate / playbackRate;
    const fast = Math.min(1, Math.max(0, (ratio - SLOW_RATIO) / (FAST_RATIO - SLOW_RATIO)));
    target = Math.round(AUTO_BUFFER_MAX - (AUTO_BUFFER_MAX - AUTO_BUFFER_MIN) * fast);
  }
  return size > 0 ? Math.min(size, target) : target;
}

/**
 * Whether enough arrived to start, `elapsedMs` after the bytes started to
 * flow. The rate is received / elapsed.
 */
export function autoBufferReached(
  received: number,
  elapsedMs: number,
  file: { size: number; bitrate?: number; durationSec?: number },
): boolean {
  const rate = elapsedMs >= MIN_MEASURE_MS ? (received * 1000) / elapsedMs : null;
  return received >= autoBufferTarget(file.size, rate, playbackBytesPerSecond(file));
}
