/**
 * Pure view-model helpers for peer and transfer state. No React Native
 * imports, so everything here is unit-testable under plain jest.
 */
import { normalizeForMatch } from '../core/search';
import type { TransferSnapshot } from '../core/transfer';
import { displayArtist, displayTitle, hitKey } from '../core/types';
import type { SearchHit } from '../core/types';
import type { IconName } from './iconPaths';
import { formatBytes, formatSpeed, percent } from './theme';
import type { Tone } from './theme';

// ---------------------------------------------------------------------------
// Peer badges (DESIGN.md §4.1)

export interface BadgeModel {
  key: string;
  label: string;
  tone: Tone;
  icon?: IconName;
}

/** Queue length above which a peer is shown as "bad" rather than "warn". */
export const LONG_QUEUE = 50;

/** Short bitrate label: `320`, `V0`, `192`… or null when unknown. */
export function bitrateLabel(hit: Pick<SearchHit, 'bitrate' | 'vbr'>): string | null {
  if (!hit.bitrate || hit.bitrate <= 0) {
    return null;
  }

  if (hit.vbr) {
    if (hit.bitrate >= 220) {
      return 'V0';
    }

    if (hit.bitrate >= 170) {
      return 'V2';
    }

    return `VBR ${hit.bitrate}`;
  }

  return String(hit.bitrate);
}

function bitrateTone(hit: Pick<SearchHit, 'bitrate' | 'vbr'>): Tone {
  const bitrate = hit.bitrate ?? 0;
  return bitrate >= 256 || (hit.vbr && bitrate >= 220) ? 'accent' : 'neutral';
}

export type PeerAvailability = 'free' | 'queued' | 'busy';

export function peerAvailability(hit: Pick<SearchHit, 'slotFree' | 'queueLength'>): PeerAvailability {
  if (hit.slotFree) {
    return 'free';
  }

  return hit.queueLength > LONG_QUEUE ? 'busy' : 'queued';
}

/**
 * Badges for one candidate peer. `long` uses the wordier labels of the
 * hero card ("320 kb/s", "Slot libre").
 */
export function peerBadges(hit: SearchHit, options: { long?: boolean } = {}): BadgeModel[] {
  const badges: BadgeModel[] = [];
  const bitrate = bitrateLabel(hit);

  if (bitrate) {
    badges.push({
      key: 'bitrate',
      label: options.long && !hit.vbr ? `${bitrate} kb/s` : bitrate,
      tone: bitrateTone(hit),
    });
  }

  if (hit.slotFree) {
    badges.push({
      key: 'slot',
      label: options.long ? 'Slot libre' : 'Libre',
      tone: 'good',
      icon: options.long ? 'check' : undefined,
    });
  } else {
    badges.push({
      key: 'slot',
      label: hit.queueLength > 0 ? `File ${hit.queueLength}` : 'Occupé',
      tone: hit.queueLength > LONG_QUEUE ? 'bad' : 'warn',
      icon: 'clock',
    });
  }

  if (hit.avgSpeed > 0) {
    badges.push({
      key: 'speed',
      label: formatSpeed(hit.avgSpeed),
      tone: 'info',
      icon: options.long ? 'bolt' : undefined,
    });
  }

  if (!options.long && hit.size > 0) {
    badges.push({ key: 'size', label: formatBytes(hit.size), tone: 'neutral' });
  }

  return badges;
}

// ---------------------------------------------------------------------------
// Transfer steps (DESIGN.md §4.2)

export type StepStatus = 'done' | 'current' | 'todo' | 'failed';

export interface StepModel {
  key: 'request' | 'accept' | 'connect' | 'buffer';
  label: string;
  status: StepStatus;
  /** Fill ratio of the current step's bar, 0–1. */
  progress: number;
}

type TransferLike = Pick<TransferSnapshot, 'state' | 'received' | 'queuePosition'>;

const STEP_INDEX: Record<TransferSnapshot['state'], number> = {
  requesting: 0,
  queued: 1,
  'awaiting-file': 2,
  streaming: 3,
  complete: 4,
  failed: -1,
  cancelled: -1,
};

export function transferSteps(
  snapshot: TransferLike | null | undefined,
  bufferTarget: number,
): StepModel[] {
  const state = snapshot?.state ?? 'requesting';
  const received = snapshot?.received ?? 0;
  const failed = state === 'failed' || state === 'cancelled';
  // A failed snapshot does not say which step failed: if bytes arrived it was
  // the buffer, otherwise the request never got through.
  const index = failed ? (received > 0 ? 3 : 0) : STEP_INDEX[state];
  const bufferRatio = percent(received, bufferTarget);

  const acceptLabel =
    state === 'queued'
      ? snapshot?.queuePosition
        ? `En file · position ${snapshot.queuePosition}`
        : 'En file'
      : 'Acceptée';

  const labels: Array<[StepModel['key'], string]> = [
    ['request', 'Requête'],
    ['accept', acceptLabel],
    ['connect', 'Connexion'],
    ['buffer', `Tampon ${formatBytes(Math.min(received, bufferTarget))} / ${formatBytes(bufferTarget)}`],
  ];

  return labels.map(([key, label], i) => {
    let status: StepStatus = 'todo';

    if (i < index) {
      status = 'done';
    } else if (i === index) {
      status = failed ? 'failed' : 'current';
    }

    const progress =
      status === 'done' ? 1 : status === 'current' ? (key === 'buffer' ? bufferRatio : 0.5) : 0;

    return { key, label, status, progress };
  });
}

/** Estimated seconds until `bufferTarget` is reached, or null if unknown. */
export function bufferEta(received: number, bufferTarget: number, bytesPerSecond: number): number | null {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return null;
  }

  return Math.max(0, Math.ceil((bufferTarget - received) / bytesPerSecond));
}

/** Queue position from which we suggest trying another peer. */
export const QUEUE_WARN_POSITION = 5;

// ---------------------------------------------------------------------------
// Seeking (DESIGN.md §4.3)

/** Seconds kept between a clamped seek and the received edge. */
export const SEEK_EDGE_MARGIN_SEC = 2;

/**
 * Peers always stream from offset 0, so only the received part of the file
 * is seekable. Clamps a target position to just before the received edge.
 */
export function clampSeek(
  targetSec: number,
  durationSec: number,
  receivedRatio: number,
  marginSec = SEEK_EDGE_MARGIN_SEC,
): { seconds: number; clamped: boolean } {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { seconds: 0, clamped: false };
  }

  const target = Math.max(0, Math.min(durationSec, Number.isFinite(targetSec) ? targetSec : 0));

  if (receivedRatio >= 1) {
    return { seconds: target, clamped: false };
  }

  const edge = Math.max(0, Math.max(0, receivedRatio) * durationSec - marginSec);

  if (target > edge) {
    return { seconds: edge, clamped: true };
  }

  return { seconds: target, clamped: false };
}

// ---------------------------------------------------------------------------
// Source groups (DESIGN.md §4.5)

export interface SourceGroup {
  key: string;
  title: string;
  artist: string | null;
  hits: SearchHit[];
  /** True when no peer of the group has a free slot. */
  allQueued: boolean;
  durationSec?: number;
}

/** Best peer first: free slot, then short queue, then speed, then bitrate. */
export function compareSources(a: SearchHit, b: SearchHit): number {
  return (
    Number(b.slotFree) - Number(a.slotFree) ||
    a.queueLength - b.queueLength ||
    b.avgSpeed - a.avgSpeed ||
    (b.bitrate ?? 0) - (a.bitrate ?? 0)
  );
}

/** Groups candidate files by normalised track title, best group first. */
export function groupSources(hits: readonly SearchHit[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  const seen = new Set<string>();

  for (const hit of hits) {
    const id = hitKey(hit);

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);

    const title = displayTitle(hit.filename);
    const key = normalizeForMatch(title) || id;
    const group = groups.get(key);

    if (group) {
      group.hits.push(hit);
      group.durationSec = group.durationSec ?? hit.durationSec;
    } else {
      groups.set(key, {
        key,
        title,
        artist: displayArtist(hit),
        hits: [hit],
        allQueued: false,
        durationSec: hit.durationSec,
      });
    }
  }

  const list = [...groups.values()];

  for (const group of list) {
    group.hits.sort(compareSources);
    group.allQueued = !group.hits.some(hit => hit.slotFree);
  }

  return list.sort(
    (a, b) => b.hits.length - a.hits.length || compareSources(a.hits[0], b.hits[0]),
  );
}

/** "320 kb/s · MP3 · 11,2 Mo" line used by the source chip. */
export function sourceSummary(hit: SearchHit, liveSpeed?: number): string {
  const parts: string[] = [];

  if (hit.bitrate) {
    parts.push(hit.vbr ? `${bitrateLabel(hit)} (${hit.bitrate} kb/s)` : `${hit.bitrate} kb/s`);
  }

  parts.push(hit.extension.toUpperCase());

  if (hit.size > 0) {
    parts.push(formatBytes(hit.size));
  }

  if (liveSpeed && liveSpeed > 0) {
    parts.push(formatSpeed(liveSpeed));
  }

  return parts.join(' · ');
}
