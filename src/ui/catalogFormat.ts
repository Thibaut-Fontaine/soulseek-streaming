/**
 * Pure helpers for the catalog screens (artist, album, home and the
 * catalog search results): labels, grouping and artwork choice. No React here
 * so they are cheap to unit test.
 */
import type {
  AlbumKind,
  Artwork,
  CatalogAlbum,
  CatalogArtist,
  CatalogPlayContext,
  CatalogSearchResult,
  CatalogTrack,
  TrackGroup,
} from '../core/catalogTypes';
import { normalizeForMatch } from '../core/search';

/** Narrow no-break space, the French thousands separator. */
const THIN = ' ';

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0';
  }
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** "1 234 567 fans", "1 fan". */
export function formatFans(fans?: number): string | null {
  if (fans === undefined || !Number.isFinite(fans) || fans < 0) {
    return null;
  }
  return `${formatCount(fans)} fan${fans > 1 ? 's' : ''}`;
}

export function albumYear(album: Pick<CatalogAlbum, 'releaseDate'>): string | null {
  const match = album.releaseDate ? /^(\d{4})/.exec(album.releaseDate) : null;
  return match ? match[1] : null;
}

const KIND_LABELS: Record<AlbumKind, string> = {
  album: 'Album',
  single: 'Single',
  ep: 'EP',
  compile: 'Compilation',
};

export function albumKindLabel(kind: AlbumKind): string {
  return KIND_LABELS[kind] ?? 'Album';
}

/** "42 min", "1 h 01 min" — for album totals. */
export function formatTotalDuration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${Math.max(1, minutes)} min`;
  }
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** "12 mars 2001" from an ISO date; the year alone when that is all we have. */
export function formatReleaseDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(iso);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const monthName = month ? MONTHS[Number(month) - 1] : undefined;
  if (!monthName) {
    return year;
  }
  return day ? `${Number(day)} ${monthName} ${year}` : `${monthName} ${year}`;
}

/** "2001 · Album · 14 titres · 1 h 01 min" under an album title. */
export function albumMetaLine(album: CatalogAlbum, tracks: CatalogTrack[] = []): string {
  const count = album.trackCount ?? (tracks.length || undefined);
  const total = album.durationSec ?? tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0);
  return [
    albumYear(album),
    albumKindLabel(album.kind),
    count ? `${count} titre${count > 1 ? 's' : ''}` : null,
    formatTotalDuration(total),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "2001 · Single" under an album card. */
export function albumCardSubtitle(album: CatalogAlbum, withArtist = false): string {
  return [withArtist ? album.artist.name : albumYear(album), albumKindLabel(album.kind)].filter(Boolean).join(' · ');
}

/** Artist line of a track: main artist, then featured artists. */
export function trackArtists(track: CatalogTrack): string {
  const names = [track.artist.name];
  for (const contributor of track.contributors) {
    if (!names.includes(contributor.name)) {
      names.push(contributor.name);
    }
  }
  return names.join(', ');
}

/** Albums (and compilations) vs. singles and EPs, order kept. */
export function splitDiscography(albums: CatalogAlbum[]): {
  albums: CatalogAlbum[];
  singles: CatalogAlbum[];
} {
  return {
    albums: albums.filter(album => album.kind === 'album' || album.kind === 'compile'),
    singles: albums.filter(album => album.kind === 'single' || album.kind === 'ep'),
  };
}

export interface DiscSection {
  disc: number;
  tracks: CatalogTrack[];
}

/**
 * Album tracks per disc, in track order. One section (disc 1) when the album
 * has a single disc or the provider gave no disc numbers.
 */
export function discSections(tracks: CatalogTrack[]): DiscSection[] {
  const byDisc = new Map<number, CatalogTrack[]>();
  for (const track of tracks) {
    const disc = track.discNumber ?? 1;
    const list = byDisc.get(disc) ?? [];
    list.push(track);
    byDisc.set(disc, list);
  }
  return [...byDisc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([disc, list]) => ({
      disc,
      tracks: list.some(track => track.trackNumber !== undefined)
        ? [...list].sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
        : list,
    }));
}

/**
 * The URL to load for a square of `px` device pixels: the smallest size that
 * is big enough, else the closest one we have.
 */
export function pickArtwork(artwork: Artwork | null | undefined, px: number): string | null {
  if (!artwork) {
    return null;
  }
  // 1000 px covers decode to 4 MB each: keep them for the player and the
  // artist picture, and use 500 px for shelf tiles and the album cover.
  const order: Array<keyof Artwork> =
    px <= 64
      ? ['small', 'medium', 'big', 'large']
      : px <= 300
        ? ['medium', 'big', 'large', 'small']
        : px <= 600
          ? ['big', 'large', 'medium', 'small']
          : ['large', 'big', 'medium', 'small'];
  for (const key of order) {
    if (artwork[key]) {
      return artwork[key];
    }
  }
  return null;
}

export function catalogContext(label: string, tracks: CatalogTrack[], track: CatalogTrack): CatalogPlayContext {
  return {
    label,
    tracks,
    index: Math.max(
      0,
      tracks.findIndex(item => item.id === track.id),
    ),
  };
}

/** A random starting point for "Lecture aléatoire". */
export function shuffleStart(tracks: CatalogTrack[], random: () => number = Math.random): number {
  return tracks.length > 0 ? Math.floor(random() * tracks.length) % tracks.length : 0;
}

export type BestResult =
  | { kind: 'artist'; artist: CatalogArtist }
  | { kind: 'track'; track: CatalogTrack; group: TrackGroup | null }
  | null;

/**
 * "Meilleur résultat": the artist when the query is (about) the artist's
 * name, else the top track, else the top artist.
 */
export function bestCatalogResult(
  query: string,
  catalog: CatalogSearchResult | null,
  groups: TrackGroup[],
): BestResult {
  if (!catalog) {
    return null;
  }
  const wanted = normalizeForMatch(query);
  const artist = catalog.artists[0];
  const groupFor = (track: CatalogTrack) => groups.find(group => group.track?.id === track.id) ?? null;
  const topTrack = groups.find(group => group.track)?.track ?? catalog.tracks[0];

  if (artist && wanted && normalizeForMatch(artist.name) === wanted) {
    return { kind: 'artist', artist };
  }
  if (topTrack) {
    return { kind: 'track', track: topTrack, group: groupFor(topTrack) };
  }
  return artist ? { kind: 'artist', artist } : null;
}

/**
 * Catalog track cards for the "Titres" section. Uses `groups` when the
 * matcher filled them; before the first Soulseek answer, shows the catalog
 * tracks with no sources yet so the list is not empty.
 */
export function catalogTrackGroups(catalog: CatalogSearchResult | null, groups: TrackGroup[]): TrackGroup[] {
  const matched = groups.filter(group => group.track !== null);
  if (matched.length > 0 || !catalog) {
    return matched;
  }
  return catalog.tracks.map(track => ({
    id: track.id,
    track,
    title: track.title,
    artist: track.artist.name,
    sources: [],
  }));
}

export function otherFileGroups(groups: TrackGroup[]): TrackGroup[] {
  return groups.filter(group => group.track === null && group.sources.length > 0);
}

export function sourcesLabel(count: number): string {
  return count > 0 ? `${count} source${count > 1 ? 's' : ''}` : 'Aucune source';
}
