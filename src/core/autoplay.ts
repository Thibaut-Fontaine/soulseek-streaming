import type { CatalogProvider } from './catalog';
import type { CatalogArtist, CatalogTrack } from './catalogTypes';
import { normalizeForMatch } from './search';

/**
 * Recommendations played when a catalog list ends (feature 5).
 *
 * Sources are the artist "radio" of the last track, then the radios of its
 * related artists. A caller passes what it already played; the function never
 * repeats a track or recording and stops at a bound, so autoplay can end
 * cleanly instead of searching Soulseek forever.
 */

export type RecommendationReason = 'ok' | 'empty' | 'error';

export interface RecommendationResult {
  tracks: CatalogTrack[];
  reason: RecommendationReason;
}

export interface RecommendationOptions {
  /** Tracks wanted. Default 8. */
  limit?: number;
  /** Related artists whose radio is tried. Default 4. */
  maxRelatedArtists?: number;
}

type RecommendationSource = Pick<CatalogProvider, 'artistRadio' | 'artistWithRelated'>;

/** One recording, even when it appears on another album or artist id. */
export function recommendationKey(track: CatalogTrack): string {
  return `${track.artist.id}\u0000${normalizeForMatch(track.titleShort || track.title)}`;
}

export async function recommendTracks(
  provider: RecommendationSource,
  seed: CatalogTrack,
  excluded: ReadonlySet<string>,
  options: RecommendationOptions = {},
): Promise<RecommendationResult> {
  const limit = Math.max(1, Math.min(25, options.limit ?? 8));
  const maxRelatedArtists = Math.max(0, options.maxRelatedArtists ?? 4);
  const keys = new Set(excluded);
  const ids = new Set<string>([seed.id]);
  keys.add(recommendationKey(seed));
  const tracks: CatalogTrack[] = [];
  let hadError = false;

  const add = (candidates: CatalogTrack[]): void => {
    for (const candidate of candidates) {
      if (tracks.length >= limit) {
        return;
      }
      // Very short files are previews; never chain them automatically.
      if (!candidate.id || candidate.durationSec > 0 && candidate.durationSec < 45) {
        continue;
      }
      const key = recommendationKey(candidate);
      if (ids.has(candidate.id) || keys.has(key)) {
        continue;
      }
      ids.add(candidate.id);
      keys.add(key);
      tracks.push(candidate);
    }
  };

  if (!seed.artist.id) {
    return { tracks: [], reason: 'empty' };
  }

  try {
    add(await provider.artistRadio(seed.artist.id));
  } catch {
    hadError = true;
  }

  if (tracks.length < limit) {
    let related: CatalogArtist[];
    try {
      related = (await provider.artistWithRelated(seed.artist.id)).related;
    } catch {
      hadError = true;
      related = [];
    }

    for (const artist of related.slice(0, maxRelatedArtists)) {
      if (tracks.length >= limit) {
        break;
      }
      if (!artist.id) {
        continue;
      }
      try {
        add(await provider.artistRadio(artist.id));
      } catch {
        hadError = true;
      }
    }
  }

  if (tracks.length > 0) {
    return { tracks, reason: 'ok' };
  }
  return { tracks: [], reason: hadError ? 'error' : 'empty' };
}
