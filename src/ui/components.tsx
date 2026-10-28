import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  PanResponder,
  PixelRatio,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import type { Artwork } from '../core/catalogTypes';
import type { ConnectionState } from '../core/soulseekClient';
import { pickArtwork } from './catalogFormat';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { colors, coverPalette, motion, radius, spacing, tones, type } from './theme';
import type { Tone } from './theme';

// ---------------------------------------------------------------------------
// Cover art

export const CoverArt = React.memo(function CoverArt({
  seed,
  title,
  size,
  rounded = 'md',
  style,
}: {
  seed: string;
  title: string;
  size: number;
  rounded?: 'xs' | 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const palette = coverPalette(seed);
  const letter = (title.trim().charAt(0) || '♪').toUpperCase();
  const box = React.useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: rounded === 'xs' ? 4 : rounded === 'sm' ? radius.sm : Math.max(radius.sm, size * 0.06),
    }),
    [size, rounded],
  );
  const letterStyle = React.useMemo(
    () => ({ fontSize: size * 0.4, lineHeight: size * 0.5 }),
    [size],
  );

  return (
    <View style={[styles.cover, box, style]}>
      <LinearGradient
        colors={[palette.hi, palette.mid, palette.deep]}
        start={GRADIENT_TOP_RIGHT}
        end={GRADIENT_BOTTOM_LEFT}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={COVER_SHEEN}
        start={GRADIENT_TOP_RIGHT}
        end={GRADIENT_CENTER}
        style={StyleSheet.absoluteFill}
      />
      <Text style={[styles.coverLetter, letterStyle]} allowFontScaling={false}>
        {letter}
      </Text>
    </View>
  );
});

export type CoverShape = 'xs' | 'sm' | 'md' | 'round';

function coverRadius(size: number, rounded: CoverShape): number {
  switch (rounded) {
    case 'round':
      return size / 2;
    case 'xs':
      return 4;
    case 'sm':
      return radius.sm;
    default:
      return Math.max(radius.sm, size * 0.06);
  }
}

/**
 * Any square picture: the catalog artwork (size picked for the screen
 * density), else `fallbackUri` (the MP3's own cover), else the generated
 * gradient. A URL that fails to load falls through to the next one.
 */
export const Cover = React.memo(function Cover({
  artwork,
  fallbackUri,
  seed,
  title,
  size,
  rounded = 'md',
  style,
}: {
  artwork?: Artwork | null;
  fallbackUri?: string | null;
  seed: string;
  title: string;
  size: number;
  rounded?: CoverShape;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = React.useState<string[]>([]);
  // Best size first; when it fails to load, the other sizes, then the fallback.
  const candidates = [
    pickArtwork(artwork, size * PixelRatio.get()),
    artwork?.medium,
    artwork?.large,
    artwork?.small,
    fallbackUri,
  ];
  const uri = candidates.find((item): item is string => !!item && !failed.includes(item)) ?? null;
  const borderRadius = coverRadius(size, rounded);

  if (!uri) {
    return (
      <CoverArt
        seed={seed}
        title={title}
        size={size}
        rounded={rounded === 'round' ? 'md' : rounded}
        style={[rounded === 'round' && { borderRadius }, style]}
      />
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[{ width: size, height: size, borderRadius }, styles.coverImage, style as object]}
      resizeMode="cover"
      // Decode at the shown size: a 1000 px cover is 4 MB of bitmap memory,
      // and Android's image pool fills up after a few pages otherwise.
      resizeMethod="resize"
      onError={() => setFailed(list => [...list, uri])}
      accessibilityIgnoresInvertColors
    />
  );
});

/** Grey placeholder block that pulses while content loads. */
export function Skeleton({
  width,
  height,
  round,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = React.useRef(new Animated.Value(0.5)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, { width, height, borderRadius: round ? height / 2 : radius.xs, opacity }, style]}
    />
  );
}

const GRADIENT_TOP_RIGHT = { x: 1, y: 0 };
const GRADIENT_BOTTOM_LEFT = { x: 0, y: 1 };
const GRADIENT_CENTER = { x: 0.4, y: 0.6 };
const COVER_SHEEN = ['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)'];

/** Full-bleed background tinted by a track (Now Playing, hero cards). */
/**
 * The cover, blurred, behind a header (full player, album page), fading into
 * the page background. Without a cover: the seed's gradient.
 */
export function CoverBackdrop({ coverUri, seed }: { coverUri: string | null; seed: string }) {
  if (!coverUri) {
    return <TrackGradient seed={seed} />;
  }

  return (
    <>
      <Image
        source={{ uri: coverUri }}
        style={StyleSheet.absoluteFill}
        blurRadius={40}
        resizeMode="cover"
        resizeMethod="resize"
      />
      <LinearGradient
        colors={BACKDROP_SHADE}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </>
  );
}

const BACKDROP_SHADE = ['rgba(11,10,15,0.35)', 'rgba(11,10,15,0.7)', colors.bg];

export function TrackGradient({
  seed,
  style,
  strength = 1,
}: {
  seed: string;
  style?: StyleProp<ViewStyle>;
  strength?: number;
}) {
  const palette = coverPalette(seed);

  return (
    <LinearGradient
      colors={[palette.bgTop, palette.deep, colors.bg]}
      locations={[0, 0.45, 1]}
      style={[StyleSheet.absoluteFill, { opacity: strength }, style]}
      pointerEvents="none"
    />
  );
}

// ---------------------------------------------------------------------------
// Buttons

export type ButtonVariant = 'accent' | 'ghost' | 'soft' | 'white';

export function Button({
  label,
  onPress,
  variant = 'accent',
  size = 'md',
  icon,
  disabled,
  loading,
  block,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const fg = BUTTON_FG[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        buttonVariantStyles[variant],
        block && styles.buttonBlock,
        pressed && !inactive && (variant === 'accent' ? styles.buttonAccentPressed : styles.pressed),
        disabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={fg} /> : null}
          <Text style={[styles.buttonLabel, size === 'sm' && styles.buttonLabelSm, { color: fg }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const BUTTON_FG: Record<ButtonVariant, string> = {
  accent: colors.onAccent,
  ghost: colors.text,
  soft: colors.text,
  white: colors.onAccent,
};

export function IconButton({
  icon,
  onPress,
  size = 44,
  iconSize,
  variant = 'plain',
  filled,
  color,
  disabled,
  accessibilityLabel,
  children,
}: {
  icon: IconName;
  onPress: () => void;
  size?: number;
  iconSize?: number;
  variant?: 'plain' | 'soft' | 'white' | 'accent';
  filled?: boolean;
  color?: string;
  disabled?: boolean;
  accessibilityLabel: string;
  /** Extra overlay, e.g. the "10" inside the skip icons. */
  children?: React.ReactNode;
}) {
  const fg =
    color ?? (variant === 'white' || variant === 'accent' ? colors.onAccent : colors.text);
  const box = React.useMemo(
    () => ({ width: size, height: size, borderRadius: size / 2 }),
    [size],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        box,
        iconVariantStyles[variant],
        disabled && styles.disabledIcon,
        pressed && !disabled && styles.iconPressed,
      ]}>
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.5)} color={fg} filled={filled} />
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Badges, chips, dots

export const Badge = React.memo(function Badge({
  label,
  tone = 'neutral',
  icon,
  small,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  small?: boolean;
}) {
  return (
    <View style={[styles.badge, small && styles.badgeSmall, badgeBg[tone]]}>
      {icon ? <Icon name={icon} size={12} strokeWidth={2.4} color={tones[tone].fg} /> : null}
      <Text style={[styles.badgeLabel, small && styles.badgeLabelSmall, badgeFg[tone]]}>
        {label}
      </Text>
    </View>
  );
});

export function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.filterChip, selected && styles.filterChipOn, pressed && styles.pressed]}>
      <Text style={[styles.filterChipLabel, selected && styles.filterChipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

export type DotTone = 'good' | 'warn' | 'bad' | 'neutral';

export const Dot = React.memo(function Dot({ tone = 'good', pulse }: { tone?: DotTone; pulse?: boolean }) {
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);

  return <Animated.View style={[styles.dot, dotStyles[tone], { opacity }]} />;
});

export function connectionStatus(connection: ConnectionState): { label: string; tone: DotTone } {
  switch (connection) {
    case 'online':
      return { label: 'En ligne', tone: 'good' };
    case 'connecting':
      return { label: 'Connexion…', tone: 'warn' };
    case 'reconnecting':
      return { label: 'Reconnexion…', tone: 'warn' };
    case 'error':
      return { label: 'Erreur', tone: 'bad' };
    case 'disconnected':
      return { label: 'Hors ligne', tone: 'bad' };
    default:
      return { label: 'Inactif', tone: 'neutral' };
  }
}

export function ConnectionPill({ connection }: { connection: ConnectionState }) {
  const status = connectionStatus(connection);

  return (
    <View style={styles.pill} accessibilityLabel={`Réseau : ${status.label}`}>
      <Dot tone={status.tone} pulse={connection === 'online'} />
      <Text style={styles.pillLabel}>{status.label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Progress

/**
 * Two-layer bar: `value` (position) over `buffered` (received). `edge` draws
 * a tick at the buffered edge.
 */
export function ProgressBar({
  value,
  buffered,
  height = 4,
  tone = 'white',
  edge = false,
  style,
}: {
  value: number;
  buffered?: number;
  height?: number;
  tone?: 'white' | 'accent';
  edge?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bufferedRatio = clamp01(buffered ?? 0);
  const valueRatio = clamp01(value);
  const rounded = { height, borderRadius: height / 2 };

  return (
    <View style={[styles.progressTrack, rounded, style]}>
      {bufferedRatio > 0 ? (
        <View style={[styles.progressBuffered, rounded, { width: `${bufferedRatio * 100}%` }]} />
      ) : null}
      {valueRatio > 0 ? (
        <View
          style={[
            styles.progressValue,
            rounded,
            tone === 'accent' && styles.progressAccent,
            { width: `${valueRatio * 100}%` },
          ]}
        />
      ) : null}
      {edge && bufferedRatio > 0 && bufferedRatio < 1 ? (
        <View
          style={[
            styles.progressEdge,
            { left: `${bufferedRatio * 100}%`, height: height + 6 },
          ]}
        />
      ) : null}
    </View>
  );
}

/** Indeterminate thin bar shown while a search is running. */
export function ScanBar({ active }: { active: boolean }) {
  const shift = React.useRef(new Animated.Value(0)).current;
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    if (!active) {
      shift.stopAnimation();
      return;
    }

    const loop = Animated.loop(
      Animated.timing(shift, {
        toValue: 1,
        duration: 1600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    shift.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [active, shift]);

  const translateX = shift.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 0.4, width],
  });

  return (
    <View
      style={styles.scanTrack}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      {active ? (
        <Animated.View style={[styles.scanShimmer, { transform: [{ translateX }] }]} />
      ) : null}
    </View>
  );
}

/**
 * Discrete slider (e.g. buffer size on a log scale). Tap or drag; reports
 * the index of the selected value.
 */
export function StepSlider<T>({
  values,
  index,
  onChange,
  accessibilityLabel,
  format,
}: {
  values: readonly T[];
  index: number;
  onChange: (index: number) => void;
  accessibilityLabel: string;
  format: (value: T) => string;
}) {
  const width = React.useRef(0);
  const grantX = React.useRef(0);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const count = values.length;

  const pick = React.useCallback(
    (x: number) => {
      if (width.current <= 0 || count < 2) {
        return;
      }

      const ratio = clamp01(x / width.current);
      onChangeRef.current(Math.round(ratio * (count - 1)));
    },
    [count],
  );

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: event => {
          grantX.current = event.nativeEvent.locationX;
          pick(grantX.current);
        },
        onPanResponderMove: (_event, gesture) => pick(grantX.current + gesture.dx),
      }),
    [pick],
  );

  const ratio = count > 1 ? index / (count - 1) : 0;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: format(values[index]) }}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'increment') {
          onChange(Math.min(count - 1, index + 1));
        } else if (event.nativeEvent.actionName === 'decrement') {
          onChange(Math.max(0, index - 1));
        }
      }}
      accessibilityActions={SLIDER_ACTIONS}
      style={styles.sliderHit}
      onLayout={event => {
        width.current = event.nativeEvent.layout.width;
      }}
      {...responder.panHandlers}>
      <View style={styles.sliderTrack} pointerEvents="none">
        <View style={[styles.sliderFill, { width: `${ratio * 100}%` }]} />
      </View>
      <View style={[styles.sliderThumb, { left: `${ratio * 100}%` }]} pointerEvents="none" />
    </View>
  );
}

const SLIDER_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const;

// ---------------------------------------------------------------------------
// Cards and feedback

export interface CardAction {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
}

const TONE_ICON: Record<Tone, IconName> = {
  accent: 'info',
  good: 'check',
  warn: 'clock',
  bad: 'info',
  info: 'info',
  neutral: 'info',
};

/** Card with a coloured left rule, a cause and next actions. */
export function StatusCard({
  tone = 'info',
  title,
  body,
  icon,
  actions,
  leading,
  children,
  style,
}: {
  tone?: Tone;
  title: string;
  body?: string | null;
  icon?: IconName | null;
  actions?: CardAction[];
  /** Replaces the icon, e.g. an activity indicator. */
  leading?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = tones[tone].fg;
  const iconName = icon === undefined ? TONE_ICON[tone] : icon;

  return (
    <View style={[styles.statusCard, style]} accessibilityRole="summary">
      <View style={[styles.statusRule, { backgroundColor: tone === 'neutral' ? colors.textDim : fg }]} />
      <View style={styles.statusHeader}>
        {leading ?? (iconName ? <Icon name={iconName} size={18} color={fg} /> : null)}
        <Text style={styles.statusTitle} numberOfLines={2}>
          {title}
        </Text>
      </View>
      {children}
      {body ? <Text style={styles.statusBody}>{body}</Text> : null}
      {actions && actions.length > 0 ? (
        <View style={styles.statusActions}>
          {actions.map((action, index) => (
            <Button
              key={action.label}
              label={action.label}
              icon={action.icon}
              onPress={action.onPress}
              size="sm"
              variant={action.variant ?? (index === 0 ? 'soft' : 'ghost')}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Small transient banner; amber for reconnects, red for persistent errors. */
export function Toast({
  message,
  tone = 'neutral',
  icon,
  actionLabel,
  onAction,
  onDismiss,
  style,
}: {
  message: string;
  tone?: Tone;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const enter = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const palette = tone === 'neutral' ? null : tones[tone];
  const fg = palette?.fg ?? colors.text;
  const animated = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
  };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.toast, palette && styles.toastTinted, palette && { backgroundColor: palette.bg }, animated, style]}>
      {icon ? <Icon name={icon} size={18} color={palette ? fg : colors.accent} /> : null}
      <Text style={[styles.toastText, { color: fg }]} numberOfLines={3}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.toastAction, palette && { color: fg }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {onDismiss ? (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
          <Icon name="x" size={16} color={palette ? fg : colors.textDim} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={30} color={colors.accent} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {children}
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Row of a grouped settings list. */
export function ListRow({
  title,
  subtitle,
  value,
  icon,
  onPress,
  danger,
  chevron,
  last,
  right,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean;
  last?: boolean;
  right?: React.ReactNode;
}) {
  const content = (
    <>
      {icon ? <Icon name={icon} size={20} color={danger ? colors.danger : colors.textMuted} /> : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Icon name="right" size={18} color={colors.textDim} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, !last && styles.rowDivider]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.rowPressed]}>
      {content}
    </Pressable>
  );
}

/**
 * On/off switch with the app's colours on both platforms. React Native's
 * Switch only colours the track; without `thumbColor` Android paints the knob
 * with its default theme accent (teal), which clashed with the app accent.
 */
export function Toggle({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ true: colors.accent, false: colors.surfaceHigh }}
      thumbColor={value ? colors.text : colors.textMuted}
      ios_backgroundColor={colors.surfaceHigh}
    />
  );
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

// ---------------------------------------------------------------------------

const buttonVariantStyles = StyleSheet.create({
  accent: { backgroundColor: colors.accent },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  soft: { backgroundColor: colors.surfaceHigh },
  white: { backgroundColor: colors.text },
});

const iconVariantStyles = StyleSheet.create({
  plain: {},
  soft: { backgroundColor: colors.surfaceHigh },
  white: { backgroundColor: colors.text },
  accent: { backgroundColor: colors.accent },
});

const badgeBg = StyleSheet.create({
  accent: { backgroundColor: tones.accent.bg },
  good: { backgroundColor: tones.good.bg },
  warn: { backgroundColor: tones.warn.bg },
  bad: { backgroundColor: tones.bad.bg },
  info: { backgroundColor: tones.info.bg },
  neutral: { backgroundColor: tones.neutral.bg },
});

const badgeFg = StyleSheet.create({
  accent: { color: tones.accent.fg },
  good: { color: tones.good.fg },
  warn: { color: tones.warn.fg },
  bad: { color: tones.bad.fg },
  info: { color: tones.info.fg },
  neutral: { color: tones.neutral.fg },
});

const dotStyles = StyleSheet.create({
  good: { backgroundColor: colors.success },
  warn: { backgroundColor: colors.warning },
  bad: { backgroundColor: colors.danger },
  neutral: { backgroundColor: colors.textDim },
});

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  coverImage: {
    backgroundColor: colors.surfaceAlt,
  },
  skeleton: {
    backgroundColor: colors.surfaceHigh,
  },
  coverLetter: {
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '900',
    letterSpacing: -1,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.4,
  },
  disabledIcon: {
    opacity: 0.35,
  },
  button: {
    height: 48,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  buttonSm: {
    height: 34,
    paddingHorizontal: 14,
  },
  buttonBlock: {
    alignSelf: 'stretch',
  },
  buttonAccentPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.98 }],
  },
  buttonLabel: {
    ...type.body,
    fontWeight: '800',
  },
  buttonLabelSm: {
    fontSize: 13,
    lineHeight: 17,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.85,
  },
  badge: {
    height: 22,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  badgeSmall: {
    height: 18,
    paddingHorizontal: 6,
  },
  badgeLabel: {
    ...type.badge,
  },
  badgeLabelSmall: {
    fontSize: 10,
  },
  filterChip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
  },
  filterChipOn: {
    backgroundColor: colors.accent,
  },
  filterChipLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipLabelOn: {
    color: colors.onAccent,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  pillLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    width: '100%',
    backgroundColor: colors.trackBg,
  },
  progressBuffered: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: colors.trackBuffered,
  },
  progressValue: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: colors.text,
  },
  progressAccent: {
    backgroundColor: colors.accent,
  },
  progressEdge: {
    position: 'absolute',
    top: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: colors.trackEdge,
  },
  scanTrack: {
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
    backgroundColor: colors.trackBg,
  },
  scanShimmer: {
    width: '40%',
    height: '100%',
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  sliderHit: {
    height: 28,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
  },
  sliderFill: {
    height: 4,
    backgroundColor: colors.accent,
  },
  sliderThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: colors.text,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    paddingLeft: 17,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  statusRule: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '800',
  },
  statusBody: {
    ...type.bodySm,
    color: colors.textMuted,
  },
  statusActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  toastTinted: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  toastText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  toastAction: {
    color: colors.textMuted,
    fontSize: 12.5,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...type.heading,
    fontSize: 18,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    ...type.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...type.heading,
    color: colors.text,
  },
  sectionAction: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '600',
  },
  rowTitleDanger: {
    color: colors.danger,
  },
  rowSubtitle: {
    ...type.caption,
    color: colors.textDim,
  },
  rowValue: {
    color: colors.textMuted,
    fontSize: 13.5,
    fontVariant: ['tabular-nums'],
    maxWidth: '45%',
  },
});
