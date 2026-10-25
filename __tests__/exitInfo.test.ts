import { describeExit, ExitReason, isAbnormalExit, newExits } from '../src/services/exitInfo';
import type { ProcessExit } from '../src/services/exitInfo';

function exit(timestamp: number, reason: number, extra: Partial<ProcessExit> = {}): ProcessExit {
  return { timestamp, reason, status: 0, importance: 100, pss: 0, rss: 0, description: null, ...extra };
}

describe('process exit reasons', () => {
  test('only exits newer than the last one seen, oldest first', () => {
    const exits = [exit(30, ExitReason.LOW_MEMORY), exit(10, ExitReason.USER_REQUESTED), exit(20, ExitReason.CRASH)];
    expect(newExits(exits, 15).map(e => e.timestamp)).toEqual([20, 30]);
  });

  test('memory kills and crashes are abnormal, user actions are not', () => {
    expect(isAbnormalExit(exit(1, ExitReason.LOW_MEMORY))).toBe(true);
    expect(isAbnormalExit(exit(1, ExitReason.CRASH_NATIVE))).toBe(true);
    expect(isAbnormalExit(exit(1, ExitReason.ANR))).toBe(true);
    expect(isAbnormalExit(exit(1, ExitReason.USER_REQUESTED))).toBe(false);
    expect(isAbnormalExit(exit(1, ExitReason.PACKAGE_UPDATED))).toBe(false);
  });

  test('describes the reason and the memory in use', () => {
    const text = describeExit(exit(Date.UTC(2026, 9, 25), ExitReason.LOW_MEMORY, { pss: 412_000, description: 'lmk' }));
    expect(text).toContain('mémoire insuffisante');
    expect(text).toContain('(lmk)');
    expect(text).toContain('402 Mo');
  });
});
