import { parseTrack } from '../src/core/catalog';
import type { CatalogTrack } from '../src/core/catalogTypes';
import { formatSearchQuery } from '../src/core/search';
import type { SearchHit } from '../src/core/types';
import {
  matchHitToTrack,
  meaningfulVersion,
  soulseekLadder,
  soulseekQueryFor,
  splitTitle,
  UNIFY_SCORE,
} from '../src/core/unify';

/** A track as Deezer sends it (title, title_short, title_version). */
function deezer(
  artist: string,
  title: string,
  options: { short?: string; version?: string; album?: string; duration?: number } = {},
): CatalogTrack {
  return parseTrack({
    id: 1,
    title,
    title_short: options.short ?? title,
    title_version: options.version ?? '',
    duration: options.duration ?? 200,
    artist: { id: 2, name: artist },
    album: { id: 3, title: options.album ?? 'Some Album' },
  });
}

function hit(filename: string, durationSec = 200): SearchHit {
  return {
    username: 'alice',
    filename,
    size: 5_000_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 500_000,
    queueLength: 0,
    bitrate: 320,
    durationSec,
  };
}

const NO_STUDIO = '-live -karaoke -instrumental -remix';

describe('titles split into name and versions', () => {
  test.each([
    ["Don't Stop Me Now - Remastered 2011", "Don't Stop Me Now", ['Remastered 2011']],
    ['Stairway to Heaven (Live 1972; Remaster)', 'Stairway to Heaven', ['Live 1972', 'Remaster']],
    ['Bohemian Rhapsody - 2011 Mix', 'Bohemian Rhapsody', ['2011 Mix']],
    ['Help! - Live / Remastered', 'Help!', ['Live', 'Remastered']],
    ['Love Me Do - Mono', 'Love Me Do', ['Mono']],
    ["(Don't Fear) The Reaper", "Don't Fear The Reaper", []],
    ['Get Lucky (feat. Pharrell Williams)', 'Get Lucky', []],
    ['Let It Go (From "Frozen"/Soundtrack Version)', 'Let It Go', []],
    ['Pt. 2 - Interlude', 'Pt. 2 - Interlude', []],
    ['Take Five', 'Take Five', []],
  ])('%s', (title, base, versions) => {
    expect(splitTitle(title)).toEqual({ base, versions });
  });
});

describe('version parts are judged one by one', () => {
  test('a live recording stays live even when also remastered', () => {
    const track = deezer('Led Zeppelin', 'Stairway to Heaven (Live 1972; Remaster)', {
      short: 'Stairway to Heaven',
      version: '(Live 1972; Remaster)',
    });
    expect(meaningfulVersion(track)).toBe('Live');
    expect(
      matchHitToTrack(hit('Led Zeppelin/IV/04 - Stairway to Heaven.mp3', 482), track),
    ).toBeLessThan(matchHitToTrack(hit('Led Zeppelin/BBC/Stairway to Heaven (Live).mp3', 482), track));
  });

  test.each([
    ['(Remastered 2009)', ''],
    ['(2017 Remaster)', ''],
    ['(Mono Version)', ''],
    ['(Single Version)', ''],
    ['(Radio Edit)', 'Radio Edit'],
    ['(Kygo Remix)', 'Kygo Remix'],
    ['(Live at Wembley 1986)', 'Live at Wembley'],
  ])('%s', (version, meaningful) => {
    expect(meaningfulVersion(deezer('A', `Song ${version}`, { short: 'Song', version }))).toBe(meaningful);
  });

  test('a dash version does not have to be in the file name', () => {
    const track = deezer('Queen', "Don't Stop Me Now - Remastered 2011", { duration: 209 });
    expect(matchHitToTrack(hit('Queen/Jazz/12 - Dont Stop Me Now.mp3', 210), track)).toBeGreaterThanOrEqual(UNIFY_SCORE);
  });
});

describe('words with apostrophes', () => {
  test.each([
    ["Don't Stop Me Now", 'Stop Me Now'],
    ["I'm Still Standing", 'Still Standing'],
    ["Rock 'n' Roll Star", 'Rock Roll Star'],
    ["L'hymne à l'amour", 'hymne amour'],
    ["Summer of '69", 'Summer of 69'],
    ["Guns N' Roses", 'Guns Roses'],
  ])('%s', (raw, query) => {
    expect(formatSearchQuery(raw)).toBe(query);
  });
});

describe('Soulseek queries for real Deezer titles', () => {
  test.each<[string, CatalogTrack, string[]]>([
    [
      'version after a dash',
      deezer('Queen', "Don't Stop Me Now - Remastered 2011", { album: 'Jazz (2011 Remaster)' }),
      [`queen stop me now ${NO_STUDIO}`, `stop me now ${NO_STUDIO}`, `queen jazz ${NO_STUDIO}`],
    ],
    [
      'live, also remastered',
      deezer('Led Zeppelin', 'Stairway to Heaven (Live 1972; Remaster)', {
        short: 'Stairway to Heaven',
        version: '(Live 1972; Remaster)',
        album: 'The Song Remains the Same',
      }),
      [
        'led zeppelin stairway to heaven live -karaoke -instrumental -remix',
        'stairway to heaven live -karaoke -instrumental -remix',
        'led zeppelin song remains same -karaoke -instrumental -remix',
      ],
    ],
    [
      'quotes, "The" artist',
      deezer('David Bowie', '"Heroes" (2017 Remaster)', { short: '"Heroes"', version: '(2017 Remaster)', album: '"Heroes"' }),
      [`david bowie heroes ${NO_STUDIO}`, `heroes ${NO_STUDIO}`],
    ],
    [
      'artist without "The"',
      deezer('The Beatles', 'Let It Be (Remastered 2009)', { short: 'Let It Be', version: '(Remastered 2009)', album: 'Let It Be' }),
      [`beatles let it be ${NO_STUDIO}`, `let it be ${NO_STUDIO}`],
    ],
    [
      'one-letter title goes to the album',
      deezer('Coldplay', 'A', { album: 'Viva la Vida' }),
      [`coldplay viva la vida ${NO_STUDIO}`],
    ],
    [
      'remix keeps its kind',
      deezer('Avicii', 'Wake Me Up (Kygo Remix)', { short: 'Wake Me Up', version: '(Kygo Remix)', album: 'Wake Me Up' }),
      [
        'avicii wake me up remix -live -karaoke -instrumental',
        'wake me up remix -live -karaoke -instrumental',
        'avicii wake me up -live -karaoke -instrumental',
      ],
    ],
    [
      'long title keeps four words',
      deezer('The Beatles', 'The Ballad of John and Yoko', { album: 'Past Masters' }),
      [
        `beatles ballad john yoko ${NO_STUDIO}`,
        `ballad john yoko ${NO_STUDIO}`,
        `beatles past masters ${NO_STUDIO}`,
      ],
    ],
    [
      'a word of the name is never excluded',
      deezer('Oasis', 'Live Forever', { album: 'Definitely Maybe' }),
      [
        'oasis live forever -karaoke -instrumental -remix',
        'live forever -karaoke -instrumental -remix',
        'oasis definitely maybe -karaoke -instrumental -remix',
      ],
    ],
  ])('%s', (_name, track, queries) => {
    expect(soulseekLadder(track).map(step => step.query.toLowerCase())).toEqual(queries);
  });

  test('short title-only queries are not sent', () => {
    const track = deezer('Moby', 'Go', { album: 'Moby' });
    expect(soulseekLadder(track).map(step => step.kind)).toEqual(['artist-title']);
  });

  test('the plain query (local cache, file list) has no exclusions', () => {
    const track = deezer('Queen', "Don't Stop Me Now - Remastered 2011");
    expect(soulseekQueryFor(track)).toBe('Queen Stop Me Now');
  });
});
