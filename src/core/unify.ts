import type { CatalogTrack, TrackGroup } from './catalogTypes';
import { availabilityScore, formatSearchQuery, hitFeatures, matchScore, normalizeForMatch, rankHits } from './search';
import type { RankedHit } from './search';
import { hitKey, parseTrackName } from './types';
import type { SearchHit } from './types';

/**
 * Matching Soulseek files to catalog tracks, so one song is one result with
 * many sources instead of many differently-spelled files.
 *
 * Signals, strongest first:
 * - length: the album version (5:20) and the radio edit (3:55) of a song have
 *   the same words but not the same duration;
 * - artist and title words (the existing `matchScore`, which also reads the
 *   artist from folder names and penalises "live", "remix"... the catalog
 *   track does not have);
 * - the version words of the catalog track ("Radio Edit", "Remix").
 */

/** A file needs at least this to count as a source of a catalog track. */
export const UNIFY_SCORE = 0.72;
/** How many catalog tracks a search shows and matches against. */
export const MAX_CATALOG_TRACKS = 10;
/** Catalog tracks shown even before any Soulseek source is found. */
const ALWAYS_SHOWN = 5;
const MAX_HITS = 400;

/**
 * Version words that leave the recording the same for a listener: a file
 * named without "Remastered 2011" or "Mono" is still that track. A version
 * part made only of these (and years) is neutral.
 */
const NEUTRAL_WORDS =
  /\b(?:re-?master(?:ed|isé|ise|izado)?|digital(?:ly)?|deluxe|expanded|anniversary|edition|explicit|clean|mono|stereo|bonus|track|version|original|album|single|lp|mix|the|and|of|(?:19|20)\d{2}|\d+(?:st|nd|rd|th))\b/gi;

/** Words that make a bracket or a " - " part a version, not part of the title. */
const VERSION_WORDS =
  /\b(?:live|remix|mix|edit|acoustic|instrumental|demo|version|unplugged|session|take \d+|dub|extended|rework|karaoke|re-?master\w*|mono|stereo|(?:19|20)\d{2})\b/i;

/** Brackets that are neither title nor version: guests, "from the film...". */
const DROPPED_BRACKET = /^\s*(?:feat|ft|featuring|with|avec|from)\b|soundtrack|bande originale/i;

/** Kinds of version that are another recording, worth a word in the query. */
const VERSION_KINDS = /\b(?:remix|live|acoustic|instrumental)\b/g;

/** Sent as `-word` for a version that is none of these. */
const EXCLUDED_KINDS = ['live', 'karaoke', 'instrumental', 'remix'];

/** Longer titles keep their most distinctive words: each word can miss files. */
const MAX_QUERY_TITLE_WORDS = 4;

function isNeutralPart(part: string): boolean {
  return !/\p{L}/u.test(part.replace(NEUTRAL_WORDS, ' '));
}

function isVersionPart(part: string): boolean {
  return isNeutralPart(part) || VERSION_WORDS.test(part);
}

/** "Live 1972; Remaster" → ["Live 1972", "Remaster"]. */
function splitVersion(version: string): string[] {
  return version
    .split(/[;,/]|\s[-–—]\s/)
    .map(part => part.replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(part => part.length > 0);
}

export interface TitleParts {
  /** The title without versions or guests: "Don't Stop Me Now". */
  base: string;
  /** Each version part, as written: ["Live 1972", "Remaster"]. */
  versions: string[];
}

/**
 * Splits a title written by the catalog into the song's name and its
 * versions. Deezer puts versions in brackets ("(Remastered 2011)") or after a
 * dash ("- Remastered 2011", "- Live"); brackets that are part of the name
 * ("(Don't Fear) The Reaper") are kept, without the brackets.
 */
export function splitTitle(text: string): TitleParts {
  const versions: string[] = [];

  let rest = text.replace(/[([{]([^)\]}]*)[)\]}]/g, (_match, inside: string) => {
    if (DROPPED_BRACKET.test(inside)) {
      return ' ';
    }
    if (isVersionPart(inside)) {
      versions.push(...splitVersion(inside));
      return ' ';
    }
    return ` ${inside} `;
  });

  const dashParts = rest.split(/\s+[-–—]\s+/);
  const trailing: string[] = [];
  while (dashParts.length > 1 && isVersionPart(dashParts[dashParts.length - 1])) {
    trailing.unshift(...splitVersion(dashParts.pop() ?? ''));
  }
  rest = dashParts.join(' - ');

  const base = rest.replace(/\s+/g, ' ').trim();
  return { base: base || text.trim(), versions: [...versions, ...trailing] };
}

const partsCache = new WeakMap<CatalogTrack, TitleParts>();

/** Name and version parts of a catalog track, from its title and version fields. */
export function trackTitleParts(track: CatalogTrack): TitleParts {
  let parts = partsCache.get(track);
  if (!parts) {
    const fromTitle = splitTitle(track.titleShort);
    const seen = new Set(fromTitle.versions.map(part => normalizeForMatch(part)));
    const extra = splitVersion(track.version).filter(part => {
      const key = normalizeForMatch(part);
      const fresh = !seen.has(key);
      seen.add(key);
      return fresh;
    });
    parts = { base: fromTitle.base, versions: [...fromTitle.versions, ...extra] };
    partsCache.set(track, parts);
  }
  return parts;
}

/**
 * Version words worth matching ("Radio Edit", "Live"), judged part by part:
 * "Live 1972; Remaster" is "Live", not neutral as a whole.
 */
export function meaningfulVersion(track: CatalogTrack): string {
  const kept = trackTitleParts(track)
    .versions.filter(part => !isNeutralPart(part))
    .map(part =>
      part
        .replace(/\b(?:re-?master(?:ed|isé|ise|izado)?|(?:19|20)\d{2}|\d+(?:st|nd|rd|th))\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(part => part.length > 0);
  return Array.from(new Set(kept)).join(' ');
}

function durationAdjustment(hit: SearchHit, track: CatalogTrack): number {
  if (!hit.durationSec || hit.durationSec <= 0 || !track.durationSec) {
    return 0;
  }

  const diff = Math.abs(hit.durationSec - track.durationSec);

  if (diff <= 3) {
    return 0.08;
  }
  if (diff <= 8) {
    return 0;
  }
  if (diff <= 30) {
    return -0.25;
  }
  return -0.5;
}

const titleWordCache = new WeakMap<CatalogTrack, string[]>();

/**
 * Starts of the title's words (3 letters, or whole numbers), as they appear
 * after a space in a normalised path. Prefixes keep typo and plural
 * tolerance ("tim" finds "time"), like the matcher itself.
 */
function titleWordStarts(track: CatalogTrack): string[] {
  let starts = titleWordCache.get(track);
  if (!starts) {
    starts = normalizeForMatch(track.titleShort)
      .split(' ')
      .filter(word => word.length >= 3 || /^\d+$/.test(word))
      .map(word => ` ${word.slice(0, 3)}`);
    titleWordCache.set(track, starts);
  }
  return starts;
}

function mentionsTitle(haystack: string, track: CatalogTrack): boolean {
  const starts = titleWordStarts(track);
  // Titles made only of short words ("U", "Go") are not filtered.
  return starts.length === 0 || starts.some(start => haystack.includes(start));
}

/**
 * How likely a Soulseek file is this catalog track, in [0, 1].
 */
export function matchHitToTrack(hit: SearchHit, track: CatalogTrack): number {
  // Cheap pre-check: a file that mentions no word of the title cannot match.
  // Most file/track pairs of a search stop here, before any Levenshtein.
  if (!mentionsTitle(hitFeatures(hit).haystack, track)) {
    return 0;
  }

  const version = meaningfulVersion(track);
  const title = `${trackTitleParts(track).base} ${version}`.trim();
  const full = matchScore(`${track.artist.name} ${title}`, hit);

  // Many files carry only the title ("Music/One More Time.mp3"). Accept them
  // when the title matches well, mostly on the strength of the duration.
  let score = full;
  const titleOnly = matchScore(title, hit);
  const parsedArtist = parseTrackName(hit.filename).artist;
  const artistMissing =
    !parsedArtist || !hitFeatures(hit).haystack.includes(normalizeForMatch(track.artist.name));

  if (artistMissing && titleOnly >= 0.9) {
    const confirmed = durationAdjustment(hit, track) > 0;
    score = Math.max(score, titleOnly - (confirmed ? 0.12 : 0.3));
  }

  return Math.max(0, Math.min(1, score + durationAdjustment(hit, track)));
}

function rankFor(score: number, hit: SearchHit): number {
  return score + 0.12 * availabilityScore(hit);
}

/** Soulseek sources of one catalog track among `hits`, best first. */
export function sourcesForTrack(track: CatalogTrack, hits: SearchHit[]): RankedHit[] {
  const ranked: RankedHit[] = [];

  for (const hit of hits.slice(0, MAX_HITS)) {
    const score = matchHitToTrack(hit, track);
    if (score >= UNIFY_SCORE) {
      ranked.push({ hit, score, rank: rankFor(score, hit) });
    }
  }

  return ranked.sort((a, b) => b.rank - a.rank);
}

/** Words dropped first when a name has too many. */
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'le', 'la', 'les', 'de', 'des', 'du', 'et']);

/** Query words of a name; past `max`, stop words go first, then the shortest. */
function queryWords(text: string, max = Infinity): string[] {
  const words = formatSearchQuery(text).split(' ').filter(word => word.length > 0);
  if (words.length <= max) {
    return words;
  }
  const entries = words.map((word, index) => ({ word, index }));
  const content = entries.filter(entry => !STOP_WORDS.has(entry.word.toLowerCase()));
  const kept = new Set(
    (content.length > 0 ? content : entries)
      .sort((a, b) => b.word.length - a.word.length || a.index - b.index)
      .slice(0, max)
      .map(entry => entry.index),
  );
  return words.filter((_word, index) => kept.has(index));
}

/** "The Beatles" → "beatles": many folders are named without "The". */
function artistWords(name: string): string[] {
  const words = queryWords(name);
  return words.length > 1 && words[0].toLowerCase() === 'the' ? words.slice(1) : words;
}

/** Title words of a track for a query; empty when the title is one letter ("A"). */
function titleWords(track: CatalogTrack): string[] {
  const words = queryWords(trackTitleParts(track).base, MAX_QUERY_TITLE_WORDS);
  return words.some(word => normalizeForMatch(word).length >= 2) ? words : [];
}

/** Only the kind of version, never its details: "(Kygo Remix)" → "remix". */
function versionKinds(track: CatalogTrack): string[] {
  return Array.from(new Set(meaningfulVersion(track).toLowerCase().match(VERSION_KINDS) ?? []));
}

/**
 * What to type on Soulseek to find a catalog track. Peers return a file only
 * when every word is a whole word of its path, so keep it to the artist and
 * the title's distinctive words (plus a real kind of version such as
 * "remix"); album names, years, "feat." and "Remastered" would lose files.
 */
export function soulseekQueryFor(track: CatalogTrack): string {
  const title = titleWords(track);
  const words = [...artistWords(track.artist.name), ...(title.length > 0 ? title : queryWords(track.titleShort))];
  return [...words, ...versionKinds(track)].join(' ');
}

export type SoulseekStepKind = 'artist-title' | 'title' | 'artist-album';

export interface SoulseekStep {
  kind: SoulseekStepKind;
  query: string;
}

function sameQueryWords(a: string, b: string): boolean {
  const key = (value: string) => normalizeForMatch(value).split(' ').sort().join(' ');
  return key(a) === key(b);
}

/**
 * `-live -karaoke...` for the kinds of version the track is not, so peers do
 * not send them: fewer junk files to parse, better first answers. A word
 * already in the artist, title, version or album is never excluded.
 */
function exclusions(track: CatalogTrack): string[] {
  const own = new Set(
    normalizeForMatch(
      `${track.artist.name} ${track.titleShort} ${track.version} ${track.album?.title ?? ''}`,
    ).split(' '),
  );
  return EXCLUDED_KINDS.filter(word => !own.has(word)).map(word => `-${word}`);
}

/**
 * Soulseek queries for one catalog track, tried in order until one finds a
 * source:
 * 1. artist + title (the usual file name);
 * 2. title only, when it is distinctive: many files carry no artist;
 * 3. artist + album: albums are shared as folders, so the file can be found
 *    there even when its own name is spelled differently.
 * A one-letter title ("A") skips the first two: the artist alone would bring
 * back every file of the artist.
 */
export function soulseekLadder(track: CatalogTrack): SoulseekStep[] {
  const artist = artistWords(track.artist.name);
  const title = titleWords(track);
  const kinds = versionKinds(track);
  const excluded = exclusions(track);
  const steps: SoulseekStep[] = [];

  const add = (kind: SoulseekStepKind, words: string[]) => {
    const plain = words.join(' ');
    if (!words.some(word => normalizeForMatch(word).length >= 2)) {
      return;
    }
    if (steps.some(step => sameQueryWords(step.query.replace(/(^| )-\S+/g, ' '), plain))) {
      return;
    }
    steps.push({ kind, query: [...words, ...excluded].join(' ') });
  };

  if (title.length > 0) {
    add('artist-title', [...artist, ...title, ...kinds]);
    const distinctive = title.length >= 2 || normalizeForMatch(title.join(' ')).length >= 6;
    if (distinctive) {
      add('title', [...title, ...kinds]);
    }
  }

  const album = track.album ? queryWords(splitTitle(track.album.title).base, MAX_QUERY_TITLE_WORDS) : [];
  // A self-titled album ("Moby" by Moby) would search the artist alone.
  const artistKeys = new Set(artist.map(word => normalizeForMatch(word)));
  if (artist.length > 0 && album.some(word => !artistKeys.has(normalizeForMatch(word)))) {
    add('artist-album', [...artist, ...album]);
  }

  return steps;
}

function scoreKey(track: CatalogTrack, key: string): string {
  return `${track.id}\u0000${key}`;
}

/**
 * Scores one file against the query and the catalog tracks, into the caches
 * `unifyResults` and `rankHits` read. Lets a search spread that work over
 * many small slices instead of one long block on the JS thread.
 */
export function primeHitScores(
  query: string,
  hit: SearchHit,
  catalogTracks: CatalogTrack[],
  scores: Map<string, number>,
): void {
  matchScore(query, hit);
  const key = hitKey(hit);

  for (const track of catalogTracks.slice(0, MAX_CATALOG_TRACKS)) {
    const cacheKey = scoreKey(track, key);
    if (!scores.has(cacheKey)) {
      scores.set(cacheKey, matchHitToTrack(hit, track));
    }
  }
}

export interface UnifiedResults {
  groups: TrackGroup[];
  /** Catalog track of each matched file, by `hitKey`. */
  hitTracks: Record<string, CatalogTrack>;
}

/**
 * Builds the search result cards: catalog tracks with their sources, then the
 * remaining files grouped by artist, title and length.
 */
export function unifyResults(
  query: string,
  hits: SearchHit[],
  catalogTracks: CatalogTrack[],
  minListScore: number,
  /**
   * Scores already computed during this search, by track id and hit key.
   * Results arrive in batches and are regrouped each time: with the cache,
   * only the new files are scored.
   */
  scores?: Map<string, number>,
): UnifiedResults {
  const tracks = catalogTracks.slice(0, MAX_CATALOG_TRACKS);
  const byTrack = new Map<string, RankedHit[]>(tracks.map(track => [track.id, []]));
  const hitTracks: Record<string, CatalogTrack> = {};
  const unmatched: SearchHit[] = [];

  for (const hit of hits.slice(0, MAX_HITS)) {
    let best: { track: CatalogTrack; score: number } | null = null;

    const key = hitKey(hit);
    for (const track of tracks) {
      const cacheKey = scoreKey(track, key);
      let score = scores?.get(cacheKey);
      if (score === undefined) {
        score = matchHitToTrack(hit, track);
        scores?.set(cacheKey, score);
      }
      if (score >= UNIFY_SCORE && (!best || score > best.score)) {
        best = { track, score };
      }
    }

    if (best) {
      byTrack.get(best.track.id)?.push({ hit, score: best.score, rank: rankFor(best.score, hit) });
      hitTracks[hitKey(hit)] = best.track;
    } else {
      unmatched.push(hit);
    }
  }

  const catalogGroups: TrackGroup[] = tracks.map(track => ({
    id: track.id,
    track,
    title: track.title,
    artist: track.artist.name,
    sources: (byTrack.get(track.id) ?? []).sort((a, b) => b.rank - a.rank),
  }));

  // The catalog's first answer is what the query most likely means: keep it
  // first. Then tracks that can play now, then the next few without sources.
  const [first, ...rest] = catalogGroups;
  const ordered = first
    ? [
        first,
        ...rest.filter(group => group.sources.length > 0),
        ...rest.filter((group, index) => group.sources.length === 0 && index + 1 < ALWAYS_SHOWN),
      ]
    : [];

  return { groups: [...ordered, ...groupUnmatched(query, unmatched, minListScore)], hitTracks };
}

/** Same song from several peers, without a catalog track: one card. */
export function groupUnmatched(query: string, hits: SearchHit[], minScore: number): TrackGroup[] {
  const groups = new Map<string, TrackGroup>();

  for (const ranked of rankHits(query, hits, minScore)) {
    const { artist, title } = parseTrackName(ranked.hit.filename);
    const length = ranked.hit.durationSec ? Math.round(ranked.hit.durationSec / 5) : '';
    const key = `${normalizeForMatch(artist ?? '')}|${normalizeForMatch(title)}|${length}`;
    const group = groups.get(key);

    if (group) {
      group.sources.push(ranked);
    } else {
      groups.set(key, { id: `local:${key}`, track: null, title, artist, sources: [ranked] });
    }
  }

  // `rankHits` is sorted, so each group's sources and the groups are too.
  return Array.from(groups.values());
}
