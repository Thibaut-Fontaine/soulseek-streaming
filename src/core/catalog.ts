import type {
  AlbumKind,
  AlbumPageData,
  ArtistPageData,
  Artwork,
  CatalogAlbum,
  CatalogArtist,
  CatalogArtistRef,
  CatalogSearchResult,
  CatalogTrack,
} from './catalogTypes';
import { normalizeForMatch } from './search';

/**
 * Online music catalog: canonical tracks, artists, albums and covers.
 *
 * Soulseek only tells us file paths, so everything shown to the user (titles,
 * artists, albums, covers, similar artists) comes from here, and the
 * Soulseek files are matched to these entities (see `unify.ts`).
 *
 * The provider is Deezer's public API: no key, typo-tolerant search, covers up
 * to 1000 px. Its terms only allow non-commercial use and access can change,
 * so the rest of the app only sees `CatalogProvider`.
 */
export interface CatalogProvider {
  readonly name: string;
  search(query: string): Promise<CatalogSearchResult>;
  /** Tracks only, more of them: used to find what a typed query means. */
  searchTracks(query: string, limit?: number): Promise<CatalogTrack[]>;
  artist(id: string): Promise<ArtistPageData>;
  album(id: string): Promise<AlbumPageData>;
  /** An artist and the artists similar to it (for the home page). */
  artistWithRelated(id: string): Promise<{ artist: CatalogArtist; related: CatalogArtist[] }>;
  /** Tracks like this artist's (an artist "radio"). */
  artistRadio(id: string): Promise<CatalogTrack[]>;
}

/** Fetches a URL and returns parsed JSON. Injected so tests run offline. */
export type JsonFetcher = (url: string, signal?: AbortSignal) => Promise<unknown>;

export class CatalogError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'CatalogError';
  }
}

const DEEZER_API = 'https://api.deezer.com';
const PREFIX = 'dz:';
const REQUEST_TIMEOUT_MS = 8000;
/** Deezer allows ~50 requests per 5 s per IP; stay well under it. */
const MIN_REQUEST_GAP_MS = 120;
const MAX_PARALLEL = 4;
const SEARCH_TTL_MS = 30 * 60 * 1000;
const PAGE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_ENTRIES = 300;

export function defaultFetcher(): JsonFetcher {
  return async (url, signal) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new CatalogError(`Catalogue indisponible (HTTP ${response.status})`, response.status >= 500 || response.status === 429);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof CatalogError) {
        throw error;
      }
      throw new CatalogError(
        controller.signal.aborted ? 'Le catalogue ne répond pas' : 'Catalogue injoignable',
        true,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

/** Small LRU cache with expiry. */
class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(private readonly max: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expires < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + ttlMs });

    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }
}

/** Spaces requests out and caps how many run at once. */
/**
 * What the user is waiting for (search, a page they opened) goes first;
 * background work (home suggestions) waits behind it.
 */
export type Priority = 'high' | 'low';

class Throttle {
  private running = 0;
  private lastStart = 0;
  private readonly waiting: Record<Priority, Array<() => void>> = { high: [], low: [] };

  async run<T>(task: () => Promise<T>, priority: Priority = 'high'): Promise<T> {
    await this.acquire(priority);

    try {
      return await task();
    } finally {
      this.running--;
      (this.waiting.high.shift() ?? this.waiting.low.shift())?.();
    }
  }

  private async acquire(priority: Priority): Promise<void> {
    if (this.running >= MAX_PARALLEL || (priority === 'low' && this.waiting.high.length > 0)) {
      await new Promise<void>(resolve => this.waiting[priority].push(resolve));
    }

    this.running++;
    const wait = this.lastStart + MIN_REQUEST_GAP_MS - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + MIN_REQUEST_GAP_MS);

    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Deezer JSON → catalog entities                                            */
/* ------------------------------------------------------------------------ */

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function list(value: unknown): Json[] {
  const data = obj(value).data;
  return Array.isArray(data) ? data.map(obj) : [];
}

function id(value: unknown): string {
  const raw = str(value);
  return raw ? `${PREFIX}${raw}` : '';
}

/** Deezer id without our prefix, or null when it is not a Deezer id. */
function rawId(catalogId: string): string | null {
  return catalogId.startsWith(PREFIX) && /^\d+$/.test(catalogId.slice(PREFIX.length))
    ? catalogId.slice(PREFIX.length)
    : null;
}

function artwork(json: Json, field: 'cover' | 'picture'): Artwork {
  const pick = (key: string) => str(json[key]) || null;
  return {
    small: pick(`${field}_small`),
    medium: pick(`${field}_medium`) ?? pick(`${field}_big`),
    large: pick(`${field}_xl`) ?? pick(`${field}_big`),
  };
}

function artistRef(json: Json): CatalogArtistRef {
  return { id: id(json.id), name: str(json.name) };
}

export function parseArtist(json: Json): CatalogArtist {
  return {
    ...artistRef(json),
    picture: artwork(json, 'picture'),
    fans: num(json.nb_fan),
    albumCount: num(json.nb_album),
  };
}

function albumKind(value: unknown): AlbumKind {
  const kind = str(value);
  return kind === 'single' || kind === 'ep' || kind === 'compile' ? kind : 'album';
}

export function parseAlbum(json: Json, fallbackArtist?: CatalogArtistRef): CatalogAlbum {
  const artistJson = obj(json.artist);
  const genres = list(json.genres).map(genre => str(genre.name)).filter(Boolean);

  return {
    id: id(json.id),
    title: str(json.title),
    cover: artwork(json, 'cover'),
    artist: artistJson.id !== undefined ? artistRef(artistJson) : fallbackArtist ?? { id: '', name: '' },
    kind: albumKind(json.record_type),
    releaseDate: str(json.release_date) || null,
    trackCount: num(json.nb_tracks),
    durationSec: num(json.duration),
    label: str(json.label) || undefined,
    genres: genres.length > 0 ? genres : undefined,
  };
}

export function parseTrack(json: Json, fallbackAlbum?: CatalogAlbum): CatalogTrack {
  const albumJson = obj(json.album);
  const title = str(json.title);
  const titleShort = str(json.title_short) || title;
  const contributors = Array.isArray(json.contributors)
    ? json.contributors.map(obj).map(artistRef)
    : [];
  const artist = artistRef(obj(json.artist));

  let album: CatalogTrack['album'] = null;
  if (albumJson.id !== undefined) {
    album = { id: id(albumJson.id), title: str(albumJson.title), cover: artwork(albumJson, 'cover') };
  } else if (fallbackAlbum) {
    album = { id: fallbackAlbum.id, title: fallbackAlbum.title, cover: fallbackAlbum.cover };
  }

  return {
    id: id(json.id),
    title,
    titleShort,
    version: str(json.title_version).trim() || versionOf(title, titleShort),
    artist,
    contributors: contributors.filter(contributor => contributor.id !== artist.id),
    album,
    durationSec: num(json.duration) ?? 0,
    trackNumber: num(json.track_position),
    discNumber: num(json.disk_number),
    explicit: json.explicit_lyrics === true,
    rank: num(json.rank),
  };
}

/** "One More Time (Radio Edit)" minus "One More Time" → "(Radio Edit)". */
function versionOf(title: string, short: string): string {
  return title.length > short.length && title.startsWith(short) ? title.slice(short.length).trim() : '';
}

/** Deezer lists the same release several times (clean/explicit, regions). */
export function dedupeAlbums(albums: CatalogAlbum[], newestFirst = true): CatalogAlbum[] {
  const seen = new Map<string, CatalogAlbum>();

  for (const album of albums) {
    const key = `${album.kind}|${normalizeForMatch(album.title)}`;
    const existing = seen.get(key);

    if (!existing || (album.trackCount ?? 0) > (existing.trackCount ?? 0)) {
      seen.set(key, album);
    }
  }

  const kept = Array.from(seen.values());
  return newestFirst
    ? kept.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    : kept;
}

/**
 * The same recording appears on the album, the single and compilations.
 * Keeps the most popular one of each (same artist, title and length ±2 s).
 */
export function dedupeTracks(tracks: CatalogTrack[]): CatalogTrack[] {
  const kept: CatalogTrack[] = [];

  for (const track of tracks) {
    const title = normalizeForMatch(track.title);
    const index = kept.findIndex(
      other =>
        other.artist.id === track.artist.id &&
        normalizeForMatch(other.title) === title &&
        Math.abs(other.durationSec - track.durationSec) <= 2,
    );

    if (index < 0) {
      kept.push(track);
    } else if ((track.rank ?? 0) > (kept[index].rank ?? 0)) {
      kept[index] = { ...track };
    }
  }

  return kept;
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                  */
/* ------------------------------------------------------------------------ */

export function createDeezerCatalog(fetchJson: JsonFetcher = defaultFetcher()): CatalogProvider {
  const cache = new TtlCache<unknown>(CACHE_ENTRIES);
  const pending = new Map<string, Promise<unknown>>();
  const throttle = new Throttle();

  async function get(path: string, ttlMs: number, priority: Priority = 'high', attempt = 0): Promise<Json> {
    const url = `${DEEZER_API}${path}`;
    const cached = cache.get(url);

    if (cached !== undefined) {
      return obj(cached);
    }

    const inFlight = pending.get(url);
    if (inFlight) {
      return obj(await inFlight);
    }

    const request = throttle.run(() => fetchJson(url), priority);
    pending.set(url, request);

    let json: Json;
    try {
      json = obj(await request);
    } finally {
      pending.delete(url);
    }

    const error = obj(json.error);
    if (json.error !== undefined) {
      const code = num(error.code);

      // 4 = quota exceeded: wait and try again once or twice.
      if (code === 4 && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
        return get(path, ttlMs, priority, attempt + 1);
      }

      // 800 = no data (unknown id).
      throw new CatalogError(code === 800 ? 'Introuvable dans le catalogue' : str(error.message) || 'Erreur du catalogue', code === 4);
    }

    cache.set(url, json, ttlMs);
    return json;
  }

  function q(query: string, limit: number): string {
    return `?q=${encodeURIComponent(query)}&limit=${limit}`;
  }

  function requireId(catalogId: string): string {
    const raw = rawId(catalogId);
    if (!raw) {
      throw new CatalogError('Identifiant de catalogue inconnu');
    }
    return raw;
  }

  async function searchTracks(query: string, limit = 25): Promise<CatalogTrack[]> {
    const clean = query.trim();
    if (!clean) {
      return [];
    }
    const json = await get(`/search${q(clean, limit)}`, SEARCH_TTL_MS);
    return list(json).map(track => parseTrack(track)).filter(track => track.id);
  }

  return {
    name: 'Deezer',

    searchTracks,

    async search(query) {
      const clean = query.trim();

      if (!clean) {
        return { query: clean, tracks: [], artists: [], albums: [] };
      }

      const [tracks, artists, albums] = await Promise.all([
        searchTracks(clean, 25),
        get(`/search/artist${q(clean, 8)}`, SEARCH_TTL_MS).then(json => list(json).map(parseArtist)),
        get(`/search/album${q(clean, 12)}`, SEARCH_TTL_MS).then(json => list(json).map(album => parseAlbum(album))),
      ]);

      return { query: clean, tracks: dedupeTracks(tracks), artists, albums: dedupeAlbums(albums, false) };
    },

    async artist(catalogId) {
      const raw = requireId(catalogId);
      const [artistJson, top, albums, related] = await Promise.all([
        get(`/artist/${raw}`, PAGE_TTL_MS),
        get(`/artist/${raw}/top?limit=10`, PAGE_TTL_MS),
        get(`/artist/${raw}/albums?limit=100`, PAGE_TTL_MS),
        get(`/artist/${raw}/related?limit=20`, PAGE_TTL_MS).catch(() => ({})),
      ]);
      const artist = parseArtist(artistJson);

      return {
        artist,
        topTracks: dedupeTracks(list(top).map(track => parseTrack(track))),
        albums: dedupeAlbums(list(albums).map(album => parseAlbum(album, artist))),
        related: list(related).map(parseArtist),
      };
    },

    async album(catalogId) {
      const raw = requireId(catalogId);
      const albumJson = await get(`/album/${raw}`, PAGE_TTL_MS);
      const album = parseAlbum(albumJson);
      // The album answer embeds at most 25 tracks; long albums need the list.
      const embedded = list(albumJson.tracks);
      const trackJson =
        album.trackCount !== undefined && embedded.length < album.trackCount
          ? list(await get(`/album/${raw}/tracks?limit=200`, PAGE_TTL_MS))
          : embedded;
      const tracks = trackJson.map((track, index) => {
        const parsed = parseTrack(track, album);
        return { ...parsed, trackNumber: parsed.trackNumber ?? index + 1 };
      });

      let moreByArtist: CatalogAlbum[] = [];
      const artistId = album.artist.id ? rawId(album.artist.id) : null;
      if (artistId) {
        try {
          const others = await get(`/artist/${artistId}/albums?limit=100`, PAGE_TTL_MS);
          moreByArtist = dedupeAlbums(list(others).map(other => parseAlbum(other, album.artist))).filter(
            other => other.id !== album.id && normalizeForMatch(other.title) !== normalizeForMatch(album.title),
          );
        } catch {
          // Optional section.
        }
      }

      return { album, tracks, moreByArtist };
    },

    async artistWithRelated(catalogId) {
      const raw = requireId(catalogId);
      // Same URLs as the artist page, so opening it afterwards is instant.
      const [artistJson, related] = await Promise.all([
        get(`/artist/${raw}`, PAGE_TTL_MS, 'low'),
        get(`/artist/${raw}/related?limit=20`, PAGE_TTL_MS, 'low').catch(() => ({})),
      ]);
      return { artist: parseArtist(artistJson), related: list(related).map(parseArtist) };
    },

    async artistRadio(catalogId) {
      const raw = requireId(catalogId);
      return list(await get(`/artist/${raw}/radio?limit=40`, SEARCH_TTL_MS)).map(track => parseTrack(track));
    },
  };
}
