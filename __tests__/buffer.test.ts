import { bufferTargetFor } from '../src/core/buffer';

const KiB = 1024;
const MiB = 1024 * 1024;

describe('bufferTargetFor', () => {
  test('never asks for more than the file itself', () => {
    expect(bufferTargetFor(100 * KiB, 0.5)).toBe(100 * KiB);
  });

  test('the default 500 KiB cap applies to normal tracks', () => {
    // 15 % of a 10 MB track is 1.5 MB: the setting is the ceiling.
    expect(bufferTargetFor(10 * MiB, 0.5)).toBe(0.5 * MiB);
  });

  test('a proportional target is used when it is smaller than the cap', () => {
    // 15 % of 2 MB = 300 KB, between the 256 KB floor and the 500 KB cap.
    expect(bufferTargetFor(2 * MiB, 0.5)).toBe(Math.floor(2 * MiB * 0.15));
  });

  test('the cap follows the setting, still with a 256 KiB floor', () => {
    expect(bufferTargetFor(10 * MiB, 0.25)).toBe(256 * KiB);
    expect(bufferTargetFor(10 * MiB, 2)).toBe(Math.floor(10 * MiB * 0.15));
  });

  test('falls back to 256 KiB when the size is unknown', () => {
    expect(bufferTargetFor(0, 0.5)).toBe(256 * KiB);
    expect(bufferTargetFor(-1, 0.5)).toBe(256 * KiB);
  });
});
