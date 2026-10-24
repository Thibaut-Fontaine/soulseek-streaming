import type { CatalogTrack, TrackGroup } from './catalogTypes';
import { availabilityScore, formatSearchQuery, matchScore, normalizeForMatch, rankHits } from './search';
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
 * Versions that are the same recording for a listener: a file named without
 * "Remastered 2011" is still that track.
 */
const NEUTRAL_VERSION =
  /remaster|deluxe|edition|expanded|anniversary|explicit|clean|mono|stereo|album version|original version|original mix|\b(19|20)\d{2}\b/i;

/** Version words worth matching ("Radio Edit", "Live", "Remix"). */
export function meaningfulVersion(track: CatalogTrack): string {
  const version = track.version.replace(/[()[\]]/g, ' ').trim();
  return version && !NEUTRAL_VERSION.test(version) ? version : '';
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

/**
 * How likely a Soulseek file is this catalog track, in [0, 1].
 */
export function matchHitToTrack(hit: SearchHit, track: CatalogTrack): number {
  const version = meaningfulVersion(track);
  const title = `${track.titleShort} ${version}`.trim();
  const full = matchScore(`${track.artist.name} ${title}`, hit);

  // Many files carry only the title ("Music/One More Time.mp3"). Accept them
  // when the title matches well, mostly on the strength of the duration.
  let score = full;
  const titleOnly = matchScore(title, hit);
  const parsedArtist = parseTrackName(hit.filename).artist;
  const artistMissing =
    !parsedArtist || !normalizeForMatch(hit.filename).includes(normalizeForMatch(track.artist.name));

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

/**
 * What to type on Soulseek to find a catalog track. Peers return a file only
 * when every word is in its path, so keep it to artist and title (plus a real
 * kind of version such as "remix"); album names and "feat." would lose files.
 */
export function soulseekQueryFor(track: CatalogTrack): string {
  // Only the kind of version, never its details: "(Kygo Remix)" → "remix",
  // "(Short Radio Edit)" → nothing, the length tells edits apart.
  const keepVersion = (meaningfulVersion(track).toLowerCase().match(/\b(remix|live|acoustic|instrumental)\b/g) ?? []).join(' ');
  const title = track.titleShort.replace(/\s*[([].*?[)\]]\s*/g, ' ').trim() || track.titleShort;
  return formatSearchQuery(`${track.artist.name} ${title} ${keepVersion}`);
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
): UnifiedResults {
  const tracks = catalogTracks.slice(0, MAX_CATALOG_TRACKS);
  const byTrack = new Map<string, RankedHit[]>(tracks.map(track => [track.id, []]));
  const hitTracks: Record<string, CatalogTrack> = {};
  const unmatched: SearchHit[] = [];

  for (const hit of hits.slice(0, MAX_HITS)) {
    let best: { track: CatalogTrack; score: number } | null = null;

    for (const track of tracks) {
      const score = matchHitToTrack(hit, track);
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
