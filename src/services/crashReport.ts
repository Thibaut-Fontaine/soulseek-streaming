import AsyncStorage from '@react-native-async-storage/async-storage';

import { debugLog, getDebugLog, formatLogTime } from './debugLog';

/**
 * Keeps a trace of JavaScript crashes. In a release build an uncaught error
 * closes the app and the in-memory journal is lost with it, so the error and
 * the last journal lines are saved first, then shown on the next launch
 * (Réglages → Journal).
 */

const CRASH_KEY = '@soulstream/last-crash/v1';
const LOG_LINES = 80;
/** Longest wait for the save before letting the app close. */
const SAVE_TIMEOUT_MS = 1500;

export interface CrashReport {
  at: number;
  fatal: boolean;
  message: string;
  stack?: string;
  /** Journal lines just before the crash, oldest first. */
  log: string[];
}

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): ErrorHandler;
  setGlobalHandler(handler: ErrorHandler): void;
}

let installed = false;

export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack };
  }
  return { message: String(error) };
}

export function buildCrashReport(error: unknown, fatal: boolean): CrashReport {
  const { message, stack } = describeError(error);
  return {
    at: Date.now(),
    fatal,
    message,
    stack,
    log: getDebugLog()
      .slice(-LOG_LINES)
      .map(entry => `${formatLogTime(entry.at)} ${entry.tag.padEnd(8)} ${entry.message}`),
  };
}

/** Call once, as early as possible (index.js). */
export function installCrashHandler(): void {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;

  if (installed || !errorUtils) {
    return;
  }

  installed = true;
  const previous = errorUtils.getGlobalHandler();

  errorUtils.setGlobalHandler((error, isFatal) => {
    const report = buildCrashReport(error, isFatal === true);
    debugLog('app', `erreur${report.fatal ? ' fatale' : ''} : ${report.message}`);

    if (!report.fatal) {
      previous(error, isFatal);
      return;
    }

    // Save before the default handler closes the app, but never hang on it.
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        previous(error, isFatal);
      }
    };
    setTimeout(finish, SAVE_TIMEOUT_MS);
    AsyncStorage.setItem(CRASH_KEY, JSON.stringify(report)).then(finish, finish);
  });
}

/** The crash saved by the previous run, if any; it is removed once read. */
export async function takeLastCrash(): Promise<CrashReport | null> {
  try {
    const raw = await AsyncStorage.getItem(CRASH_KEY);

    if (!raw) {
      return null;
    }

    await AsyncStorage.removeItem(CRASH_KEY);
    const report = JSON.parse(raw) as CrashReport;
    return typeof report?.message === 'string' && Array.isArray(report.log) ? report : null;
  } catch {
    return null;
  }
}
