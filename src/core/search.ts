import { baseName, displayArtist, displayTitle } from './types';
import type { SearchHit } from './types';

/**
 * Local pre-search layer.
 *
 * The query is cleaned before it is sent to Soulseek (no external API): noise
 * such as "official video", bitrates and bracketed tags is removed, punctuation
 * is normalised, and the result is used both for the network request and for
 * fuzzy matching of the returned files.
 */

const NOISE_PATTERNS: RegExp[] = [
  /\bofficial\s+(music\s+)?video\b/gi,
  /\bofficial\s+(audio|lyric\s+video)\b/gi,
  /\blyrics?\b/gi,
  /\bclip\s+officiel\b/gi,
  /\baudio\s+officiel\b/gi,
  /\bremaster(ed|isé|ise)?\b/gi,
  /\b(hd|hq|4k|1080p|720p)\b/gi,
  /\b(320|256|192|128)\s*kbps\b/gi,
  /\b(mp3|flac|wav|m4a|ogg|opus)\b/gi,
];

export const AUTO_MATCH_SCORE = 0.82;

export function stripDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** Normalised form used by the matcher (lowercase, no accents/punctuation). */
export function normalizeForMatch(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats a raw user query before it is sent to the Soulseek network.
 * Keeps the artist/title order and the meaningful words, drops the noise.
 */
export function formatSearchQuery(raw: string): string {
  let value = stripDiacritics(raw.trim());

  value = value.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');

  for (const pattern of NOISE_PATTERNS) {
    value = value.replace(pattern, ' ');
  }

  value = value
    .replace(/[_/|]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .trim();

  return value.length >= 2 ? value : raw.trim();
}

/** Levenshtein distance with a bounded input length. */
export function levenshtein(a: string, b: string): number {
  const left = a.slice(0, 128);
  const right = b.slice(0, 128);

  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  let previous = new Array<number>(right.length + 1);

  for (let j = 0; j <= right.length; j++) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= right.length; j++) {
      const old = previous[j];
      const cost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1;

      previous[j] = Math.min(
        previous[j] + 1, // deletion
        previous[j - 1] + 1, // insertion
        diagonal + cost, // substitution
      );

      diagonal = old;
    }
  }

  return previous[right.length];
}

export function similarity(a: string, b: string): number {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);

  if (!left && !right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

function sortTokens(value: string): string {
  return value.split(' ').filter(Boolean).sort().join(' ');
}

/**
 * Scores a hit against the normalised query. Combines raw Levenshtein,
 * token-order-insensitive Levenshtein and token coverage, then applies small
 * quality nudges (free slot, bitrate).
 */
export function scoreHit(query: string, hit: SearchHit): number {
  const normalizedQuery = normalizeForMatch(query);

  if (!normalizedQuery) {
    return 0;
  }

  const title = displayTitle(hit.filename);
  const artist = displayArtist(hit);
  const variants = [
    normalizeForMatch(title),
    normalizeForMatch(artist ? `${artist} ${title}` : title),
    normalizeForMatch(baseName(hit.filename).replace(/\.[^.]+$/, '')),
  ].filter(Boolean);

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const sortedQuery = sortTokens(normalizedQuery);
  let best = 0;

  for (const candidate of variants) {
    const maxLength = Math.max(normalizedQuery.length, candidate.length);

    if (maxLength > 0) {
      best = Math.max(best, 1 - levenshtein(normalizedQuery, candidate) / maxLength);
    }

    const sortedCandidate = sortTokens(candidate);
    const sortedLength = Math.max(sortedQuery.length, sortedCandidate.length);

    if (sortedLength > 0) {
      best = Math.max(best, 1 - levenshtein(sortedQuery, sortedCandidate) / sortedLength);
    }

    const candidateTokens = candidate.split(' ').filter(Boolean);
    let matched = 0;

    for (const token of queryTokens) {
      if (
        candidateTokens.some(
          candidateToken =>
            candidateToken === token ||
            candidateToken.startsWith(token) ||
            token.startsWith(candidateToken),
        )
      ) {
        matched++;
      }
    }

    if (matched > 0) {
      const coverage = matched / queryTokens.length;
      best = Math.max(best, 0.55 + 0.45 * coverage);
    }
  }

  if (hit.slotFree) {
    best += 0.02;
  }

  if ((hit.bitrate ?? 0) >= 320) {
    best += 0.03;
  } else if ((hit.bitrate ?? 0) >= 192) {
    best += 0.01;
  }

  return Math.min(1, best);
}

export interface RankedHit {
  hit: SearchHit;
  score: number;
}

function betterQuality(a: SearchHit, b: SearchHit): boolean {
  if (a.slotFree !== b.slotFree) {
    return a.slotFree;
  }

  if ((a.bitrate ?? 0) !== (b.bitrate ?? 0)) {
    return (a.bitrate ?? 0) > (b.bitrate ?? 0);
  }

  return a.avgSpeed > b.avgSpeed;
}

/**
 * Returns the best matching hit above `minScore`.
 * `maxCandidates` bounds the Levenshtein work on very large search batches.
 */
export function pickBestMatch(
  query: string,
  hits: SearchHit[],
  minScore = AUTO_MATCH_SCORE,
  maxCandidates = 200,
): RankedHit | null {
  let best: RankedHit | null = null;
  const limit = Math.min(hits.length, maxCandidates);

  for (let index = 0; index < limit; index++) {
    const hit = hits[index];
    const score = scoreHit(query, hit);

    if (score < minScore) {
      continue;
    }

    if (
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 && betterQuality(hit, best.hit))
    ) {
      best = { hit, score };
    }
  }

  return best;
}
