/* eslint-disable no-bitwise */
import type { TextStyle } from 'react-native';

import type { SearchHit } from '../core/types';

/** Raw palette. Screens should use the semantic `colors` below. */
export const palette = {
  black: '#0B0A0F',
  elev1: '#141219',
  elev2: '#1D1A24',
  elev3: '#28242F',
  line: 'rgba(255,255,255,0.08)',
  white: '#FFFFFF',
  text2: '#B9B4C4',
  text3: '#7D778A',
  /** Brand colour, shared with the app icon (tools/icon/icon.mjs). */
  amber: '#FFB627',
  amberPress: '#F09D0E',
  amberSoft: 'rgba(255,182,39,0.16)',
  green: '#3DDC84',
  orange: '#FF8A3D',
  red: '#FF5C6C',
  sky: '#5CC8FF',
};

export const colors = {
  bg: palette.black,
  surface: palette.elev1,
  surfaceAlt: palette.elev2,
  surfaceHigh: palette.elev3,
  border: palette.line,
  text: palette.white,
  textMuted: palette.text2,
  textDim: palette.text3,
  textOnMedia: 'rgba(255,255,255,0.72)',
  accent: palette.amber,
  accentPressed: palette.amberPress,
  accentSoft: palette.amberSoft,
  /** Black label on amber, about 11:1 contrast. */
  onAccent: palette.black,
  success: palette.green,
  successSoft: 'rgba(61,220,132,0.14)',
  /** Orange, not amber: amber is the accent. */
  warning: palette.orange,
  warningSoft: 'rgba(255,138,61,0.14)',
  danger: palette.red,
  dangerSoft: 'rgba(255,92,108,0.14)',
  info: palette.sky,
  infoSoft: 'rgba(92,200,255,0.14)',
  trackBg: 'rgba(255,255,255,0.14)',
  trackBuffered: 'rgba(255,255,255,0.32)',
  trackEdge: 'rgba(255,255,255,0.7)',
  scrim: 'rgba(0,0,0,0.28)',
  overlay: 'rgba(6,7,11,0.72)',
  searchField: '#FFFFFF',
  searchFieldText: '#0B0A0F',
  searchFieldPlaceholder: '#6B6577',

  // Legacy aliases, kept so older code compiles during the migration.
  // TODO(phase-3): remove.
  bgSoft: palette.elev1,
  card: palette.elev1,
  cardAlt: palette.elev2,
  accentBright: palette.amber,
  cyan: palette.sky,
  cyanSoft: 'rgba(92,200,255,0.14)',
};

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'info' | 'neutral';

/** Foreground / soft background pair for each status tone. */
export const tones: Record<Tone, { fg: string; bg: string }> = {
  accent: { fg: colors.accent, bg: colors.accentSoft },
  good: { fg: colors.success, bg: colors.successSoft },
  warn: { fg: colors.warning, bg: colors.warningSoft },
  bad: { fg: colors.danger, bg: colors.dangerSoft },
  info: { fg: colors.info, bg: colors.infoSoft },
  neutral: { fg: colors.textMuted, bg: colors.surfaceHigh },
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

/** Horizontal screen padding. */
export const gutter = spacing.lg;

export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

/**
 * Font families. `undefined` means the platform system font; the type scale
 * relies on heavy weights so it reads well without a bundled font. To bundle
 * one later (e.g. Figtree), link it via react-native.config.js assets and set
 * the family names here.
 */
export const fonts: Record<'regular' | 'semibold' | 'bold' | 'heavy' | 'black', string | undefined> = {
  regular: undefined,
  semibold: undefined,
  bold: undefined,
  heavy: undefined,
  black: undefined,
};

export const type = {
  display: { fontFamily: fonts.black, fontWeight: '900', fontSize: 32, lineHeight: 36, letterSpacing: -1 },
  title: { fontFamily: fonts.heavy, fontWeight: '800', fontSize: 24, lineHeight: 28, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.heavy, fontWeight: '800', fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  body: { fontFamily: fonts.semibold, fontWeight: '600', fontSize: 15, lineHeight: 20 },
  bodySm: { fontFamily: fonts.regular, fontWeight: '400', fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontWeight: '400', fontSize: 12, lineHeight: 16 },
  eyebrow: {
    fontFamily: fonts.heavy,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  badge: { fontFamily: fonts.bold, fontWeight: '700', fontSize: 11 },
  mono: { fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export const motion = { fast: 120, base: 220, slow: 360 };

export interface CoverColors {
  deep: string;
  mid: string;
  hi: string;
  /** Start colour of full-screen gradients (Now Playing, hero cards). */
  bgTop: string;
}

/** Deterministic HSL palette per track, so the UI has colour without artwork. */
export function coverPalette(seed: string): CoverColors {
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const hue = hash % 360;
  const sat = 55 + ((hash >>> 9) % 25);

  return {
    deep: `hsl(${hue}, ${sat}%, 22%)`,
    mid: `hsl(${(hue + 28) % 360}, ${Math.min(100, sat + 10)}%, 42%)`,
    hi: `hsl(${(hue + 52) % 360}, ${Math.min(100, sat + 20)}%, 64%)`,
    bgTop: `hsl(${hue}, ${sat - 5}%, 30%)`,
  };
}

/** Seed used for every generated cover of a given file. */
export function coverSeed(hit: { username: string; filename: string }): string {
  return `${hit.username}:${hit.filename}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }

  const mb = bytes / (1024 * 1024);

  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2).replace('.', ',')} Go`;
  }

  if (mb >= 10) {
    return `${mb.toFixed(0)} Mo`;
  }

  return `${mb.toFixed(1).replace('.', ',')} Mo`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return '—';
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatQuality(hit: SearchHit): string {
  const parts: string[] = [];

  if (hit.bitDepth && hit.sampleRate) {
    parts.push(`${hit.bitDepth} bit`);
    parts.push(`${(hit.sampleRate / 1000).toFixed(1).replace('.', ',')} kHz`);
  } else if (hit.bitrate) {
    parts.push(`${hit.bitrate} kb/s`);
  } else if (hit.sampleRate) {
    parts.push(`${(hit.sampleRate / 1000).toFixed(1).replace('.', ',')} kHz`);
  }

  if (hit.vbr) {
    parts.push('VBR');
  }

  parts.push(hit.extension.toUpperCase());

  return parts.join(' · ');
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '—';
  }

  const mb = bytesPerSecond / (1024 * 1024);

  if (mb >= 1) {
    return `${mb.toFixed(1).replace('.', ',')} Mo/s`;
  }

  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} Ko/s`;
}

export function percent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, value / total));
}
