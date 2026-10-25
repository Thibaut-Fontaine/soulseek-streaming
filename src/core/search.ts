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

/**
 * "feat.", "ft." and "featuring" are written in many ways (or left out) by
 * different uploaders, so they never count as words to match.
 */
const FEATURING = /\b(feat|ft|featuring)\b/g;

/** Normalised form used by the matcher (lowercase, no accents/punctuation). */
export function normalizeForMatch(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(FEATURING, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats a raw user query before it is sent to the Soulseek network.
 *
 * Peers return a file only if every word of the query appears in its path,
 * so the query keeps the meaningful words and drops everything that could
 * miss or exclude a file:
 * - noise ("official video", bitrates, bracketed tags);
 * - dashes: a word starting with "-" means "exclude" on Soulseek, and a lone
 *   "-" can exclude every file on some clients;
 * - "feat." / "ft." / "featuring", written differently by each uploader;
 * - apostrophes and one-letter leftovers ("l'amour" → "amour").
 * Accents are kept: file names usually carry them.
 */
export function formatSearchQuery(raw: string): string {
  let value = raw.trim().normalize('NFC');

  value = value.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');

  for (const pattern of NOISE_PATTERNS) {
    value = value.replace(pattern, ' ');
  }

  const words = value
    .replace(/[_/|\\,;:!?"“”«»&+]+/g, ' ')
    .replace(/['’`]/g, ' ')
    .split(/\s+/)
    .map(word => word.replace(/^[-–—.]+|[-–—.]+$/g, ''))
    .filter(word => word.length > 0)
    .filter(word => !/^(feat|ft|featuring)$/i.test(word))
    .filter((word, index, all) => word.length > 1 || all.length === 1 || /\d/.test(word));

  const cleaned = words.join(' ');
  return cleaned.length >= 2 ? cleaned : raw.trim();
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

/** One way of reading a file path (title, artist + title, folder + title...). */
interface CandidateText {
  tokens: string[];
  /** Same, without track numbers / years (used when the query has no number). */
  tokensNoNumbers: string[];
  sorted: string;
  sortedNoNumbers: string;
}

/** Everything `matchScore` needs from a hit, computed once per hit. */
interface HitFeatures {
  candidates: CandidateText[];
  /** Words of the file name, for the version-marker penalty. */
  fileWords: Set<string>;
  /** Whole path, normalised: a cheap "does it mention this word" check. */
  haystack: string;
}

interface QueryFeatures {
  tokens: string[];
  sorted: string;
  words: Set<string>;
  hasNumber: boolean;
}

// Searches score the same hits against the same queries many times while
// results arrive (and once per catalog track): keep the parsed forms around.
const hitFeatureCache = new WeakMap<SearchHit, HitFeatures>();
const queryFeatureCache = new Map<string, QueryFeatures | null>();
/** Scores already computed, per hit then per query. */
const scoreCache = new WeakMap<SearchHit, Map<string, number>>();
const QUERY_CACHE_SIZE = 64;

function candidateText(normalized: string): CandidateText {
  const tokens = normalized.split(' ').filter(token => token.length > 0);
  const tokensNoNumbers = tokens.filter(token => !isNumeric(token));
  return {
    tokens,
    tokensNoNumbers,
    sorted: [...tokens].sort().join(' '),
    sortedNoNumbers: [...tokensNoNumbers].sort().join(' '),
  };
}

export function hitFeatures(hit: SearchHit): HitFeatures {
  const cached = hitFeatureCache.get(hit);
  if (cached) {
    return cached;
  }

  const { artist, title } = parseTrackName(hit.filename);
  // The artist is often only in a folder name ("Artist/Album/01 Title.mp3",
  // "Artist - Album (2001)/01 Title.mp3"), so the two parent folders are
  // tried with the title too.
  const folders = hit.filename.replace(/\\/g, '/').split('/').filter(Boolean).slice(-3, -1);
  const variants = new Set(
    [
      normalizeForMatch(title),
      artist ? normalizeForMatch(`${artist} ${title}`) : '',
      normalizeForMatch(baseName(hit.filename).replace(/\.[^.]+$/, '')),
      ...folders.map(folder => normalizeForMatch(`${folder} ${title}`)),
    ].filter(Boolean),
  );

  const features: HitFeatures = {
    candidates: Array.from(variants, candidateText),
    fileWords: new Set(normalizeForMatch(baseName(hit.filename)).split(' ').filter(Boolean)),
    haystack: ` ${normalizeForMatch(hit.filename)} `,
  };
  hitFeatureCache.set(hit, features);
  return features;
}

function queryFeatures(query: string): QueryFeatures | null {
  if (queryFeatureCache.has(query)) {
    return queryFeatureCache.get(query) ?? null;
  }

  const normalized = normalizeForMatch(query);
  const tokens = normalized.split(' ').filter(Boolean);
  const features = tokens.length
    ? { tokens, sorted: sortTokens(normalized), words: new Set(tokens), hasNumber: tokens.some(isNumeric) }
    : null;

  if (queryFeatureCache.size >= QUERY_CACHE_SIZE) {
    const oldest = queryFeatureCache.keys().next().value;
    if (oldest !== undefined) {
      queryFeatureCache.delete(oldest);
    }
  }
  queryFeatureCache.set(query, features);
  return features;
}

/**
 * Text match between the query and one candidate string, in [0, 1].
 * Combines how much of the query is found (coverage), how much of the
 * candidate is explained by the query (precision, so extra words cost), and an
 * order-insensitive Levenshtein similarity for typos.
 */
function matchCandidate(query: QueryFeatures, candidate: CandidateText): number {
  // Track numbers and years the user did not type are noise, not extra words.
  const candidateTokens = query.hasNumber ? candidate.tokens : candidate.tokensNoNumbers;

  if (candidateTokens.length === 0) {
    return 0;
  }

  const used = new Array<boolean>(candidateTokens.length).fill(false);
  let matched = 0;

  for (const token of query.tokens) {
    const index = candidateTokens.findIndex(
      (candidateToken, i) => !used[i] && tokensMatch(token, candidateToken),
    );

    if (index >= 0) {
      used[index] = true;
      matched++;
    }
  }

  const coverage = matched / query.tokens.length;
  const precision = matched / candidateTokens.length;

  // Nothing in common: the typo term (weight 0.15) cannot make it a match.
  if (matched === 0) {
    return 0;
  }

  const sortedCandidate = query.hasNumber ? candidate.sorted : candidate.sortedNoNumbers;
  const maxLength = Math.max(query.sorted.length, sortedCandidate.length);
  const fuzzy = maxLength > 0 ? 1 - levenshtein(query.sorted, sortedCandidate) / maxLength : 0;

  return 0.6 * coverage + 0.25 * precision + 0.15 * fuzzy;
}

/**
 * How well a hit matches the query text, in [0, 1]. Quality and availability
 * are handled separately by `rankHits`.
 */
export function matchScore(query: string, hit: SearchHit): number {
  let scores = scoreCache.get(hit);
  const cached = scores?.get(query);
  if (cached !== undefined) {
    return cached;
  }

  const score = computeMatchScore(query, hit);
  if (!scores) {
    scores = new Map();
    scoreCache.set(hit, scores);
  }
  scores.set(query, score);
  return score;
}

function computeMatchScore(query: string, hit: SearchHit): number {
  const q = queryFeatures(query);

  if (!q) {
    return 0;
  }

  const features = hitFeatures(hit);
  let best = 0;

  for (const candidate of features.candidates) {
    best = Math.max(best, matchCandidate(q, candidate));
  }

  // Penalise version markers found in the file name but not in the query.
  let penalty = 0;

  for (const word of features.fileWords) {
    if (VERSION_WORDS.has(word) && !q.words.has(word)) {
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
