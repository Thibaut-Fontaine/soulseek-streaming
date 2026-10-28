import React from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import TrackPlayer, { State, usePlaybackState, useProgress } from 'react-native-track-player';

import { useAppStore } from '../state/store';
import { MarqueeText, ProgressBar } from './components';
import { useCurrentTransfer, useReceivedRatio } from './hooks';
import { Icon } from './Icon';
import { TrackCover, useIsLiked, useTrackInfo } from './track';
import { colors, coverPalette, coverSeed, formatBytes, percent, radius, spacing } from './theme';

const SWIPE_SKIP = 60;
const SWIPE_OPEN = 30;

/**
 * The bar above the tabs. Tap or swipe up: open the player. Swipe left or
 * right: next or previous track.
 */
export function MiniPlayer() {
  const current = useAppStore(state => state.current);
  const openPlayer = useAppStore(state => state.openPlayer);
  const stopPlayback = useAppStore(state => state.stopPlayback);
  const toggleLike = useAppStore(state => state.toggleLike);
  const playNext = useAppStore(state => state.playNext);
  const playPrevious = useAppStore(state => state.playPrevious);
  const playerReady = useAppStore(state => state.playerReady);

  const playbackState = usePlaybackState();
  const info = useTrackInfo(current?.hit);
  const liked = useIsLiked(current?.hit);

  const shift = React.useRef(new Animated.Value(0)).current;
  const latest = React.useRef({ openPlayer, playNext, playPrevious });
  latest.current = { openPlayer, playNext, playPrevious };

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, g) =>
          (Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy)) || (g.dy < -12 && -g.dy > Math.abs(g.dx)),
        onPanResponderMove: (_event, g) => {
          if (Math.abs(g.dx) > Math.abs(g.dy)) {
            shift.setValue(g.dx);
          }
        },
        onPanResponderRelease: (_event, g) => {
          Animated.spring(shift, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          const actions = latest.current;

          if (Math.abs(g.dx) > Math.abs(g.dy)) {
            if (g.dx < -SWIPE_SKIP) {
              void actions.playNext();
            } else if (g.dx > SWIPE_SKIP) {
              // A swipe back always goes to the previous track.
              void actions.playPrevious(0);
            }
          } else if (g.dy < -SWIPE_OPEN) {
            actions.openPlayer();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(shift, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [shift],
  );

  if (!current || !playerReady) {
    return null;
  }

  const hit = current.hit;
  const palette = coverPalette(coverSeed(hit));
  const preparing = current.phase === 'preparing';
  const error = current.phase === 'error';
  const playing = playbackState.state === State.Playing;

  const toggle = async () => {
    if (preparing) {
      await stopPlayback();
      return;
    }

    try {
      if (playing) {
        await TrackPlayer.pause();
      } else {
        if (playbackState.state === State.Ended) {
          await TrackPlayer.seekTo(0);
        }
        await TrackPlayer.play();
      }
    } catch {
      // The player reports failures through its state.
    }
  };

  return (
    <View style={styles.wrap} {...responder.panHandlers}>
      <LinearGradient colors={[palette.deep, palette.bgTop]} start={START} end={END} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.slide, { transform: [{ translateX: shift }] }]}>
        <Pressable
          style={styles.main}
          onPress={openPlayer}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir le lecteur : ${info.title}`}
          accessibilityHint="Glissez à gauche ou à droite pour changer de titre">
          <TrackCover hit={hit} size={40} rounded="xs" />
          <View style={styles.textBlock}>
            <MarqueeText style={styles.title}>{info.title}</MarqueeText>
            <MiniSubtitle
              username={hit.username}
              artist={info.artist}
              preparing={preparing}
              error={error}
              bufferTarget={current.bufferTarget}
            />
          </View>
        </Pressable>
      </Animated.View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
        onPress={() => toggleLike(hit)}
        hitSlop={6}
        style={styles.action}>
        <Icon name="heart" size={22} filled={liked} color={liked ? colors.accent : colors.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={preparing ? 'Annuler' : playing ? 'Pause' : 'Lecture'}
        onPress={toggle}
        hitSlop={6}
        style={styles.action}>
        <Icon name={preparing ? 'x' : playing ? 'pause' : 'play'} size={24} filled={!preparing} color={colors.text} />
      </Pressable>

      <MiniProgress preparing={preparing} />
    </View>
  );
}

// The two parts below change several times a second (download progress,
// playback position): they subscribe on their own so the rest of the bar
// does not redraw with them.

function MiniSubtitle({
  username,
  artist,
  preparing,
  error,
  bufferTarget,
}: {
  username: string;
  artist: string;
  preparing: boolean;
  error: boolean;
  bufferTarget: number;
}) {
  const transfer = useCurrentTransfer();
  const received = transfer?.received ?? 0;
  const subtitle = error
    ? 'Lecture interrompue · touchez pour les détails'
    : preparing
      ? transfer?.state === 'queued'
        ? transfer.queuePosition
          ? `En file chez ${username} · position ${transfer.queuePosition}`
          : `En file chez ${username}…`
        : transfer?.state === 'streaming'
          ? `Mise en mémoire · ${formatBytes(Math.min(received, bufferTarget))} / ${formatBytes(bufferTarget)}`
          : `Connexion à ${username}…`
      : artist;

  return (
    <Text style={[styles.subtitle, preparing && styles.subtitleWait, error && styles.subtitleError]} numberOfLines={1}>
      {subtitle}
    </Text>
  );
}

function MiniProgress({ preparing }: { preparing: boolean }) {
  const receivedRatio = useReceivedRatio();
  const progress = useProgress(500);
  const playbackRatio = progress.duration > 0 ? percent(progress.position, progress.duration) : 0;

  return <ProgressBar value={preparing ? 0 : playbackRatio} buffered={receivedRatio} height={2} style={styles.progress} />;
}

const START = { x: 0, y: 0 };
const END = { x: 1, y: 0 };

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.sm,
    height: 58,
    borderRadius: radius.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  slide: {
    flex: 1,
    minWidth: 0,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 58,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textOnMedia,
    fontSize: 12.5,
  },
  subtitleWait: {
    color: colors.warning,
  },
  subtitleError: {
    color: colors.danger,
  },
  action: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: 0,
    width: undefined,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
