import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import TrackPlayer, { State, usePlaybackState, useProgress } from 'react-native-track-player';

import { displayArtist, displayTitle } from '../core/types';
import { useAppStore } from '../state/store';
import { Chip, CoverArt, EmptyState, GhostButton, IconButton, ProgressBar } from './components';
import { colors, formatBytes, formatDuration, formatQuality, percent, spacing } from './theme';

export function PlayerScreen() {
  const playerReady = useAppStore(state => state.playerReady);

  if (!playerReady) {
    return (
      <EmptyState
        glyph="♪"
        title="Lecteur indisponible"
        body="Le module audio natif n’a pas pu démarrer. Réinstallez l’application ou consultez les réglages."
      />
    );
  }

  return <PlayerContent />;
}

function PlayerContent() {
  const current = useAppStore(state => state.current);
  const transfers = useAppStore(state => state.transfers);
  const setTab = useAppStore(state => state.setTab);
  const stopPlayback = useAppStore(state => state.stopPlayback);
  const retryPlayback = useAppStore(state => state.retryPlayback);

  const progress = useProgress(250);
  const playbackState = usePlaybackState();
  const state = playbackState.state;
  const playing = state === State.Playing;

  const transfer = current ? transfers[current.transferId] : undefined;

  const duration =
    progress.duration && Number.isFinite(progress.duration) && progress.duration > 0
      ? progress.duration
      : current?.hit.durationSec ?? 0;

  const position = Number.isFinite(progress.position) ? progress.position : 0;
  const bufferedRatio = duration > 0 ? percent(progress.buffered, duration) : 0;
  const playbackRatio = duration > 0 ? percent(position, duration) : 0;

  const downloaded = transfer?.received ?? 0;
  const total = transfer?.size || current?.hit.size || 0;
  const downloadedRatio = percent(downloaded, total);

  const bufferTargetRatio = current
    ? percent(downloaded, current.bufferTarget)
    : 0;

  const togglePlayback = async () => {
    try {
      if (playing) {
        await TrackPlayer.pause();
        return;
      }

      if (state === State.Ended) {
        await TrackPlayer.seekTo(0);
      }

      await TrackPlayer.play();
    } catch {
      // The player surfaces the error through its state.
    }
  };

  const seekToRatio = async (ratio: number) => {
    if (duration <= 0) {
      return;
    }

    try {
      await TrackPlayer.seekTo(ratio * duration);
    } catch {
      // Ignore.
    }
  };

  const seekBy = async (offset: number) => {
    if (duration <= 0) {
      return;
    }

    const target = Math.max(0, Math.min(duration, position + offset));

    try {
      await TrackPlayer.seekTo(target);
    } catch {
      // Ignore.
    }
  };

  if (!current) {
    return (
      <View style={styles.container}>
        <EmptyState
          glyph="♫"
          title="Aucune lecture"
          body="Choisissez un morceau dans l’onglet Recherche pour commencer à écouter en streaming."
        />
        <GhostButton label="Rechercher de la musique" onPress={() => setTab('search')} />
      </View>
    );
  }

  const hit = current.hit;
  const title = displayTitle(hit.filename);
  const artist = displayArtist(hit) ?? hit.username;
  const preparing = current.phase === 'preparing';
  const hasError = current.phase === 'error' || state === State.Error;

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <CoverArt
        seed={`${hit.username}:${hit.filename}`}
        title={title}
        size={252}
        style={styles.cover}
      />

      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.artist} numberOfLines={1}>
        {artist}
      </Text>

      <View style={styles.chipRow}>
        <Chip label={formatQuality(hit)} tone="accent" />
        <Chip label={formatBytes(hit.size)} tone="muted" />
        <Chip label={`@${hit.username}`} tone="muted" />
      </View>

      <View style={styles.progressBlock}>
        <ProgressBar
          value={playbackRatio}
          buffered={bufferedRatio}
          height={6}
          onSeek={preparing ? undefined : seekToRatio}
        />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatDuration(position)}</Text>
          <Text style={styles.time}>{duration > 0 ? formatDuration(duration) : '—:—'}</Text>
        </View>
      </View>

      {preparing ? (
        <View style={styles.preparingCard}>
          <View style={styles.preparingHeader}>
            <ActivityIndicator size="small" color={colors.accentBright} />
            <Text style={styles.preparingTitle}>
              {transferStateLabel(transfer?.state, transfer?.queuePosition)}
            </Text>
          </View>
          <ProgressBar value={bufferTargetRatio} height={4} />
          <Text style={styles.preparingText}>
            Mise en mémoire : {formatBytes(downloaded)} / {formatBytes(current.bufferTarget)}
            {total > 0 ? ` · ${Math.round(downloadedRatio * 100)} % du morceau` : ''}
          </Text>
          <View style={styles.preparingActions}>
            <GhostButton label="Annuler" onPress={stopPlayback} />
          </View>
        </View>
      ) : hasError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Lecture interrompue</Text>
          <Text style={styles.errorText}>
            {current.error ??
              'Le flux audio n’a pas pu être lu. Le pair a peut-être coupé la connexion.'}
          </Text>
          <View style={styles.errorActions}>
            <GhostButton label="Réessayer" onPress={retryPlayback} />
            <GhostButton label="Autre source" onPress={() => setTab('search')} />
          </View>
        </View>
      ) : (
        <View style={styles.controls}>
          <IconButton
            glyph="■"
            size={44}
            variant="plain"
            accessibilityLabel="Arrêter"
            onPress={stopPlayback}
          />
          <IconButton
            glyph="−10"
            size={52}
            variant="plain"
            accessibilityLabel="Reculer de 10 secondes"
            onPress={() => seekBy(-10)}
            disabled={duration <= 0}
          />
          <IconButton
            glyph={playing ? '❚❚' : '▶'}
            size={72}
            variant="accent"
            accessibilityLabel={playing ? 'Pause' : 'Lecture'}
            onPress={togglePlayback}
          />
          <IconButton
            glyph="+10"
            size={52}
            variant="plain"
            accessibilityLabel="Avancer de 10 secondes"
            onPress={() => seekBy(10)}
            disabled={duration <= 0}
          />
          <IconButton
            glyph={state === State.Buffering || state === State.Loading ? '…' : '↻'}
            size={44}
            variant="plain"
            accessibilityLabel="Relancer le flux"
            onPress={retryPlayback}
          />
        </View>
      )}

      <View style={styles.streamCard}>
        <View style={styles.streamHeader}>
          <Text style={styles.streamTitle}>Flux Soulseek</Text>
          <View
            style={[
              styles.streamDot,
              {
                backgroundColor:
                  transfer?.state === 'failed'
                    ? colors.danger
                    : transfer?.state === 'complete'
                      ? colors.success
                      : colors.cyan,
              },
            ]}
          />
        </View>

        <ProgressBar value={downloadedRatio} height={3} style={styles.streamProgress} />
        <Text style={styles.streamLine}>
          Reçu {formatBytes(downloaded)} / {formatBytes(total)} ·{' '}
          {transferStateLabel(transfer?.state, transfer?.queuePosition)}
        </Text>

        <Text style={styles.streamPath} numberOfLines={2}>
          {hit.filename}
        </Text>

        <View style={styles.streamMeta}>
          <Text style={styles.streamMetaText}>{formatQuality(hit)}</Text>
          <Text style={styles.streamMetaText}>
            {state === State.Buffering
              ? 'Mise en mémoire par le lecteur…'
              : state === State.Playing
                ? 'Lecture en cours'
                : state === State.Paused
                  ? 'En pause'
                  : 'Prêt'}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function transferStateLabel(
  state?: 'requesting' | 'queued' | 'awaiting-file' | 'streaming' | 'complete' | 'failed' | 'cancelled',
  queuePosition?: number | null,
): string {
  switch (state) {
    case 'requesting':
      return 'Connexion au pair…';
    case 'queued':
      return queuePosition && queuePosition > 0
        ? `File d’attente du pair : n°${queuePosition}`
        : 'En file d’attente chez le pair…';
    case 'awaiting-file':
      return 'Le pair prépare le transfert…';
    case 'streaming':
      return 'Réception des données…';
    case 'complete':
      return 'Morceau entièrement reçu';
    case 'failed':
      return 'Transfert échoué';
    case 'cancelled':
      return 'Transfert annulé';
    default:
      return 'Préparation du flux…';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  scroll: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  cover: {
    marginBottom: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  artist: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: 4,
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  progressBlock: {
    width: '100%',
    marginTop: spacing.xl,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  time: {
    color: colors.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  preparingCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  preparingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  preparingTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  preparingText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  preparingActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  errorCard: {
    width: '100%',
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248, 113, 113, 0.4)',
    padding: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: {
    color: '#fca5a5',
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  errorActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  streamCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  streamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  streamTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  streamDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  streamProgress: {
    marginTop: spacing.md,
  },
  streamLine: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  streamPath: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.md,
  },
  streamMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  streamMetaText: {
    color: colors.textDim,
    fontSize: 11,
  },
});
