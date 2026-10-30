import { messages } from '../strings';
import type { IconName } from './iconPaths';
import type { Tone } from './theme';

/** What the user can do about a failure. Screens map these to buttons. */
export type ErrorAction =
  | 'retry'
  | 'next-source'
  | 'learn-more'
  | 'reconnect'
  | 'relaunch-search';

export type ErrorKind =
  | 'peer-offline'
  | 'peer-refused'
  | 'peer-refused-sharing'
  | 'peer-unreachable'
  | 'connection-lost'
  | 'too-slow'
  | 'server-offline'
  | 'cancelled'
  | 'unsupported'
  | 'unknown';

export interface PlaybackErrorDescription {
  kind: ErrorKind;
  tone: Tone;
  icon: IconName;
  title: string;
  body: string;
  actions: ErrorAction[];
}

export interface PlaybackErrorContext {
  /** Share of the file already received (0–1), used for mid-stream losses. */
  receivedRatio?: number;
}

export const ACTION_LABELS: Record<ErrorAction, string> = {
  retry: 'Réessayer',
  'next-source': 'Source suivante',
  'learn-more': 'En savoir plus',
  reconnect: 'Se reconnecter',
  'relaunch-search': 'Relancer',
};

/** Shown by the "En savoir plus" action of a sharing refusal. */
export const SHARING_EXPLANATION = messages.sharingExplanation;

const SHARING_REASON = /shar|partag|ban|leech|no share/i;

function percentLabel(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)} %`;
}

/**
 * Maps the error strings produced by the client, the transfer and the store
 * to a human cause and the next actions (DESIGN.md §4.4).
 */
export function describePlaybackError(
  message: string | null | undefined,
  context: PlaybackErrorContext = {},
): PlaybackErrorDescription {
  const text = (message ?? '').trim();

  if (/hors ligne/i.test(text)) {
    return {
      kind: 'peer-offline',
      tone: 'bad',
      icon: 'offline',
      title: 'Pair hors ligne',
      body: messages.peerOfflineBody,
      actions: ['next-source', 'retry'],
    };
  }

  const refused = /^Refusé par le pair\s*:?\s*(.*)$/i.exec(text);

  if (refused) {
    const reason = refused[1].trim();

    if (SHARING_REASON.test(reason)) {
      return {
        kind: 'peer-refused-sharing',
        tone: 'bad',
        icon: 'lock',
        title: 'Refusé par le pair',
        body:
          'Ce pair bloque les comptes qui ne partagent rien. SoulStream ne partage pas encore de fichiers.',
        actions: ['next-source', 'learn-more'],
      };
    }

    return {
      kind: 'peer-refused',
      tone: 'bad',
      icon: 'lock',
      title: 'Refusé par le pair',
      body: reason
        ? `Le pair a refusé le transfert (« ${reason} »).`
        : 'Le pair a refusé le transfert.',
      actions: ['next-source', 'retry'],
    };
  }

  if (
    /n['’]a pas ouvert la connexion de transfert/i.test(text) ||
    /^Adresse de .* introuvable$/i.test(text) ||
    /impossible de joindre le pair/i.test(text) ||
    /le pair a fermé la connexion/i.test(text)
  ) {
    return {
      kind: 'peer-unreachable',
      tone: 'bad',
      icon: 'offline',
      title: 'Impossible de joindre le pair',
      body:
        'Un pare-feu ou un NAT bloque probablement la connexion directe entre vous et ce pair.',
      actions: ['next-source', 'retry'],
    };
  }

  if (
    /connexion au pair perdue/i.test(text) ||
    /interrompu le transfert|transfert a été interrompu/i.test(text) ||
    /le pair a signalé un échec/i.test(text) ||
    /erreur de transfert/i.test(text)
  ) {
    const received = context.receivedRatio ?? 0;

    return {
      kind: 'connection-lost',
      tone: 'bad',
      icon: 'offline',
      title: received > 0 ? `Connexion perdue à ${percentLabel(received)}` : 'Connexion perdue',
      body:
        received > 0
          ? 'Le pair a coupé le transfert. La partie déjà reçue reste lisible.'
          : 'Le pair a coupé le transfert avant l’envoi des premières données.',
      actions: ['retry', 'next-source'],
    };
  }

  if (/délai de mise en mémoire tampon dépassé/i.test(text)) {
    return {
      kind: 'too-slow',
      tone: 'warn',
      icon: 'clock',
      title: 'Pair trop lent',
      body: 'Le pair envoie les données trop lentement pour démarrer la lecture.',
      actions: ['next-source', 'retry'],
    };
  }

  if (
    /^non connecté/i.test(text) ||
    /connexion au serveur perdue/i.test(text) ||
    /^déconnecté$/i.test(text) ||
    /serveur soulseek ne répond pas/i.test(text)
  ) {
    return {
      kind: 'server-offline',
      tone: 'warn',
      icon: 'server',
      title: 'Hors ligne',
      body: messages.serverOfflineBody,
      actions: ['reconnect'],
    };
  }

  if (/annulée?$/i.test(text) || /^transfert annulé/i.test(text)) {
    return {
      kind: 'cancelled',
      tone: 'neutral',
      icon: 'x',
      title: 'Lecture annulée',
      body: 'Le transfert a été arrêté.',
      actions: ['retry'],
    };
  }

  if (/mp3/i.test(text)) {
    return {
      kind: 'unsupported',
      tone: 'warn',
      icon: 'info',
      title: 'Format non pris en charge',
      body: 'SoulStream ne lit que les fichiers MP3.',
      actions: ['next-source'],
    };
  }

  return {
    kind: 'unknown',
    tone: 'bad',
    icon: 'info',
    title: 'Lecture interrompue',
    body: text || 'Le flux audio n’a pas pu être lu.',
    actions: ['retry', 'next-source'],
  };
}
