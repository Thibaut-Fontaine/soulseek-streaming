import fs from 'fs';
import path from 'path';

import { createDeezerCatalog, dedupeTracks } from '../src/core/catalog';
import type { JsonFetcher } from '../src/core/catalog';
import type { CatalogTrack } from '../src/core/catalogTypes';
import {
  matchHitToTrack,
  soulseekQueryFor,
  sourcesForTrack,
  UNIFY_SCORE,
  unifyResults,
} from '../src/core/unify';
import type { SearchHit } from '../src/core/types';

const LIST_SCORE = 0.55;
const FIXTURES = path.join(__dirname, 'fixtures', 'deezer');

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
}

/** Serves the recorded Deezer answers by URL path. */
function fixtureFetcher(calls: string[] = []): JsonFetcher {
  const routes: Array<[RegExp, string]> = [
    [/^\/search\/artist\?/, 'search-artist'],
    [/^\/search\/album\?/, 'search-album'],
    [/^\/search\?/, 'search-track'],
    [/^\/artist\/27\?|^\/artist\/27$/, 'artist'],
    [/^\/artist\/27\/top/, 'artist-top'],
    [/^\/artist\/27\/albums/, 'artist-albums'],
    [/^\/artist\/27\/related/, 'artist-related'],
    [/^\/album\/302127\/tracks/, 'album-tracks'],
    [/^\/album\/302127$/, 'album'],
    [/^\/chart\/0/, 'chart'],
    [/^\/genre$/, 'genre'],
    [/^\/genre\/113\/artists/, 'genre-artists'],
    [/^\/genre\/113$/, 'genre-113'],
    [/^\/chart\/113\/tracks/, 'genre-chart-tracks'],
  ];

  return async url => {
    const route = url.replace('https://api.deezer.com', '');
    calls.push(route);
    const match = routes.find(([pattern]) => pattern.test(route));
    return match ? fixture(match[1]) : { error: { type: 'DataException', message: 'no data', code: 800 } };
  };
}

function hit(filename: string, overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    username: 'alice',
    filename,
    size: 8_000_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 500_000,
    queueLength: 0,
    bitrate: 320,
    durationSec: 320,
    ...overrides,
  };
}

describe('Deezer catalog', () => {
  test('search returns tracks, artists and albums with covers and versions', async () => {
    const catalog = createDeezerCatalog(fixtureFetcher());
    const result = await catalog.search('daft punk one more time');

    expect(result.tracks[0]).toMatchObject({
      id: 'dz:3135553',
      title: 'One More Time',
      titleShort: 'One More Time',
      version: '',
      artist: { id: 'dz:27', name: 'Daft Punk' },
      album: { title: 'Discovery' },
      durationSec: 320,
    });
    expect(result.tracks[0].album?.cover.large).toMatch(/1000x1000/);

    const edit = result.tracks.find(track => track.version.includes('Radio Edit'));
    expect(edit?.titleShort).toBe('One More Time');
    expect(result.artists[0].name).toBe('Daft Punk');
    expect(result.artists[0].picture.medium).toMatch(/^https:/);
    expect(result.albums.length).toBeGreaterThan(0);
  });

  test('artist page has top tracks, discography and similar artists', async () => {
    const catalog = createDeezerCatalog(fixtureFetcher());
    const page = await catalog.artist('dz:27');

    expect(page.artist.name).toBe('Daft Punk');
    expect(page.topTracks.length).toBeGreaterThan(3);
    expect(page.related.map(artist => artist.name)).toContain('Justice');
    expect(page.albums.length).toBeGreaterThan(3);
    // Newest first.
    const dates = page.albums.map(album => album.releaseDate ?? '');
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(page.albums.map(album => album.kind)).has('album')).toBe(true);
  });

  test('album page lists numbered tracks carrying the album cover', async () => {
    const catalog = createDeezerCatalog(fixtureFetcher());
    const page = await catalog.album('dz:302127');

    expect(page.album.title).toBe('Discovery');
    expect(page.tracks.length).toBe(page.album.trackCount);
    expect(page.tracks[0]).toMatchObject({ title: 'One More Time', trackNumber: 1, discNumber: 1 });
    expect(page.tracks[0].album?.cover.medium).toBe(page.album.cover.medium);
    expect(page.moreByArtist.every(album => album.title !== 'Discovery')).toBe(true);
  });

  test('browse and genre pages', async () => {
    const catalog = createDeezerCatalog(fixtureFetcher());
    const browse = await catalog.browse();

    expect(browse.chartTracks.length).toBeGreaterThan(0);
    expect(browse.chartAlbums.length).toBeGreaterThan(0);
    expect(browse.chartArtists.length).toBeGreaterThan(0);
    expect(browse.genres.find(genre => genre.id === 'dz:0')).toBeUndefined();
    expect(browse.genres.find(genre => genre.name === 'Dance')).toBeDefined();

    const genre = await catalog.genre('dz:113');
    expect(genre.genre.name).toBe('Dance');
    expect(genre.artists.length).toBeGreaterThan(0);
    expect(genre.chartTracks.length).toBeGreaterThan(0);
  });

  test('caches answers and shares requests in flight', async () => {
    const calls: string[] = [];
    const catalog = createDeezerCatalog(fixtureFetcher(calls));

    await Promise.all([catalog.artist('dz:27'), catalog.artist('dz:27')]);
    await catalog.artist('dz:27');

    expect(calls.filter(call => call.startsWith('/artist/27/top')).length).toBe(1);
  });

  test('reports unknown ids and retries when over quota', async () => {
    let quota = 1;
    const base = fixtureFetcher();
    const catalog = createDeezerCatalog(async (url, signal) => {
      if (url.includes('/genre/113') && quota-- > 0) {
        return { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } };
      }
      return base(url, signal);
    });

    await expect(catalog.album('dz:1')).rejects.toThrow('Introuvable');
    await expect(catalog.album('spotify:1')).rejects.toThrow('Identifiant');
    await expect(catalog.genre('dz:113')).resolves.toMatchObject({ genre: { name: 'Dance' } });
  });

  test('keeps one copy of a recording found on several releases', () => {
    const base = { titleShort: 'Song', version: '', contributors: [], album: null, explicit: false };
    const tracks: CatalogTrack[] = [
      { ...base, id: 'dz:1', title: 'Song', artist: { id: 'dz:9', name: 'A' }, durationSec: 200, rank: 10 },
      { ...base, id: 'dz:2', title: 'Song', artist: { id: 'dz:9', name: 'A' }, durationSec: 201, rank: 90 },
      { ...base, id: 'dz:3', title: 'Song', artist: { id: 'dz:9', name: 'A' }, durationSec: 260, rank: 50 },
    ];

    expect(dedupeTracks(tracks).map(track => track.id)).toEqual(['dz:2', 'dz:3']);
  });
});

describe('matching Soulseek files to catalog tracks', () => {
  let album: CatalogTrack;
  let edit: CatalogTrack;
  let tracks: CatalogTrack[];

  beforeAll(async () => {
    const result = await createDeezerCatalog(fixtureFetcher()).search('daft punk one more time');
    tracks = result.tracks;
    album = tracks[0];
    const found = tracks.find(track => track.version.includes('Radio Edit'));
    if (!found) {
      throw new Error('fixture lost the radio edit');
    }
    edit = found;
  });

  test('accepts the usual ways a file is named', () => {
    const names = [
      'Music\\Daft Punk\\Discovery\\01 - One More Time.mp3',
      '@@music\\Daft Punk - Discovery (2001)\\01. one more time.mp3',
      'share/Electro/Daft Punk - One More Time.mp3',
      'share/daft_punk-one_more_time.mp3',
    ];

    for (const name of names) {
      expect([name, matchHitToTrack(hit(name), album)]).toEqual([name, expect.any(Number)]);
      expect(matchHitToTrack(hit(name), album)).toBeGreaterThanOrEqual(UNIFY_SCORE);
    }
  });

  test('a file named by title only matches when the length agrees', () => {
    expect(matchHitToTrack(hit('Downloads/One More Time.mp3'), album)).toBeGreaterThanOrEqual(UNIFY_SCORE);
    expect(
      matchHitToTrack(hit('Downloads/One More Time.mp3', { durationSec: 136 }), album),
    ).toBeLessThan(UNIFY_SCORE);
  });

  test('length separates the album version from the radio edit', () => {
    const albumFile = hit('Daft Punk/Discovery/01 - One More Time.mp3', { durationSec: 320 });
    const editFile = hit('Daft Punk/Singles/Daft Punk - One More Time (Radio Edit).mp3', { durationSec: 235 });

    expect(matchHitToTrack(albumFile, album)).toBeGreaterThan(matchHitToTrack(albumFile, edit));
    expect(matchHitToTrack(editFile, edit)).toBeGreaterThan(matchHitToTrack(editFile, album));
  });

  test('rejects live versions, other artists and previews', () => {
    expect(matchHitToTrack(hit('Daft Punk/Alive/One More Time (Live).mp3', { durationSec: 370 }), album)).toBeLessThan(UNIFY_SCORE);
    expect(matchHitToTrack(hit('Heuss/Heuss - One More Time.mp3', { durationSec: 136 }), album)).toBeLessThan(UNIFY_SCORE);
    expect(matchHitToTrack(hit('Daft Punk - One More Time.mp3', { durationSec: 30 }), album)).toBeLessThan(UNIFY_SCORE);
  });

  test('unifies search results into one card per song', () => {
    const hits = [
      hit('a/Daft Punk/Discovery/01 - One More Time.mp3', { username: 'u1' }),
      hit('b/Daft Punk - One More Time.mp3', { username: 'u2', durationSec: 321 }),
      hit('c/Daft Punk - One More Time (Radio Edit).mp3', { username: 'u3', durationSec: 235 }),
      hit('d/Edits/Daft Punk - One More Time (Edit 2023).mp3', { username: 'u4', durationSec: 410 }),
      hit('e/Daft Punk - One More Time (Edit 2023).mp3', { username: 'u5', durationSec: 411 }),
    ];

    const { groups, hitTracks } = unifyResults('daft punk one more time', hits, tracks, LIST_SCORE);

    expect(groups[0].track?.id).toBe(album.id);
    expect(groups[0].sources.map(source => source.hit.username).sort()).toEqual(['u1', 'u2']);
    expect(groups.find(group => group.track?.id === edit.id)?.sources.map(s => s.hit.username)).toEqual(['u3']);

    const others = groups.filter(group => group.track === null);
    expect(others.length).toBe(1);
    expect(others[0].sources.length).toBe(2);
    expect(Object.keys(hitTracks).length).toBe(3);
  });

  test('sources for a track and the query sent to Soulseek', () => {
    const hits = [
      hit('x/Daft Punk - One More Time.mp3', { username: 'slow', slotFree: false, queueLength: 30 }),
      hit('y/Daft Punk - One More Time.mp3', { username: 'fast' }),
    ];

    expect(sourcesForTrack(album, hits).map(source => source.hit.username)).toEqual(['fast', 'slow']);
    expect(soulseekQueryFor(album)).toBe('Daft Punk One More Time');
    expect(soulseekQueryFor(edit)).toBe('Daft Punk One More Time');
  });
});
