/**
 * Realistic catalog data (shaped like what the Deezer provider returns) for
 * UI tests.
 */
import type {
  AlbumPageData,
  ArtistPageData,
  Artwork,
  CatalogAlbum,
  CatalogArtist,
  CatalogSearchResult,
  CatalogTrack,
  HomeData,
  TrackGroup,
} from '../src/core/catalogTypes';
import type { MusicMap } from '../src/core/musicMap';
import type { SearchHit } from '../src/core/types';

export function art(name: string): Artwork {
  return {
    small: `https://cdn.example/${name}/56x56.jpg`,
    medium: `https://cdn.example/${name}/250x250.jpg`,
    big: `https://cdn.example/${name}/500x500.jpg`,
    large: `https://cdn.example/${name}/1000x1000.jpg`,
  };
}

export const DAFT_PUNK: CatalogArtist = {
  id: 'dz:27',
  name: 'Daft Punk',
  picture: art('daft-punk'),
  fans: 4_871_265,
  albumCount: 32,
};

export const JUSTICE: CatalogArtist = { id: 'dz:1424', name: 'Justice', picture: art('justice'), fans: 812_004 };
export const CASSIUS: CatalogArtist = { id: 'dz:1563', name: 'Cassius', picture: art('cassius'), fans: 120_330 };

const DP = { id: DAFT_PUNK.id, name: DAFT_PUNK.name };

export const DISCOVERY: CatalogAlbum = {
  id: 'dz:302127',
  title: 'Discovery',
  cover: art('discovery'),
  artist: DP,
  kind: 'album',
  releaseDate: '2001-03-12',
  trackCount: 14,
  durationSec: 3660,
  label: 'Parlophone (France)',
};

export const RAM: CatalogAlbum = {
  id: 'dz:6575789',
  title: 'Random Access Memories',
  cover: art('ram'),
  artist: DP,
  kind: 'album',
  releaseDate: '2013-05-17',
  trackCount: 13,
};

export const ALIVE: CatalogAlbum = {
  id: 'dz:1112',
  title: 'Alive 2007',
  cover: art('alive'),
  artist: DP,
  kind: 'compile',
  releaseDate: '2007-11-19',
};

export const GET_LUCKY_SINGLE: CatalogAlbum = {
  id: 'dz:6560441',
  title: 'Get Lucky (Radio Edit)',
  cover: art('get-lucky'),
  artist: DP,
  kind: 'single',
  releaseDate: '2013-04-19',
};

export const ONE_MORE_TIME_EP: CatalogAlbum = {
  id: 'dz:9001',
  title: 'One More Time (Remixes)',
  cover: art('omt-ep'),
  artist: DP,
  kind: 'ep',
  releaseDate: '2000-11-13',
};

function ref(album: CatalogAlbum) {
  return { id: album.id, title: album.title, cover: album.cover };
}

export function track(
  id: string,
  title: string,
  extra: Partial<CatalogTrack> = {},
  album: CatalogAlbum | null = DISCOVERY,
): CatalogTrack {
  return {
    id,
    title,
    titleShort: title,
    version: '',
    artist: DP,
    contributors: [],
    album: album ? ref(album) : null,
    durationSec: 240,
    explicit: false,
    ...extra,
  };
}

export const ONE_MORE_TIME = track('dz:3135553', 'One More Time', { durationSec: 320, trackNumber: 1, discNumber: 1 });
export const AERODYNAMIC = track('dz:3135554', 'Aerodynamic', { durationSec: 212, trackNumber: 2, discNumber: 1 });
export const DIGITAL_LOVE = track('dz:3135555', 'Digital Love', { durationSec: 301, trackNumber: 3, discNumber: 1 });
export const OMT_RADIO = track('dz:3135560', 'One More Time (Radio Edit)', {
  titleShort: 'One More Time',
  version: '(Radio Edit)',
  durationSec: 235,
  trackNumber: 1,
  discNumber: 2,
});
export const GET_LUCKY = track(
  'dz:67238735',
  'Get Lucky',
  {
    contributors: [
      { id: 'dz:1', name: 'Pharrell Williams' },
      { id: 'dz:2', name: 'Nile Rodgers' },
    ],
    durationSec: 369,
    explicit: true,
  },
  RAM,
);

export const TOP_TRACKS: CatalogTrack[] = [
  ONE_MORE_TIME,
  GET_LUCKY,
  DIGITAL_LOVE,
  AERODYNAMIC,
  track('dz:5', 'Harder, Better, Faster, Stronger'),
  track('dz:6', 'Around the World'),
  track('dz:7', 'Instant Crush', {}, RAM),
];

export const ARTIST_PAGE: ArtistPageData = {
  artist: DAFT_PUNK,
  topTracks: TOP_TRACKS,
  albums: [RAM, GET_LUCKY_SINGLE, ALIVE, DISCOVERY, ONE_MORE_TIME_EP],
  related: [JUSTICE, CASSIUS],
};

export const ALBUM_PAGE: AlbumPageData = {
  album: DISCOVERY,
  tracks: [ONE_MORE_TIME, AERODYNAMIC, DIGITAL_LOVE, OMT_RADIO],
  moreByArtist: [RAM, ALIVE],
};

export const HOME: HomeData = {
  artists: [DAFT_PUNK, JUSTICE],
  similar: [{ artist: DAFT_PUNK, related: [CASSIUS] }],
};

export const MUSIC_MAP: MusicMap = {
  root: DAFT_PUNK,
  nodes: [
    { artist: DAFT_PUNK, parentId: null, depth: 0 },
    { artist: JUSTICE, parentId: DAFT_PUNK.id, depth: 1 },
    { artist: CASSIUS, parentId: DAFT_PUNK.id, depth: 1 },
    { artist: { id: 'dz:99', name: 'Boys Noize', picture: art('boys-noize') }, parentId: JUSTICE.id, depth: 2 },
  ],
  edges: [
    { from: DAFT_PUNK.id, to: JUSTICE.id },
    { from: DAFT_PUNK.id, to: CASSIUS.id },
    { from: JUSTICE.id, to: 'dz:99' },
  ],
  truncated: true,
};

export const EMPTY_MUSIC_MAP: MusicMap = {
  root: DAFT_PUNK,
  nodes: [{ artist: DAFT_PUNK, parentId: null, depth: 0 }],
  edges: [],
  truncated: false,
};

export function soulseekHit(filename: string, username = 'peer'): SearchHit {
  return {
    username,
    filename,
    size: 7_600_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 400_000,
    queueLength: 0,
    bitrate: 320,
    durationSec: 320,
  };
}

export const OMT_FILE_A = soulseekHit('Music\\Daft Punk\\Discovery\\01 - One More Time.mp3', 'dj_mark');
export const OMT_FILE_B = soulseekHit('mp3\\daft punk - one more time.mp3', 'leiji');
export const BOOTLEG_FILE = soulseekHit('rips\\daft punk live bootleg 1997 track 3.mp3', 'tapes');

export const SEARCH_RESULT: CatalogSearchResult = {
  query: 'daft punk one more time',
  tracks: [ONE_MORE_TIME, OMT_RADIO, GET_LUCKY],
  artists: [DAFT_PUNK, JUSTICE],
  albums: [DISCOVERY, ONE_MORE_TIME_EP],
};

export const SEARCH_GROUPS: TrackGroup[] = [
  {
    id: ONE_MORE_TIME.id,
    track: ONE_MORE_TIME,
    title: ONE_MORE_TIME.title,
    artist: 'Daft Punk',
    sources: [
      { hit: OMT_FILE_A, score: 0.95, rank: 3 },
      { hit: OMT_FILE_B, score: 0.9, rank: 2 },
    ],
  },
  { id: OMT_RADIO.id, track: OMT_RADIO, title: OMT_RADIO.title, artist: 'Daft Punk', sources: [] },
  {
    id: 'local:daft punk|live bootleg',
    track: null,
    title: 'daft punk live bootleg 1997 track 3',
    artist: null,
    sources: [{ hit: BOOTLEG_FILE, score: 0.5, rank: 1 }],
  },
];
