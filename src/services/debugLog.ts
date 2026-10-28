/**
 * In-memory debug journal, shown in Réglages → Journal de débogage.
 *
 * Shows what happened when a track does not play; keeps the last MAX_ENTRIES
 * lines. Each line also goes to logcat (tag ReactNativeJS).
 */

export type LogTag = 'net' | 'peer' | 'transfer' | 'http' | 'player' | 'play' | 'app';

export interface LogEntry {
  at: number;
  tag: LogTag;
  message: string;
}

const MAX_ENTRIES = 1500;

const entries: LogEntry[] = [];
const listeners = new Set<() => void>();
let notifyScheduled = false;

export function debugLog(tag: LogTag, message: string): void {
  entries.push({ at: Date.now(), tag, message });

  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }

  // Release builds too: `adb logcat -s ReactNativeJS` reads the journal from
  // a phone over Wi-Fi debugging, without opening the journal screen.
  console.log(`[${tag}]`, message);

  // Coalesce bursts (e.g. many search responses) into one UI update.
  if (!notifyScheduled && listeners.size > 0) {
    notifyScheduled = true;
    setTimeout(() => {
      notifyScheduled = false;
      listeners.forEach(listener => listener());
    }, 250);
  }
}

export function getDebugLog(): readonly LogEntry[] {
  return entries;
}

export function clearDebugLog(): void {
  entries.length = 0;
  listeners.forEach(listener => listener());
}

export function subscribeDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

export function formatLogTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

export function formatDebugLog(header = ''): string {
  const lines = entries.map(
    entry => `${formatLogTime(entry.at)} ${entry.tag.padEnd(8)} ${entry.message}`,
  );
  return (header ? header + '\n\n' : '') + lines.join('\n');
}
