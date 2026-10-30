import type { RankedHit } from './search';

/**
 * Canonical music entities from the online catalog (Deezer today, see
 * `catalog.ts`). Soulseek files are only sources for these: titles, artists,
 * albums and covers shown in the app come from here whenever we have them.
 */

/** Cover or picture URLs at a few sizes (square). */
export interface Artwork {
  /** ~56 px, for dense lists. */
  small: string | null;
  /** ~250 px, for rows and cards. */
  medium: string | null;
  /** ~500 px, for shelf tiles and the album cover (absent from older saved tracks). */
  big?: string | null;
  /** ~1000 px, for the player and page headers. */
  large: string | null;
}

export interface CatalogArtistRef {
  id: string;
  name: string;
}

export interface CatalogAlbumRef {
  id: string;
  title: string;
  cover: Artwork;
}

export interface CatalogTrack {
  /** Provider-prefixed id, e.g. "dz:3135553". */
  id: string;
  /** Full title, version included: "One More Time (Radio Edit)". */
  title: string;
  /** Title without the version: "One More Time". */
  titleShort: string;
  /** "(Radio Edit)", "Live", or "" for the main version. */
  version: string;
  artist: CatalogArtistRef;
  /** Featured artists, when known. */
  contributors: CatalogArtistRef[];
  album: CatalogAlbumRef | null;
  durationSec: number;
  /** 1-based position on its album, when known. */
  trackNumber?: number;
  /** Disc number, when known. */
  discNumber?: number;
  explicit: boolean;
  /** Popularity, provider scale; only for ordering. */
  rank?: number;
}

export type AlbumKind = 'album' | 'single' | 'ep' | 'compile';

export interface CatalogAlbum extends CatalogAlbumRef {
  artist: CatalogArtistRef;
  kind: AlbumKind;
  /** ISO date, "2001-03-12". */
  releaseDate: string | null;
  trackCount?: number;
  /** Total duration, when known. */
  durationSec?: number;
  label?: string;
  genres?: string[];
}

export interface CatalogArtist extends CatalogArtistRef {
  picture: Artwork;
  fans?: number;
  albumCount?: number;
}

/** Everything the catalog found for a typed query. */
export interface CatalogSearchResult {
  query: string;
  tracks: CatalogTrack[];
  artists: CatalogArtist[];
  albums: CatalogAlbum[];
}

export interface ArtistPageData {
  artist: CatalogArtist;
  topTracks: CatalogTrack[];
  /** Albums, singles and EPs, newest first. */
  albums: CatalogAlbum[];
  /** "Fans also like". */
  related: CatalogArtist[];
}

export interface AlbumPageData {
  album: CatalogAlbum;
  tracks: CatalogTrack[];
  /** Other releases by the same artist, newest first. */
  moreByArtist: CatalogAlbum[];
}

/** Home content, built only from what the user listened to. */
export interface HomeData {
  /** Artists of recently played tracks, most recent first. */
  artists: CatalogArtist[];
  /** "Parce que vous écoutez X": artists similar to the recent ones. */
  similar: Array<{ artist: CatalogArtist; related: CatalogArtist[] }>;
}

/**
 * One search result card: a catalog track and the Soulseek files that are
 * that track, best source first.
 */
export interface TrackGroup {
  /** `track.id`, or "local:<key>" for files no catalog track matched. */
  id: string;
  /** Null when no catalog track matched; then title/artist come from paths. */
  track: CatalogTrack | null;
  title: string;
  artist: string | null;
  sources: RankedHit[];
}

/** Finding Soulseek sources for one catalog track, on demand. */
export interface Resolution {
  status: 'searching' | 'found' | 'none' | 'error';
  sources: RankedHit[];
}

/** Async data held by the store, keyed by id. */
export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string };

/** Pages pushed above the tabs, like a navigation stack. */
export type Page =
  | { kind: 'artist'; id: string; name?: string }
  | { kind: 'album'; id: string; title?: string }
  | { kind: 'map'; id: string; name?: string };

/** A list of catalog tracks being played (album, top tracks, radio...). */
export interface CatalogPlayContext {
  /** Shown as "Lecture depuis …" in the player. */
  label: string;
  tracks: CatalogTrack[];
  index: number;
}
