/**
 * Presentational P2P components. They take explicit props only (no store
 * access) so phase 2 can wire them to retained search results.
 */
import React from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';

import type { TransferSnapshot } from '../core/transfer';
import { hitKey } from '../core/types';
import type { SearchHit } from '../core/types';
import { Badge, CoverArt, Dot, clamp01 } from './components';
import type { DotTone } from './components';
import { Icon } from './Icon';
import {
  bufferEta,
  clampSeek,
  groupSources,
  peerAvailability,
  peerBadges,
  transferSteps,
} from './p2p';
import type { SourceGroup, StepModel } from './p2p';
import { colors, coverSeed, formatDuration, formatSpeed, radius, spacing, type } from './theme';

// ---------------------------------------------------------------------------
// Peer badges

export const PeerBadges = React.memo(function PeerBadges({
  hit,
  long,
  style,
}: {
  hit: SearchHit;
  /** Wordier labels for hero cards ("320 kb/s", "Slot libre"). */
  long?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const badges = React.useMemo(() => peerBadges(hit, { long }), [hit, long]);

  return (
    <View style={[styles.badges, style]}>
      {badges.map(badge => (
        <Badge key={badge.key} label={badge.label} tone={badge.tone} icon={badge.icon} />
      ))}
    </View>
  );
});

const AVAILABILITY_DOT: Record<ReturnType<typeof peerAvailability>, DotTone> = {
  free: 'good',
  queued: 'warn',
  busy: 'bad',
};

// ---------------------------------------------------------------------------
// Sources

export const SourceRow = React.memo(function SourceRow({
  hit,
  chosen,
  onPress,
  last,
}: {
  hit: SearchHit;
  chosen?: boolean;
  onPress: (hit: SearchHit) => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Écouter depuis ${hit.username}`}
      accessibilityState={{ selected: !!chosen }}
      onPress={() => onPress(hit)}
      style={({ pressed }) => [styles.sourceRow, !last && styles.sourceDivider, pressed && styles.pressed]}>
      <View style={styles.sourceBody}>
        <View style={styles.sourceUser}>
          <Dot tone={AVAILABILITY_DOT[peerAvailability(hit)]} />
          <Text style={styles.sourceName} numberOfLines={1}>
            @{hit.username}
          </Text>
        </View>
        <PeerBadges hit={hit} />
      </View>
      <View style={[styles.sourceGo, chosen && styles.sourceGoChosen]}>
        <Icon name="play" size={16} filled color={chosen ? colors.onAccent : colors.text} />
      </View>
    </Pressable>
  );
});

/**
 * Candidate peers grouped by track. `currentKey` is the `hitKey` of the hit
 * being played, if any.
 */
export function SourcesList({
  hits,
  currentKey,
  onPick,
}: {
  hits: readonly SearchHit[];
  currentKey?: string | null;
  onPick: (hit: SearchHit) => void;
}) {
  const groups = React.useMemo(() => groupSources(hits), [hits]);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  // TODO(perf): switch to a virtualised list (FlashList) once grouped
  // results can reach hundreds of rows.
  return (
    <View style={styles.groups}>
      {groups.map((group, index) => (
        <SourceGroupCard
          key={group.key}
          group={group}
          expanded={open[group.key] ?? index === 0}
          currentKey={currentKey}
          onToggle={() =>
            setOpen(state => ({ ...state, [group.key]: !(state[group.key] ?? index === 0) }))
          }
          onPick={onPick}
        />
      ))}
    </View>
  );
}

const SourceGroupCard = React.memo(function SourceGroupCard({
  group,
  expanded,
  currentKey,
  onToggle,
  onPick,
}: {
  group: SourceGroup;
  expanded: boolean;
  currentKey?: string | null;
  onToggle: () => void;
  onPick: (hit: SearchHit) => void;
}) {
  const count = group.hits.length;
  const meta = [
    group.artist,
    `${count} source${count > 1 ? 's' : ''}`,
    group.durationSec ? formatDuration(group.durationSec) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={styles.groupHead}>
        <CoverArt seed={coverSeed(group.hits[0])} title={group.title} size={44} rounded="sm" />
        <View style={styles.groupText}>
          <Text style={styles.groupTitle} numberOfLines={1}>
            {group.title}
          </Text>
          <Text style={styles.groupMeta} numberOfLines={1}>
            {meta}
            {group.allQueued ? <Text style={styles.groupQueued}> · tous en file</Text> : null}
          </Text>
        </View>
        <Icon
          name="down"
          size={20}
          color={colors.textDim}
          style={expanded ? styles.chevronOpen : undefined}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.peers}>
          {group.hits.map((hit, index) => {
            const key = hitKey(hit);
            return (
              <SourceRow
                key={key}
                hit={hit}
                chosen={key === currentKey}
                onPress={onPick}
                last={index === group.hits.length - 1}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Transfer steps

export function TransferSteps({
  snapshot,
  bufferTarget,
  speed,
  style,
}: {
  snapshot: Pick<TransferSnapshot, 'state' | 'received' | 'queuePosition'> | null | undefined;
  bufferTarget: number;
  /** Live bytes per second, if the caller measures it. */
  speed?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const steps = transferSteps(snapshot, bufferTarget);
  const streaming = snapshot?.state === 'streaming';
  const eta = streaming && speed ? bufferEta(snapshot?.received ?? 0, bufferTarget, speed) : null;

  return (
    <View style={style}>
      <View style={styles.steps} accessibilityRole="progressbar">
        {steps.map(step => (
          <Step key={step.key} step={step} />
        ))}
      </View>
      {eta !== null && speed ? (
        <Text style={styles.stepsHint}>
          {eta <= 1 ? 'Démarrage imminent' : `Démarrage dans ~${eta} s`} à {formatSpeed(speed)}
        </Text>
      ) : null}
    </View>
  );
}

function Step({ step }: { step: StepModel }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepTrack}>
        {step.progress > 0 ? (
          <View
            style={[
              styles.stepFill,
              stepFill[step.status],
              { width: `${clamp01(step.progress) * 100}%` },
            ]}
          />
        ) : null}
        {step.status === 'failed' ? <View style={[styles.stepFill, styles.stepFailed]} /> : null}
      </View>
      <Text style={[styles.stepLabel, stepLabel[step.status]]} numberOfLines={1}>
        {step.label}
      </Text>
    </View>
  );
}

const stepFill = StyleSheet.create({
  done: { backgroundColor: colors.success },
  current: { backgroundColor: colors.accent },
  todo: {},
  failed: { backgroundColor: colors.danger },
});

const stepLabel = StyleSheet.create({
  done: { color: colors.success },
  current: { color: colors.text },
  todo: {},
  failed: { color: colors.danger },
});

// ---------------------------------------------------------------------------
// Scrubber

/**
 * Three-layer seek bar: position, received range (with an edge tick) and the
 * unreceived remainder. Seeks past the received edge are clamped to it,
 * because peers only stream from offset 0.
 */
export function Scrubber({
  position,
  duration,
  receivedRatio,
  onSeek,
  disabled,
}: {
  position: number;
  duration: number;
  receivedRatio: number;
  onSeek: (seconds: number) => void;
  disabled?: boolean;
}) {
  const width = React.useRef(0);
  const grantX = React.useRef(0);
  const [dragRatio, setDragRatio] = React.useState<number | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  const latest = React.useRef({ duration, receivedRatio, onSeek });
  latest.current = { duration, receivedRatio, onSeek };

  const canSeek = !disabled && duration > 0;

  React.useEffect(() => {
    if (!blocked) {
      return;
    }

    const timer = setTimeout(() => setBlocked(false), 1800);
    return () => clearTimeout(timer);
  }, [blocked]);

  const ratioAt = (x: number) => (width.current > 0 ? clamp01(x / width.current) : 0);

  const commit = (ratio: number) => {
    const { duration: total, receivedRatio: received, onSeek: seek } = latest.current;
    const result = clampSeek(ratio * total, total, received);
    setBlocked(result.clamped);
    setDragRatio(null);
    seek(result.seconds);
  };

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canSeek,
        onMoveShouldSetPanResponder: () => canSeek,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: event => {
          grantX.current = event.nativeEvent.locationX;
          setDragRatio(ratioAt(grantX.current));
        },
        onPanResponderMove: (_event, gesture) => setDragRatio(ratioAt(grantX.current + gesture.dx)),
        onPanResponderRelease: (_event, gesture) => commit(ratioAt(grantX.current + gesture.dx)),
        onPanResponderTerminate: () => setDragRatio(null),
      }),
    // `commit` and `ratioAt` only read refs and stable setters.
    [canSeek],
  );

  const received = clamp01(receivedRatio);
  const positionRatio = duration > 0 ? clamp01(position / duration) : 0;
  const shown = dragRatio ?? positionRatio;
  const label = blocked
    ? 'Pas encore reçu'
    : received >= 1
      ? 'Reçu en entier'
      : `Reçu ${Math.round(received * 100)} %`;

  return (
    <View>
      <View
        style={styles.scrubHit}
        onLayout={(event: LayoutChangeEvent) => {
          width.current = event.nativeEvent.layout.width;
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Position de lecture"
        accessibilityValue={{ text: `${formatDuration(position)} sur ${formatDuration(duration)}` }}
        {...responder.panHandlers}>
        <View style={styles.scrubTrack} pointerEvents="none">
          <View style={[styles.scrubReceived, { width: `${received * 100}%` }]} />
          <View style={[styles.scrubPosition, { width: `${shown * 100}%` }]} />
          {received > 0 && received < 1 ? (
            <View style={[styles.scrubEdge, { left: `${received * 100}%` }]} />
          ) : null}
        </View>
        {canSeek ? (
          <View
            pointerEvents="none"
            style={[styles.scrubThumb, dragRatio !== null && styles.scrubThumbActive, { left: `${shown * 100}%` }]}
          />
        ) : null}
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(dragRatio !== null ? dragRatio * duration : position)}</Text>
        <Text style={[styles.timeMid, blocked && styles.timeBlocked]}>{label}</Text>
        <Text style={[styles.time, styles.timeEnd]}>
          {duration > 0 ? formatDuration(duration) : '—:—'}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.75,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  groups: {
    gap: spacing.sm,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  groupText: {
    flex: 1,
    minWidth: 0,
  },
  groupTitle: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '700',
  },
  groupMeta: {
    ...type.caption,
    color: colors.textDim,
  },
  groupQueued: {
    color: colors.warning,
  },
  chevronOpen: {
    transform: [{ rotate: '180deg' }],
  },
  peers: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sourceDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sourceBody: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  sourceUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourceName: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  sourceGo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceGoChosen: {
    backgroundColor: colors.accent,
  },
  steps: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  step: {
    flex: 1,
    minWidth: 0,
  },
  stepTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.trackBg,
    overflow: 'hidden',
  },
  stepFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  stepFailed: {
    right: 0,
    backgroundColor: colors.danger,
  },
  stepLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
  },
  stepsHint: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  scrubHit: {
    height: 24,
    justifyContent: 'center',
  },
  scrubTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  scrubReceived: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  scrubPosition: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  scrubEdge: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: colors.trackEdge,
  },
  scrubThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.text,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  scrubThumbActive: {
    transform: [{ scale: 1.25 }],
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  time: {
    ...type.mono,
    color: colors.textOnMedia,
    fontSize: 11.5,
    minWidth: 44,
  },
  timeEnd: {
    textAlign: 'right',
  },
  timeMid: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 11.5,
    fontWeight: '700',
  },
  timeBlocked: {
    color: colors.warning,
  },
});
