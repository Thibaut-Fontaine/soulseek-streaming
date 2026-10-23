import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';

import { colors, coverPalette } from './theme';

export function CoverArt({
  seed,
  title,
  size,
  style,
}: {
  seed: string;
  title: string;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [base, mid, accent] = coverPalette(seed);
  const letter = (title.trim().charAt(0) || '♪').toUpperCase();

  return (
    <View
      style={[
        styles.cover,
        {
          width: size,
          height: size,
          borderRadius: size * 0.16,
          backgroundColor: base,
        },
        style,
      ]}>
      <View
        style={{
          position: 'absolute',
          width: size * 0.9,
          height: size * 0.9,
          borderRadius: size * 0.45,
          backgroundColor: mid,
          right: -size * 0.24,
          top: -size * 0.24,
          opacity: 0.9,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.55,
          height: size * 0.55,
          borderRadius: size * 0.18,
          backgroundColor: accent,
          left: size * 0.14,
          bottom: -size * 0.18,
          opacity: 0.16,
        }}
      />
      <Text style={[styles.coverLetter, { fontSize: size * 0.38, color: accent }]}>
        {letter}
      </Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        (disabled || loading) && styles.primaryButtonDisabled,
        pressed && !disabled && styles.primaryButtonPressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={styles.primaryButtonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  danger,
  style,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghostButton,
        danger && styles.ghostButtonDanger,
        pressed && { opacity: 0.7 },
        style,
      ]}>
      <Text style={[styles.ghostButtonLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  glyph,
  onPress,
  size = 52,
  variant = 'solid',
  disabled,
  accessibilityLabel,
}: {
  glyph: string;
  onPress: () => void;
  size?: number;
  variant?: 'solid' | 'plain' | 'accent';
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        variant === 'solid' && styles.iconSolid,
        variant === 'accent' && styles.iconAccent,
        disabled && { opacity: 0.35 },
        pressed && !disabled && { transform: [{ scale: 0.94 }] },
      ]}>
      <Text
        style={[
          styles.iconGlyph,
          { fontSize: size * 0.4 },
          variant === 'accent' && { color: '#ffffff' },
        ]}>
        {glyph}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'muted' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    muted: { bg: colors.cardAlt, fg: colors.textMuted },
    success: { bg: 'rgba(52, 211, 153, 0.12)', fg: colors.success },
    warning: { bg: 'rgba(251, 191, 36, 0.12)', fg: colors.warning },
    danger: { bg: 'rgba(248, 113, 113, 0.12)', fg: colors.danger },
    accent: { bg: colors.accentSoft, fg: colors.accentBright },
  } as const;

  const palette = tones[tone];

  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      <Text style={[styles.chipLabel, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function ProgressBar({
  value,
  buffered,
  onSeek,
  height = 4,
  style,
}: {
  value: number;
  buffered?: number;
  onSeek?: (ratio: number) => void;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [width, setWidth] = React.useState(0);

  const handlePress = (event: GestureResponderEvent) => {
    if (!onSeek || width <= 0) {
      return;
    }

    onSeek(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)));
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={!onSeek}
      style={[styles.progressTrack, { height, borderRadius: height / 2 }, style]}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {buffered !== undefined && buffered > 0 ? (
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(100, buffered * 100)}%`,
              backgroundColor: 'rgba(255,255,255,0.18)',
              borderRadius: height / 2,
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.progressFill,
          {
            width: `${Math.min(100, Math.max(0, value) * 100)}%`,
            borderRadius: height / 2,
            backgroundColor: colors.accentBright,
          },
        ]}
      />
    </Pressable>
  );
}

export function EmptyState({
  glyph,
  title,
  body,
}: {
  glyph: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyGlyph}>{glyph}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coverLetter: {
    fontWeight: '700',
    opacity: 0.9,
  },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryButtonPressed: {
    backgroundColor: '#7c4de0',
    transform: [{ scale: 0.99 }],
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  ghostButton: {
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  ghostButtonDanger: {
    borderColor: 'rgba(248, 113, 113, 0.45)',
  },
  ghostButtonLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSolid: {
    backgroundColor: colors.cardAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconAccent: {
    backgroundColor: colors.accent,
  },
  iconGlyph: {
    color: colors.text,
    fontWeight: '600',
    includeFontPadding: false,
  },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  progressTrack: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  emptyGlyph: {
    fontSize: 40,
    color: colors.accent,
    marginBottom: 12,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
});
