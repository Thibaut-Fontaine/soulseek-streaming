/**
 * Notices when the JS thread was blocked: a repeating timer measures how
 * late it fires. Long delays go to the debug journal with what the app was
 * doing, so a report from a slow phone says where the lag came from.
 */

import { debugLog } from './debugLog';

export interface StallWatcherOptions {
  intervalMs?: number;
  thresholdMs?: number;
  now?: () => number;
  /** Timers stop in the background; a resume must not look like a stall. */
  isActive?: () => boolean;
  /** What the app is doing, e.g. "onglet search, titre preparing". */
  context?: () => string;
}

export interface StallWatcher {
  stop(): void;
  /** Call when the app comes back to the foreground: timers were paused. */
  reset(): void;
}

export function startStallWatcher({
  // 250 ms is enough to catch 300 ms stalls; each tick is a bridge call.
  intervalMs = 250,
  thresholdMs = 300,
  now = Date.now,
  isActive = () => true,
  context = () => '',
}: StallWatcherOptions = {}): StallWatcher {
  let last = now();
  let wasActive = isActive();

  const timer = setInterval(() => {
    const at = now();
    const late = at - last - intervalMs;
    const active = isActive();

    if (active && wasActive && late >= thresholdMs) {
      const where = context();
      debugLog('perf', `fil JS bloqué ${Math.round(late)} ms${where ? ` (${where})` : ''}`);
    }

    last = at;
    wasActive = active;
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
    reset: () => {
      last = now();
    },
  };
}
