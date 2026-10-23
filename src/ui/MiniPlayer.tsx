import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import TrackPlayer, { State, usePlaybackState, useProgress } from 'react-native-track-player';

import { displayTitle } from '../core/types';
import { useAppStore } from '../state/store';
import { CoverArt, ProgressBar } from './components';
import { Icon } from './Icon';
import { colors, coverPalette, coverSeed, formatBytes, percent, radius, spacing } from './theme';

export function MiniPlayer() {
  const current = useAppStore(state => state.current);
  const transfer = useAppStore(state =>
    state.current ? state.transfers[state.current.transferId] : undefined,
  );
  const setTab = useAppStore(state => state.setTab);
  const stopPlayback = useAppStore(state => state.stopPlayback);
  const playerReady = useAppStore(state => state.playerReady);

  const playbackState = usePlaybackState();
  const progress = useProgress(500);

  if (!current || !playerReady) {
    return null;
  }

  const hit = current.hit;
  const seed = coverSeed(hit);
  const palette = coverPalette(seed);
  const preparing = current.phase === 'preparing';
  const error = current.phase === 'error';
  const playing = playbackState.state === State.Playing;

  const title = displayTitle(hit.filename);
  const received = transfer?.received ?? 0;
  const receivedRatio =
    current.source === 'cache' || transfer?.state === 'complete'
      ? 1
      : percent(received, transfer?.size || hit.size);
  const playbackRatio = progress.duration > 0 ? percent(progress.position, progress.duration) : 0;

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

  const subtitle = error
    ? 'Lecture interrompue · touchez pour les détails'
    : preparing
      ? transfer?.state === 'queued'
        ? transfer.queuePosition
          ? `En file chez le pair · position ${transfer.queuePosition}`
          : 'En file chez le pair…'
        : transfer?.state === 'streaming'
          ? `Mise en mémoire · ${formatBytes(Math.min(received, current.bufferTarget))} / ${formatBytes(current.bufferTarget)}`
          : 'Connexion au pair…'
      : [
          current.source === 'cache' ? 'Sur l’appareil' : `@${hit.username}`,
          hit.bitrate ? `${hit.bitrate} kb/s` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={[palette.deep, palette.bgTop]}
        start={START}
        end={END}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        style={styles.main}
        onPress={() => setTab('player')}
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir le lecteur : ${title}`}>
        <CoverArt seed={seed} title={title} size={40} rounded="xs" />
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.subtitleRow}>
            {!preparing && !error ? (
              <Icon name="peer" size={12} color={colors.textOnMedia} />
            ) : null}
            <Text style={[styles.subtitle, error && styles.subtitleError]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={preparing ? 'Annuler la préparation' : playing ? 'Pause' : 'Lecture'}
        onPress={toggle}
        hitSlop={8}
        style={styles.action}>
        <Icon
          name={preparing ? 'x' : playing ? 'pause' : 'play'}
          size={24}
          filled={!preparing}
          color={colors.text}
        />
      </Pressable>

      <ProgressBar
        value={preparing ? 0 : playbackRatio}
        buffered={receivedRatio}
        height={2}
        style={styles.progress}
      />
    </View>
  );
}

const START = { x: 0, y: 0 };
const END = { x: 1, y: 0 };

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: 10,
    gap: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subtitle: {
    flexShrink: 1,
    color: colors.textOnMedia,
    fontSize: 12,
  },
  subtitleError: {
    color: colors.danger,
  },
  action: {
    width: 36,
    height: 36,
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
