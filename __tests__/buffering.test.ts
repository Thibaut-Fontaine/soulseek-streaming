import {
  AUTO_BUFFER_MAX,
  AUTO_BUFFER_MIN,
  autoBufferReached,
  autoBufferTarget,
  fixedBufferTarget,
  playbackBytesPerSecond,
} from '../src/core/buffering';

// 320 kbps: 40,000 bytes per second.
const FILE = { size: 8_000_000, bitrate: 320 };
const PLAY = 40_000;

describe('automatic start buffer', () => {
  test('0.5 MB from a fast peer, 1 MB from a slow one', () => {
    expect(autoBufferTarget(FILE.size, PLAY * 10, PLAY)).toBe(AUTO_BUFFER_MIN);
    expect(autoBufferTarget(FILE.size, PLAY * 4, PLAY)).toBe(AUTO_BUFFER_MIN);
    expect(autoBufferTarget(FILE.size, PLAY * 1.5, PLAY)).toBe(AUTO_BUFFER_MAX);
    expect(autoBufferTarget(FILE.size, PLAY * 0.5, PLAY)).toBe(AUTO_BUFFER_MAX);
  });

  test('scales between the two', () => {
    const middle = autoBufferTarget(FILE.size, PLAY * 2.75, PLAY);
    expect(middle).toBe((AUTO_BUFFER_MIN + AUTO_BUFFER_MAX) / 2);
  });

  test('waits for the maximum while the rate is unknown', () => {
    expect(autoBufferTarget(FILE.size, null, PLAY)).toBe(AUTO_BUFFER_MAX);
    // 600 KB in 100 ms looks fast but is too soon to trust.
    expect(autoBufferReached(600_000, 100, FILE)).toBe(false);
  });

  test('never asks for more than the file', () => {
    expect(autoBufferTarget(300_000, null, PLAY)).toBe(300_000);
    expect(autoBufferReached(300_000, 50, { size: 300_000, bitrate: 320 })).toBe(true);
  });

  test('starts at 0.5 MB from a fast peer, later from a slow one', () => {
    // 600 KB in 1 s: 15x the playback rate.
    expect(autoBufferReached(600_000, 1000, FILE)).toBe(true);
    // 600 KB in 10 s: 1.5x, needs 1 MB.
    expect(autoBufferReached(600_000, 10_000, FILE)).toBe(false);
    expect(autoBufferReached(AUTO_BUFFER_MAX, 20_000, FILE)).toBe(true);
  });

  test('playback rate from duration first, then bitrate', () => {
    expect(playbackBytesPerSecond({ size: 4_000_000, durationSec: 200, bitrate: 320 })).toBe(20_000);
    expect(playbackBytesPerSecond({ size: 4_000_000, bitrate: 128 })).toBe(16_000);
    expect(playbackBytesPerSecond({ size: 4_000_000 })).toBe(40_000);
  });
});

describe('fixed start buffer', () => {
  test('keeps the previous rule', () => {
    expect(fixedBufferTarget(0, 2)).toBe(256 * 1024);
    expect(fixedBufferTarget(8_000_000, 2)).toBe(1_200_000);
    expect(fixedBufferTarget(20_000_000, 2)).toBe(2 * 1024 * 1024);
  });
});
