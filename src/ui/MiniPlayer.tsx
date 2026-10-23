import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import TrackPlayer, { State, usePlaybackState, useProgress } from 'react-native-track-player';

import { displayTitle } from '../core/types';
import { useAppStore } from '../state/store';
import { CoverArt } from './components';
import { colors, percent, spacing } from './theme';

export function MiniPlayer() {
  const current = useAppStore(state => state.current);
  const transfers = useAppStore(state => state.transfers);
  const setTab = useAppStore(state => state.setTab);
  const stopPlayback = useAppStore(state => state.stopPlayback);
  const playerReady = useAppStore(state => state.playerReady);

  const playbackState = usePlaybackState();
  const progress = useProgress(500);

  if (!current || !playerReady) {
    return null;
  }

  const transfer = transfers[current.transferId];
  const preparing = current.phase === 'preparing';
  const error = current.phase === 'error';
  const playing = playbackState.state === State.Playing;

  const title = displayTitle(current.hit.filename);
  const downloadedRatio = percent(transfer?.received ?? 0, transfer?.size || current.hit.size);
  const playbackRatio =
    progress.duration > 0 ? percent(progress.position, progress.duration) : 0;

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
      // Ignore.
    }
  };

  const subtitle = error
    ? 'Lecture interrompue'
    : preparing
      ? transfer?.state === 'queued'
        ? transfer.queuePosition
          ? `File d’attente n°${transfer.queuePosition}`
          : 'En file d’attente…'
        : `Mise en mémoire ${Math.round(percent(transfer?.received ?? 0, current.bufferTarget) * 100)} %`
      : playing
        ? 'En lecture'
        : 'En pause';

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.main} onPress={() => setTab('player')}>
        <CoverArt
          seed={`${current.hit.username}:${current.hit.filename}`}
          title={title}
          size={42}
        />
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.subtitle, error && { color: colors.danger }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={preparing ? 'Annuler la préparation' : playing ? 'Pause' : 'Lecture'}
        onPress={toggle}
        style={styles.action}>
        {preparing ? (
          <Text style={styles.cancelGlyph}>×</Text>
        ) : (
          <Text style={styles.actionGlyph}>{playing ? '❚❚' : '▶'}</Text>
        )}
      </Pressable>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round((preparing ? downloadedRatio : playbackRatio) * 100)}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    position: 'relative',
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 11,
  },
  action: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  actionGlyph: {
    color: colors.accentBright,
    fontSize: 15,
  },
  cancelGlyph: {
    color: colors.accentBright,
    fontSize: 22,
    lineHeight: 24,
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.accentBright,
  },
});
