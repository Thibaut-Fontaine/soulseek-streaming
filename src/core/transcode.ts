import type { RankedHit } from './search';
import type { SearchHit } from './types';

/**
 * Source/transcode policy for the 94 kbps experiment (feature 10).
 *
 * The native encoder is not part of the app yet: LAME would have to be
 * vendored and built for each ABI (see `docs/bitrate-transcode.md`). These
 * rules are pure so the decision can be tested now and wired to a native
 * encoder later without touching the player again.
 *
 * The policy deliberately picks the *smallest* usable source: on mobile data
 * and on a low-RAM phone, a 96 kbps file that starts now beats a 320 kbps one.
 * If no small source exists, or its uploader cannot sustain its own bitrate,
 * the selection asks for a transcode to the 94 kbps target. If the encoder
 * fails, playback must continue with the original bytes.
 */

export const TRANSCODE_TARGET_KBPS = 94;
export const SMALL_SOURCE_KBPS = 128;
const SPEED_SAFETY_FACTOR = 1.2;

export type SourceAction = 'original' | 'transcode';

export type SourceReason =
  | 'small-source'
  | 'no-small-source'
  | 'slow-uploader'
  | 'unknown-bitrate'
  | 'encoder-failed';

export interface PlaybackSourcePlan {
  hit: SearchHit;
  action: SourceAction;
  reason: SourceReason;
  /** Set for a transcode, in kbps. */
  targetKbps?: number;
}

export interface TranscodePolicy {
  /** 94 by default; MP3 ABR at 94 is close to 96 kbps CBR. */
  targetKbps?: number;
  /** At or below this, play the file as is. */
  smallSourceKbps?: number;
  /** Extra headroom over the source bitrate for real-time playback. */
  speedSafetyFactor?: number;
}

/** Announced bitrate, or a size/duration estimate when the peer omits it. */
export function sourceBitrateKbps(
  hit: Pick<SearchHit, 'bitrate' | 'size' | 'durationSec'>,
): number | undefined {
  if (hit.bitrate !== undefined && hit.bitrate > 0) {
    return Math.round(hit.bitrate);
  }
  if (hit.size > 0 && hit.durationSec !== undefined && hit.durationSec > 0) {
    return Math.round((hit.size * 8) / (hit.durationSec * 1000));
  }
  return undefined;
}

function isSlow(hit: SearchHit, bitrate: number, safety: number): boolean {
  // Peers report 0 when they do not know their speed: do not punish that.
  if (!hit.avgSpeed || hit.avgSpeed <= 0) {
    return false;
  }
  const requiredBytesPerSecond = (bitrate * 1000) / 8;
  return hit.avgSpeed < requiredBytesPerSecond * safety;
}

function sortSmallest(sources: RankedHit[]): RankedHit[] {
  return [...sources].sort((a, b) => {
    const left = sourceBitrateKbps(a.hit) ?? Number.POSITIVE_INFINITY;
    const right = sourceBitrateKbps(b.hit) ?? Number.POSITIVE_INFINITY;
    if (left !== right) {
      return left - right;
    }
    if (a.hit.size !== b.hit.size) {
      return a.hit.size - b.hit.size;
    }
    return b.rank - a.rank;
  });
}

export function choosePlaybackSource(
  sources: RankedHit[],
  policy: TranscodePolicy = {},
): PlaybackSourcePlan | null {
  if (sources.length === 0) {
    return null;
  }

  const targetKbps = policy.targetKbps ?? TRANSCODE_TARGET_KBPS;
  const smallSourceKbps = policy.smallSourceKbps ?? SMALL_SOURCE_KBPS;
  const safety = policy.speedSafetyFactor ?? SPEED_SAFETY_FACTOR;
  const sorted = sortSmallest(sources);
  const smallest = sorted[0];
  const bitrate = sourceBitrateKbps(smallest.hit);

  if (bitrate === undefined) {
    return { hit: smallest.hit, action: 'original', reason: 'unknown-bitrate' };
  }

  const small = bitrate <= smallSourceKbps;
  const slow = isSlow(smallest.hit, bitrate, safety);

  if (small && !slow) {
    return { hit: smallest.hit, action: 'original', reason: 'small-source' };
  }

  if (slow) {
    // The smallest file is useless if its uploader cannot feed it in real
    // time. A faster peer is worth the larger download, then the encoder
    // brings the stream down to the target.
    const faster = sorted.find(candidate => {
      const candidateBitrate = sourceBitrateKbps(candidate.hit);
      return (
        candidate.hit.slotFree &&
        candidateBitrate !== undefined &&
        !isSlow(candidate.hit, candidateBitrate, safety)
      );
    });
    return {
      hit: (faster ?? smallest).hit,
      action: 'transcode',
      reason: 'slow-uploader',
      targetKbps,
    };
  }

  return { hit: smallest.hit, action: 'transcode', reason: 'no-small-source', targetKbps };
}

/**
 * The encoder failed after the source was chosen: keep the same bytes and
 * play the original file, never block playback on a missing transcode.
 */
export function encoderFailureFallback(plan: PlaybackSourcePlan | null): PlaybackSourcePlan | null {
  return plan
    ? { hit: plan.hit, action: 'original', reason: 'encoder-failed' }
    : null;
}
