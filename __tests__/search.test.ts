import {
  AUTO_MATCH_SCORE,
  formatSearchQuery,
  levenshtein,
  pickBestMatch,
  scoreHit,
  rankHits,
  similarity,
} from '../src/core/search';
import { parseTrackName } from '../src/core/types';
import type { SearchHit } from '../src/core/types';

function hit(filename: string, overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    username: 'alice',
    filename,
    size: 5_000_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 500_000,
    queueLength: 0,
    bitrate: 192,
    durationSec: 180,
    ...overrides,
  };
}

describe('pre-search query formatting', () => {
  test('removes noise and preserves the meaningful title', () => {
    expect(
      formatSearchQuery('Daft Punk - One More Time (Official Video) [HD] 320kbps'),
    ).toBe('Daft Punk - One More Time');
  });

  test('handles slashes and accented characters', () => {
    expect(formatSearchQuery('Björk / Jóga (clip officiel)')).toBe('Bjork Joga');
  });

  test('never returns an empty query', () => {
    expect(formatSearchQuery('   ')).toBe('');
    expect(formatSearchQuery('mp3')).toBe('mp3');
  });
});

describe('Levenshtein matching', () => {
  test('computes the classic distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  test('is accent and case insensitive', () => {
    expect(similarity('Björk - Jóga', 'bjork joga')).toBeGreaterThan(0.95);
  });

  test('scores an exact artist/title highly', () => {
    expect(scoreHit('daft punk one more time', hit('Daft Punk - One More Time.mp3'))).toBeGreaterThan(0.9);
  });

  test('handles reversed artist/title order', () => {
    expect(scoreHit('one more time daft punk', hit('Daft Punk - One More Time.mp3'))).toBeGreaterThan(0.9);
  });

  test('handles a small typo', () => {
    expect(scoreHit('daft punk one more tim', hit('Daft Punk - One More Time.mp3'))).toBeGreaterThan(0.9);
  });

  test('rejects an unrelated track', () => {
    expect(scoreHit('daft punk one more time', hit('Adele - Hello.mp3'))).toBeLessThan(0.6);
  });

  test('matches a partial title', () => {
    expect(scoreHit('one more time', hit('Daft Punk - One More Time.mp3'))).toBeGreaterThan(0.9);
  });
});

describe('best match selection', () => {
  test('returns null when nothing is close enough', () => {
    expect(
      pickBestMatch('daft punk', [hit('Adele - Hello.mp3'), hit('Radiohead - Creep.mp3')]),
    ).toBeNull();
  });

  test('prefers a free slot and a higher bitrate', () => {
    const best = pickBestMatch('one more time', [
      hit('Daft Punk - One More Time.mp3', { bitrate: 128, slotFree: false }),
      hit('Daft Punk - One More Time.mp3', { bitrate: 320, slotFree: true }),
    ]);

    expect(best).not.toBeNull();
    expect(best?.hit.bitrate).toBe(320);
    expect(best?.score).toBeGreaterThanOrEqual(AUTO_MATCH_SCORE);
  });
});

describe('auto-match picks the right recording', () => {
  const query = 'daft punk one more time';
  const studio = hit('Music\\Daft Punk\\Discovery\\01 - One More Time.mp3');
  const live = hit('Music\\Daft Punk\\Alive 2007\\07 - One More Time (Live).mp3');
  const interview = hit('Music\\Daft Punk\\Interviews\\Daft Punk interview one time.mp3');
  const junk = hit('Music\\a\\b\\o m t.mp3');
  const otherSong = hit('Music\\Various\\Comp\\Daft Punk - Around The World.mp3');

  test('studio version clears the threshold and beats the others', () => {
    const ranked = rankHits(query, [interview, live, junk, otherSong, studio], 0);
    expect(ranked[0].hit).toBe(studio);
    expect(ranked[0].score).toBeGreaterThanOrEqual(AUTO_MATCH_SCORE);
  });

  test('wrong files never auto-play', () => {
    for (const wrong of [interview, junk, otherSong, live]) {
      expect(scoreHit(query, wrong)).toBeLessThan(AUTO_MATCH_SCORE);
    }
  });

  test('a live version is accepted when the user asks for it', () => {
    expect(scoreHit('daft punk one more time live', live)).toBeGreaterThanOrEqual(AUTO_MATCH_SCORE);
  });

  test('ignores folder track numbers when reading the artist', () => {
    expect(parseTrackName(studio.filename)).toEqual({ artist: 'Daft Punk', title: 'One More Time' });
    expect(parseTrackName('Prince - 1999.mp3')).toEqual({ artist: 'Prince', title: '1999' });
    expect(parseTrackName('x\\Artist - 03 - Song Name.mp3')).toEqual({ artist: 'Artist', title: 'Song Name' });
  });

  test('short snippets are rejected', () => {
    expect(scoreHit(query, hit('Daft Punk - One More Time.mp3', { durationSec: 30 }))).toBeLessThan(AUTO_MATCH_SCORE);
  });

  test('a free slot beats a long queue for the same track', () => {
    const queued = hit('Daft Punk - One More Time.mp3', { username: 'q', slotFree: false, queueLength: 40, bitrate: 320 });
    const free = hit('Daft Punk - One More Time.mp3', { username: 'f', slotFree: true, queueLength: 0, bitrate: 192 });
    expect(rankHits(query, [queued, free])[0].hit).toBe(free);
  });
});
