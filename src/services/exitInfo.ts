import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

import { debugLog } from './debugLog';

/**
 * Why the app's process ended last time (Android 11+), written to the debug
 * journal at launch. Tells a low-memory kill or a native crash (which leave no
 * JavaScript trace) from a normal close. See ExitInfoModule.kt.
 */

/** Android ApplicationExitInfo.REASON_* values. */
export const ExitReason = {
  UNKNOWN: 0,
  EXIT_SELF: 1,
  SIGNALED: 2,
  LOW_MEMORY: 3,
  CRASH: 4,
  CRASH_NATIVE: 5,
  ANR: 6,
  INITIALIZATION_FAILURE: 7,
  PERMISSION_CHANGE: 8,
  EXCESSIVE_RESOURCE_USAGE: 9,
  USER_REQUESTED: 10,
  USER_STOPPED: 11,
  DEPENDENCY_DIED: 12,
  OTHER: 13,
  FREEZER: 14,
  PACKAGE_STATE_CHANGE: 15,
  PACKAGE_UPDATED: 16,
} as const;

export interface ProcessExit {
  timestamp: number;
  reason: number;
  status: number;
  importance: number;
  /** Memory at exit, in KB (0 when unknown). */
  pss: number;
  rss: number;
  description: string | null;
  trace?: string;
}

interface ExitInfoNative {
  getRecentExits(max: number): Promise<ProcessExit[]>;
  takeJavaCrash(): Promise<string | null>;
}

const LAST_SEEN_KEY = '@soulstream/last-exit-seen/v1';

const LABELS: Record<number, string> = {
  [ExitReason.EXIT_SELF]: 'fermeture par l’application',
  [ExitReason.SIGNALED]: 'arrêté par le système (signal)',
  [ExitReason.LOW_MEMORY]: 'arrêté par Android : mémoire insuffisante',
  [ExitReason.CRASH]: 'plantage (Java/Kotlin ou JavaScript)',
  [ExitReason.CRASH_NATIVE]: 'plantage dans du code natif',
  [ExitReason.ANR]: 'application bloquée (ANR)',
  [ExitReason.INITIALIZATION_FAILURE]: 'échec au démarrage',
  [ExitReason.EXCESSIVE_RESOURCE_USAGE]: 'arrêté par Android : trop de ressources utilisées',
  [ExitReason.USER_REQUESTED]: 'fermeture demandée (réglages, mise à jour)',
  [ExitReason.USER_STOPPED]: 'arrêt forcé par l’utilisateur',
  [ExitReason.DEPENDENCY_DIED]: 'un service dont l’app dépend s’est arrêté',
  [ExitReason.OTHER]: 'arrêté par le système (autre)',
  [ExitReason.FREEZER]: 'gelé par le système',
  [ExitReason.PACKAGE_STATE_CHANGE]: 'application désactivée ou modifiée',
  [ExitReason.PACKAGE_UPDATED]: 'mise à jour de l’application',
};

/** Exits the user did not ask for and that are worth a notice. */
const ABNORMAL = new Set<number>([
  ExitReason.SIGNALED,
  ExitReason.LOW_MEMORY,
  ExitReason.CRASH,
  ExitReason.CRASH_NATIVE,
  ExitReason.ANR,
  ExitReason.INITIALIZATION_FAILURE,
  ExitReason.EXCESSIVE_RESOURCE_USAGE,
]);

export function exitLabel(reason: number): string {
  return LABELS[reason] ?? `raison ${reason}`;
}

export function isAbnormalExit(exit: ProcessExit): boolean {
  return ABNORMAL.has(exit.reason);
}

export function describeExit(exit: ProcessExit): string {
  const when = new Date(exit.timestamp).toLocaleString('fr-FR');
  const memory = exit.pss > 0 ? `, mémoire ${Math.round(exit.pss / 1024)} Mo` : '';
  const detail = exit.description ? ` (${exit.description})` : '';
  return `fin du ${when} : ${exitLabel(exit.reason)}${detail}${memory}`;
}

/** Exits newer than `lastSeen`, oldest first. */
export function newExits(exits: ProcessExit[], lastSeen: number): ProcessExit[] {
  return exits.filter(exit => exit.timestamp > lastSeen).sort((a, b) => a.timestamp - b.timestamp);
}

function nativeModule(): ExitInfoNative | null {
  return (NativeModules.SoulStreamExitInfo as ExitInfoNative | undefined) ?? null;
}

/**
 * Logs how the previous runs ended and returns a notice for the user when
 * the last one was abnormal (null otherwise).
 */
export async function reportPreviousExits(): Promise<string | null> {
  const native = nativeModule();
  if (!native) {
    return null;
  }

  try {
    const javaCrash = await native.takeJavaCrash();
    if (javaCrash) {
      const [, thread, ...stack] = javaCrash.split('\n');
      debugLog('app', `— plantage Java (fil ${thread}) : ${stack.slice(0, 12).join(' ← ')}`);
    }

    const exits = await native.getRecentExits(5);
    const stored = await AsyncStorage.getItem(LAST_SEEN_KEY);
    const newest = exits.reduce((max, exit) => Math.max(max, exit.timestamp), 0);

    if (newest > 0) {
      await AsyncStorage.setItem(LAST_SEEN_KEY, String(newest));
    }

    // First launch of this version: only remember where we are.
    if (stored === null) {
      return javaCrash ? 'SoulStream s’est fermé après une erreur. Détails dans Réglages → Journal de débogage.' : null;
    }

    const fresh = newExits(exits, Number(stored) || 0);
    for (const exit of fresh) {
      debugLog('app', `— ${describeExit(exit)}`);
      if (exit.trace) {
        debugLog('app', `  trace : ${exit.trace.slice(0, 1500)}`);
      }
    }

    const last = fresh[fresh.length - 1];
    if (last && isAbnormalExit(last)) {
      return last.reason === ExitReason.LOW_MEMORY
        ? 'Android a fermé SoulStream faute de mémoire. Détails dans Réglages → Journal de débogage.'
        : `SoulStream s’est arrêté (${exitLabel(last.reason)}). Détails dans Réglages → Journal de débogage.`;
    }
    return javaCrash ? 'SoulStream s’est fermé après une erreur. Détails dans Réglages → Journal de débogage.' : null;
  } catch (error) {
    debugLog('app', `raisons de fermeture illisibles : ${String(error)}`);
    return null;
  }
}
