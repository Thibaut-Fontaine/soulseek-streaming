/* eslint-disable no-bitwise */
import type { SearchHit } from '../core/types';

export const colors = {
  bg: '#07080c',
  bgSoft: '#0c0e15',
  card: '#131622',
  cardAlt: '#191d2b',
  border: '#242a3b',
  text: '#f5f6fa',
  textMuted: '#9ba3b7',
  textDim: '#6c7489',
  accent: '#8b5cf6',
  accentBright: '#a78bfa',
  accentSoft: '#241a44',
  cyan: '#22d3ee',
  cyanSoft: '#0e2f38',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
  overlay: 'rgba(6, 7, 11, 0.72)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

const COVER_PALETTES: Array<[string, string, string]> = [
  ['#2b1b4d', '#4c2a85', '#a78bfa'],
  ['#0e2f38', '#164e63', '#22d3ee'],
  ['#3b1d2e', '#6b2445', '#f472b6'],
  ['#1c2e1f', '#2f5233', '#86efac'],
  ['#3a2a12', '#6b4b1d', '#fcd34d'],
  ['#2a1d3d', '#4a2f6b', '#c4b5fd'],
];

export function coverPalette(seed: string): [string, string, string] {
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return COVER_PALETTES[hash % COVER_PALETTES.length];
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
