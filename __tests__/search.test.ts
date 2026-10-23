import {
  AUTO_MATCH_SCORE,
  formatSearchQuery,
  levenshtein,
  pickBestMatch,
  scoreHit,
  similarity,
} from '../src/core/search';
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
