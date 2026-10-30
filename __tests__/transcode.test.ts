import type { RankedHit } from '../src/core/search';
import type { SearchHit } from '../src/core/types';
import {
  TRANSCODE_TARGET_KBPS,
  choosePlaybackSource,
  encoderFailureFallback,
  sourceBitrateKbps,
} from '../src/core/transcode';

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    username: 'peer',
    filename: 'Music\\Artist\\Album\\01 - Song.mp3',
    size: 5_000_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 500_000,
    queueLength: 0,
    bitrate: 320,
    durationSec: 240,
    ...overrides,
  };
}

function ranked(searchHit: SearchHit, rank = 1): RankedHit {
  return { hit: searchHit, score: 0.9, rank };
}

describe('source bitrate', () => {
  test('uses the announced bitrate, or estimates it from size and duration', () => {
    expect(sourceBitrateKbps(hit({ bitrate: 96 }))).toBe(96);
    // 5 MB in 240 s ≈ 175 kbps.
    expect(sourceBitrateKbps(hit({ bitrate: undefined }))).toBeGreaterThan(160);
    expect(sourceBitrateKbps(hit({ bitrate: undefined, durationSec: 0 }))).toBeUndefined();
  });
});

describe('playback source selection', () => {
  test('prefers the smallest bitrate source, then the smallest file', () => {
    const choice = choosePlaybackSource([
      ranked(hit({ username: 'big', bitrate: 320 }), 10),
      ranked(hit({ username: 'small', bitrate: 96, size: 3_000_000 }), 1),
      ranked(hit({ username: 'middle', bitrate: 192 }), 5),
    ]);

    expect(choice).toMatchObject({
      hit: { username: 'small' },
      action: 'original',
      reason: 'small-source',
    });
  });

  test('transcodes when every source is above the small threshold', () => {
    const choice = choosePlaybackSource([
      ranked(hit({ username: 'big', bitrate: 320 })),
      ranked(hit({ username: 'middle', bitrate: 192 })),
    ]);

    expect(choice).toMatchObject({
      hit: { username: 'middle' },
      action: 'transcode',
      reason: 'no-small-source',
      targetKbps: TRANSCODE_TARGET_KBPS,
    });
  });

  test('a slow uploader loses to a faster one, then transcodes', () => {
    const choice = choosePlaybackSource([
      ranked(hit({ username: 'small-slow', bitrate: 96, avgSpeed: 4000 }), 10),
      ranked(hit({ username: 'fast', bitrate: 320, avgSpeed: 400_000 }), 1),
    ]);

    expect(choice).toMatchObject({
      hit: { username: 'fast' },
      action: 'transcode',
      reason: 'slow-uploader',
    });
  });

  test('keeps the small source when no faster one exists', () => {
    const choice = choosePlaybackSource([
      ranked(hit({ username: 'small-slow', bitrate: 96, avgSpeed: 4000 })),
    ]);

    expect(choice).toMatchObject({
      hit: { username: 'small-slow' },
      action: 'transcode',
      reason: 'slow-uploader',
    });
  });

  test('an unknown bitrate is played as is rather than guessed down', () => {
    const choice = choosePlaybackSource([
      ranked(hit({ username: 'unknown', bitrate: undefined, durationSec: 0 })),
    ]);

    expect(choice).toMatchObject({
      hit: { username: 'unknown' },
      action: 'original',
      reason: 'unknown-bitrate',
    });
  });

  test('no source means no plan', () => {
    expect(choosePlaybackSource([])).toBeNull();
  });

  test('an encoder failure falls back to the original source', () => {
    const choice = choosePlaybackSource([
      ranked(hit({ username: 'middle', bitrate: 192 })),
    ]);
    expect(choice?.action).toBe('transcode');

    const fallback = encoderFailureFallback(choice!);
    expect(fallback).toMatchObject({
      hit: { username: 'middle' },
      action: 'original',
      reason: 'encoder-failed',
    });
    expect(encoderFailureFallback(null)).toBeNull();
  });

  test('the policy is configurable and documented', () => {
    const choice = choosePlaybackSource(
      [ranked(hit({ username: 'middle', bitrate: 192 }))],
      { smallSourceKbps: 256, targetKbps: 128 },
    );
    expect(choice).toMatchObject({ action: 'original', reason: 'small-source' });
    expect(TRANSCODE_TARGET_KBPS).toBe(94);
  });
});
