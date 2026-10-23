import { baseName, parseTrackName } from './types';
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
 * Words that mark a different recording. They cost points unless the user
 * typed them, so "One More Time (Live)" loses to the studio version.
 */
const VERSION_WORDS = new Set([
  'live', 'remix', 'rmx', 'acoustic', 'instrumental', 'karaoke', 'cover',
  'interview', 'demo', 'extended', 'edit', 'bootleg', 'mashup', 'nightcore',
  'sped', 'slowed', 'reverb', 'rehearsal', 'session', 'unplugged', 'medley',
  'tribute', 'preview', 'snippet', 'intro', 'outro', 'reprise', 'commentary',
]);

const VERSION_PENALTY = 0.15;
const MAX_VERSION_PENALTY = 0.3;

function tokensMatch(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) {
    return true;
  }

  // Prefix matches ("tim" -> "time") only for real words, never for single
  // letters, which would otherwise match almost anything.
  if (queryToken.length >= 3 && candidateToken.length >= 3) {
    if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) {
      return true;
    }
  }

  // One typo in a longer word.
  if (queryToken.length >= 5 && Math.abs(queryToken.length - candidateToken.length) <= 1) {
    return levenshtein(queryToken, candidateToken) <= 1;
  }

  return false;
}

function isNumeric(token: string): boolean {
  return /^\d+$/.test(token);
}

/**
 * Text match between the query and one candidate string, in [0, 1].
 * Combines how much of the query is found (coverage), how much of the
 * candidate is explained by the query (precision, so extra words cost), and an
 * order-insensitive Levenshtein similarity for typos.
 */
function matchCandidate(queryTokens: string[], sortedQuery: string, candidate: string): number {
  const queryHasNumber = queryTokens.some(isNumeric);
  // Track numbers and years the user did not type are noise, not extra words.
  const candidateTokens = candidate
    .split(' ')
    .filter(token => token.length > 0 && (queryHasNumber || !isNumeric(token)));

  if (candidateTokens.length === 0) {
    return 0;
  }

  const used = new Array<boolean>(candidateTokens.length).fill(false);
  let matched = 0;

  for (const token of queryTokens) {
    const index = candidateTokens.findIndex(
      (candidateToken, i) => !used[i] && tokensMatch(token, candidateToken),
    );

    if (index >= 0) {
      used[index] = true;
      matched++;
    }
  }

  const coverage = matched / queryTokens.length;
  const precision = used.filter(Boolean).length / candidateTokens.length;
  const sortedCandidate = sortTokens(candidateTokens.join(' '));
  const maxLength = Math.max(sortedQuery.length, sortedCandidate.length);
  const fuzzy = maxLength > 0 ? 1 - levenshtein(sortedQuery, sortedCandidate) / maxLength : 0;

  return 0.6 * coverage + 0.25 * precision + 0.15 * fuzzy;
}

/**
 * How well a hit matches the query text, in [0, 1]. Quality and availability
 * are handled separately by `rankHits`.
 */
export function matchScore(query: string, hit: SearchHit): number {
  const normalizedQuery = normalizeForMatch(query);

  if (!normalizedQuery) {
    return 0;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const sortedQuery = sortTokens(normalizedQuery);
  const { artist, title } = parseTrackName(hit.filename);
  const normalizedTitle = normalizeForMatch(title);
  const variants = new Set(
    [
      normalizedTitle,
      artist ? normalizeForMatch(`${artist} ${title}`) : '',
      normalizeForMatch(baseName(hit.filename).replace(/\.[^.]+$/, '')),
    ].filter(Boolean),
  );

  let best = 0;

  for (const candidate of variants) {
    best = Math.max(best, matchCandidate(queryTokens, sortedQuery, candidate));
  }

  // Penalise version markers found in the file name but not in the query.
  const queryWords = new Set(queryTokens);
  const fileWords = new Set(
    normalizeForMatch(baseName(hit.filename)).split(' ').filter(Boolean),
  );
  let penalty = 0;

  for (const word of fileWords) {
    if (VERSION_WORDS.has(word) && !queryWords.has(word)) {
      penalty += VERSION_PENALTY;
    }
  }

  best -= Math.min(MAX_VERSION_PENALTY, penalty);

  // Very short files are previews or snippets.
  if (hit.durationSec !== undefined && hit.durationSec > 0 && hit.durationSec < 45) {
    best -= 0.35;
  }

  return Math.max(0, Math.min(1, best));
}

/**
 * How likely a peer is to deliver the file quickly, in [0, 1]: a free upload
 * slot matters most, then a short queue, then speed and bitrate.
 */
export function availabilityScore(hit: SearchHit): number {
  const slot = hit.slotFree ? 1 : 0;
  const queue = 1 - Math.min(1, Math.max(0, hit.queueLength) / 20);
  // avgSpeed is bytes/s; 1 MB/s or more counts as full speed.
  const speed = Math.min(1, Math.log10(1 + Math.max(0, hit.avgSpeed) / 10_000) / 2);
  const bitrate = Math.min(1, (hit.bitrate ?? 128) / 320);
  return 0.45 * slot + 0.25 * queue + 0.2 * speed + 0.1 * bitrate;
}

/** Kept for compatibility: text match plus small quality nudges. */
export function scoreHit(query: string, hit: SearchHit): number {
  let score = matchScore(query, hit);

  if (score <= 0) {
    return 0;
  }

  if (hit.slotFree) {
    score += 0.02;
  }

  if ((hit.bitrate ?? 0) >= 320) {
    score += 0.03;
  } else if ((hit.bitrate ?? 0) >= 192) {
    score += 0.01;
  }

  return Math.min(1, score);
}

export interface RankedHit {
  hit: SearchHit;
  /** Text match, see `matchScore`. */
  score: number;
  /** Combined order used to choose and fall back between sources. */
  rank: number;
}

/**
 * Ranks the hits that match the query well enough, best source first.
 * Text match dominates; among close matches, sources that can start right
 * away win.
 */
export function rankHits(
  query: string,
  hits: SearchHit[],
  minScore = AUTO_MATCH_SCORE,
  maxCandidates = 400,
): RankedHit[] {
  const ranked: RankedHit[] = [];
  const limit = Math.min(hits.length, maxCandidates);

  for (let index = 0; index < limit; index++) {
    const hit = hits[index];
    const score = matchScore(query, hit);

    if (score < minScore) {
      continue;
    }

    // Matches within ~0.05 of each other are treated as the same track, so
    // availability decides between them.
    ranked.push({ hit, score, rank: score + 0.12 * availabilityScore(hit) });
  }

  ranked.sort((a, b) => b.rank - a.rank);
  return ranked;
}

/** Returns the best source above `minScore`, or null. */
export function pickBestMatch(
  query: string,
  hits: SearchHit[],
  minScore = AUTO_MATCH_SCORE,
  maxCandidates = 400,
): RankedHit | null {
  return rankHits(query, hits, minScore, maxCandidates)[0] ?? null;
}
