/**
 * Privacy rules for the optional remote log upload (feature 7).
 *
 * The app journal and server both run this code: the client redacts before
 * anything is queued, the server redacts again before storing. It is pure and
 * has no React Native imports so the same tests cover both sides.
 */

export type RemoteLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RemoteLogEvent {
  at: number;
  level: RemoteLogLevel;
  tag: string;
  message: string;
}

export interface LogReport {
  schema: 1;
  /** Anonymous, generated on the device. Never the Soulseek account. */
  installationId: string;
  app: { version: string; platform: 'android' | 'ios' };
  events: RemoteLogEvent[];
}

export const MAX_LOG_EVENTS = 100;
export const MAX_LOG_MESSAGE = 2000;
export const MAX_LOG_TAG = 16;
const MAX_APP_VERSION = 40;

const LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);
const INSTALLATION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const TAG = /^[a-z0-9_-]{1,16}$/;

export function isInstallationId(value: unknown): value is string {
  return typeof value === 'string' && INSTALLATION_ID.test(value);
}

/* ------------------------------------------------------------------------ */
/* Redaction                                                                 */
/* ------------------------------------------------------------------------ */

const JSON_SECRET = /("(?:password|passwd|pass|secret|token|access_token|refresh_token|api[_-]?key|apikey|cookie|session|authorization)"\s*:\s*")([^"]*)(")/gi;
const SECRET_PAIR = /\b(password|passwd|pass|secret|token|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|apikey|cookie|session)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&|]+)/gi;
const AUTHORIZATION = /\b(authorization|proxy-authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,;|]+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const USERNAME_PAIR = /\b(username|user|utilisateur|peer|login)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&|]+)/gi;
/** The player logs "source 1 : <peer> — <path>". */
const SOURCE_PEER = /(\bsource\s+\d+\s*:\s*)(?:[^\s—]+|[^—|]+?)(\s*—)/g;
const SOURCE_PEER_PAREN = /(\bsource\s+\d+\s*\()([^)]+)(\))/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\\\s"'|<>]+\\)*[^\\\s"'|<>]*/g;
const UNC_PATH = /\\\\[A-Za-z0-9._-]+(?:\\[^\\\s"'|<>]+)+/g;
const UNIX_PATH = /(^|[\s("'=[])(\/(?:home|Users|root|tmp|var|data|storage|sdcard|mnt|opt|etc|private|system)\/[^\s"'<>|]+)/g;
/** A relative Soulseek path has at least two separators and a media file name. */
const MEDIA_PATH = /(^|[\s("'=[])((?:[A-Za-z0-9 _.'-]+[\\/]){2,}[^"'<>|\n]+?\.(?:mp3|flac|m4a|aac|wav|ogg|opus|wma|aiff))(?=$|[\s("'\]])/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * Removes credentials, account names and file paths while keeping what makes a
 * log line useful (state, timings, counts, error codes).
 */
export function redactLogText(text: string): string {
  return text
    .replace(JSON_SECRET, '$1[redacted]$3')
    .replace(SECRET_PAIR, '$1$2[redacted]')
    .replace(AUTHORIZATION, '$1: [redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(JWT, '[redacted-token]')
    .replace(USERNAME_PAIR, '$1$2[redacted]')
    .replace(SOURCE_PEER, '$1[redacted]$2')
    .replace(SOURCE_PEER_PAREN, '$1[redacted]$3')
    .replace(WINDOWS_PATH, '<path>')
    .replace(UNC_PATH, '<path>')
    .replace(UNIX_PATH, '$1<path>')
    .replace(MEDIA_PATH, '$1<path>')
    .replace(EMAIL, '[email]')
    .replace(IPV4, '[ip]');
}

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

export type ParseLogReport =
  | { ok: true; report: LogReport }
  | { ok: false; error: 'invalid_report' };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEvent(value: unknown): RemoteLogEvent | null {
  if (!isObject(value)) {
    return null;
  }

  const { at, level, tag, message } = value;
  if (
    typeof at !== 'number' ||
    !Number.isInteger(at) ||
    at < 0 ||
    typeof level !== 'string' ||
    !LEVELS.has(level) ||
    typeof tag !== 'string' ||
    !TAG.test(tag) ||
    typeof message !== 'string' ||
    message.length === 0 ||
    message.length > MAX_LOG_MESSAGE
  ) {
    return null;
  }

  return { at, level: level as RemoteLogLevel, tag, message: redactLogText(message) };
}

/**
 * Validates the JSON body the app posts. `expectedInstallationId` is the
 * `X-Installation-Id` header: a report may only be filed under its own id.
 */
export function parseLogReport(value: unknown, expectedInstallationId?: string): ParseLogReport {
  if (!isObject(value) || value.schema !== 1) {
    return { ok: false, error: 'invalid_report' };
  }

  const { installationId, app, events } = value;
  if (
    !isInstallationId(installationId) ||
    (expectedInstallationId !== undefined && installationId !== expectedInstallationId) ||
    !isObject(app) ||
    typeof app.version !== 'string' ||
    app.version.length === 0 ||
    app.version.length > MAX_APP_VERSION ||
    (app.platform !== 'android' && app.platform !== 'ios') ||
    !Array.isArray(events) ||
    events.length === 0 ||
    events.length > MAX_LOG_EVENTS
  ) {
    return { ok: false, error: 'invalid_report' };
  }

  const parsed: RemoteLogEvent[] = [];
  for (const event of events) {
    const clean = parseEvent(event);
    if (!clean) {
      return { ok: false, error: 'invalid_report' };
    }
    parsed.push(clean);
  }

  return {
    ok: true,
    report: {
      schema: 1,
      installationId,
      app: { version: app.version, platform: app.platform },
      events: parsed,
    },
  };
}
