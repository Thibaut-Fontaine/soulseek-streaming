import { clearDebugLog, getDebugLog } from '../src/services/debugLog';
import { startStallWatcher } from '../src/services/stallWatcher';

describe('stall watcher', () => {
  let clock = 0;
  let active = true;
  let watcher: ReturnType<typeof startStallWatcher> | null = null;

  // Moves the fake clock and the timers together; `extra` is time the JS
  // thread spent blocked before the next tick could run.
  const tick = (extra = 0) => {
    clock += 100 + extra;
    jest.advanceTimersByTime(100);
  };
  const perfLines = () => getDebugLog().filter(entry => entry.tag === 'perf');

  beforeEach(() => {
    jest.useFakeTimers();
    clearDebugLog();
    clock = 0;
    active = true;
    watcher = startStallWatcher({
      intervalMs: 100,
      now: () => clock,
      isActive: () => active,
      context: () => 'onglet search, titre preparing',
    });
  });

  afterEach(() => {
    watcher?.stop();
    jest.useRealTimers();
  });

  test('ticks on time log nothing', () => {
    for (let i = 0; i < 10; i++) {
      tick(5);
    }
    expect(perfLines()).toHaveLength(0);
  });

  test('a late tick logs how long the JS thread was blocked, with the context', () => {
    tick();
    tick(742);
    expect(perfLines()).toHaveLength(1);
    expect(perfLines()[0].message).toBe('fil JS bloqué 742 ms (onglet search, titre preparing)');
  });

  test('short delays under the threshold are ignored', () => {
    tick(299);
    expect(perfLines()).toHaveLength(0);
  });

  test('stop() ends the watching', () => {
    watcher?.stop();
    tick(1000);
    expect(perfLines()).toHaveLength(0);
  });

  test('a resume with no tick seen in the background is not a stall, once reset', () => {
    // Timers pause in the background: no tick sees the app inactive.
    clock += 60_000;
    watcher?.reset();
    tick();
    expect(perfLines()).toHaveLength(0);
  });

  test('the gap while the app was in the background is not a stall', () => {
    active = false;
    tick(60_000);
    active = true;
    tick(30_000);
    tick();
    expect(perfLines()).toHaveLength(0);
  });
});
