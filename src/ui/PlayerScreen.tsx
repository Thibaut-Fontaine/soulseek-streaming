import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import TrackPlayer, { State, usePlaybackState, useProgress } from 'react-native-track-player';

import type { TransferSnapshot } from '../core/transfer';
import { displayArtist, displayTitle } from '../core/types';
import type { SearchHit } from '../core/types';
import { useAppStore } from '../state/store';
import {
  Button,
  CoverArt,
  Dot,
  EmptyState,
  IconButton,
  StatusCard,
  TrackGradient,
} from './components';
import type { CardAction } from './components';
import { ACTION_LABELS, SHARING_EXPLANATION, describePlaybackError } from './errors';
import type { ErrorAction } from './errors';
import { useByteRate } from './hooks';
import { Icon } from './Icon';
import { QUEUE_WARN_POSITION, clampSeek, peerAvailability, sourceSummary } from './p2p';
import { Scrubber, TransferSteps } from './peer';
import { colors, coverSeed, formatBytes, percent, radius, spacing, type } from './theme';

const SIDE = spacing.xl;
const MAX_ART = 360;

export function PlayerScreen() {
  const playerReady = useAppStore(state => state.playerReady);

  if (!playerReady) {
    return (
      <EmptyState
        icon="music"
        title="Lecteur indisponible"
        body="Le module audio natif n’a pas pu démarrer. Réinstallez l’application ou consultez les réglages."
      />
    );
  }

  return <PlayerContent />;
}

function PlayerContent() {
  const current = useAppStore(state => state.current);
  const transfer = useAppStore(state =>
    state.current ? state.transfers[state.current.transferId] : undefined,
  );
  const searchQuery = useAppStore(state => state.query);
  const setTab = useAppStore(state => state.setTab);
  const stopPlayback = useAppStore(state => state.stopPlayback);
  const retryPlayback = useAppStore(state => state.retryPlayback);
  const playNextSource = useAppStore(state => state.playNextSource);
  const reconnect = useAppStore(state => state.reconnect);

  const { width } = useWindowDimensions();
  const progress = useProgress(250);
  const playbackState = usePlaybackState();
  const state = playbackState.state;
  const playing = state === State.Playing;
  const speed = useByteRate(transfer?.received ?? 0, transfer?.id);

  if (!current) {
    return (
      <EmptyState
        icon="music"
        title="Aucune lecture"
        body="Cherchez un morceau dans l’onglet Rechercher pour commencer à écouter en streaming.">
        <Button
          label="Rechercher de la musique"
          icon="search"
          variant="ghost"
          onPress={() => setTab('search')}
          style={styles.emptyButton}
        />
      </EmptyState>
    );
  }

  const hit = current.hit;
  const seed = coverSeed(hit);
  const title = displayTitle(hit.filename);
  const artist = displayArtist(hit) ?? hit.username;
  const preparing = current.phase === 'preparing';
  const hasError = current.phase === 'error' || state === State.Error;

  const duration =
    progress.duration && Number.isFinite(progress.duration) && progress.duration > 0
      ? progress.duration
      : hit.durationSec ?? 0;
  const position = Number.isFinite(progress.position) ? progress.position : 0;
  const total = transfer?.size || hit.size || 0;
  // A track played from the device is fully available.
  const receivedRatio =
    current.source === 'cache' || transfer?.state === 'complete'
      ? 1
      : percent(transfer?.received ?? 0, total);

  const seekTo = async (seconds: number) => {
    try {
      await TrackPlayer.seekTo(seconds);
    } catch {
      // Ignore: the player reports failures through its state.
    }
  };

  const seekBy = (offset: number) => {
    if (duration > 0) {
      void seekTo(clampSeek(position + offset, duration, receivedRatio).seconds);
    }
  };

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

  const toCardActions = (actions: ErrorAction[]): CardAction[] =>
    actions.map(action => {
      switch (action) {
        case 'next-source':
          return { label: 'Autre source', icon: 'swap', onPress: () => void playNextSource() };
        case 'learn-more':
          return {
            label: ACTION_LABELS[action],
            onPress: () => Alert.alert('Pourquoi ce refus ?', SHARING_EXPLANATION),
          };
        case 'reconnect':
          return { label: ACTION_LABELS[action], onPress: () => void reconnect() };
        default:
          return { label: ACTION_LABELS.retry, icon: 'refresh', onPress: () => void retryPlayback() };
      }
    });

  const failure = hasError
    ? describePlaybackError(
        current.error ?? 'Le flux audio n’a pas pu être lu. Le pair a peut-être coupé la connexion.',
        { receivedRatio },
      )
    : null;

  const artSize = Math.min(MAX_ART, width - SIDE * 2);

  return (
    <View style={styles.root}>
      <TrackGradient seed={seed} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Text style={styles.eyebrow}>Lecture depuis la recherche</Text>
          {searchQuery ? (
            <Text style={styles.topQuery} numberOfLines={1}>
              « {searchQuery} »
            </Text>
          ) : null}
        </View>

        <CoverArt seed={seed} title={title} size={artSize} style={styles.art} />

        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {artist}
            </Text>
          </View>
          {/* TODO(wire): favourites (♥) — needs a persisted store.favourites. */}
        </View>

        {preparing ? (
          <PreparingCard
            hit={hit}
            transfer={transfer}
            bufferTarget={current.bufferTarget}
            speed={speed}
            onCancel={stopPlayback}
            onOtherSource={() => void playNextSource()}
          />
        ) : (
          <>
            <View style={styles.scrubber}>
              <Scrubber
                position={position}
                duration={duration}
                receivedRatio={receivedRatio}
                onSeek={seconds => void seekTo(seconds)}
              />
            </View>

            <View style={styles.controls}>
              {/* TODO(wire): previous / next need a queue (phase 3). */}
              <IconButton icon="prev" accessibilityLabel="Précédent" onPress={noop} disabled />
              <IconButton
                icon="back10"
                iconSize={30}
                accessibilityLabel="Reculer de 10 secondes"
                onPress={() => seekBy(-10)}
                disabled={duration <= 0}>
                <Text style={styles.skipLabel}>10</Text>
              </IconButton>
              <IconButton
                icon={playing ? 'pause' : 'play'}
                filled
                size={68}
                iconSize={30}
                variant="white"
                accessibilityLabel={playing ? 'Pause' : 'Lecture'}
                onPress={togglePlayback}
              />
              <IconButton
                icon="fwd10"
                iconSize={30}
                accessibilityLabel="Avancer de 10 secondes"
                onPress={() => seekBy(10)}
                disabled={duration <= 0}>
                <Text style={styles.skipLabel}>10</Text>
              </IconButton>
              <IconButton icon="next" accessibilityLabel="Suivant" onPress={noop} disabled />
            </View>
          </>
        )}

        {failure ? (
          <StatusCard
            tone={failure.tone}
            icon={failure.icon}
            title={failure.title}
            body={failure.body}
            actions={toCardActions(failure.actions)}
            style={styles.card}
          />
        ) : null}

        {current.warning && !failure ? (
          <StatusCard
            tone="warn"
            icon="offline"
            title={`Source coupée à ${Math.round(receivedRatio * 100)} %`}
            body="La lecture continue avec ce qui a déjà été reçu."
            actions={[
              { label: 'Autre source', icon: 'swap', onPress: () => void playNextSource() },
            ]}
            style={styles.card}
          />
        ) : null}

        {current.source === 'cache' ? (
          <StatusCard
            tone="good"
            icon="check"
            title="Sur l’appareil"
            body="Ce morceau a déjà été écouté : il est lu depuis le stockage, sans réseau."
            style={styles.card}
          />
        ) : (
          <SourceChip hit={hit} transfer={transfer} speed={speed} />
        )}

        <View style={styles.foot}>
          <Button label="Arrêter" icon="stop" size="sm" variant="ghost" onPress={stopPlayback} />
          <Button
            label={state === State.Buffering || state === State.Loading ? 'Chargement…' : 'Relancer le flux'}
            icon="refresh"
            size="sm"
            variant="ghost"
            onPress={retryPlayback}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function noop() {}

function PreparingCard({
  hit,
  transfer,
  bufferTarget,
  speed,
  onCancel,
  onOtherSource,
}: {
  hit: SearchHit;
  transfer: TransferSnapshot | undefined;
  bufferTarget: number;
  speed: number;
  onCancel: () => void;
  onOtherSource: () => void;
}) {
  const queuePosition = transfer?.state === 'queued' ? transfer.queuePosition ?? 0 : 0;

  return (
    <>
      <StatusCard
        tone="accent"
        title={`Préparation · @${hit.username}`}
        leading={<ActivityIndicator size="small" color={colors.accent} />}
        actions={[{ label: 'Annuler', onPress: onCancel, icon: 'x' }]}
        style={styles.card}>
        <TransferSteps snapshot={transfer} bufferTarget={bufferTarget} speed={speed} />
      </StatusCard>
      {queuePosition >= QUEUE_WARN_POSITION ? (
        <StatusCard
          tone="warn"
          icon="clock"
          title={`En file chez le pair · position ${queuePosition}`}
          body="Ce pair n’a pas de slot libre ; l’attente peut être longue."
          actions={[
            { label: 'Autre source', icon: 'swap', onPress: onOtherSource, variant: 'accent' },
            { label: 'Attendre', onPress: noop },
          ]}
          style={styles.card}
        />
      ) : null}
    </>
  );
}

function SourceChip({
  hit,
  transfer,
  speed,
}: {
  hit: SearchHit;
  transfer: TransferSnapshot | undefined;
  speed: number;
}) {
  const [open, setOpen] = React.useState(false);
  const availability = peerAvailability(hit);
  const live = transfer?.state === 'streaming' ? speed : undefined;

  // TODO(wire): open a Sources sheet with alternatives (phase 2); for now the
  // chip expands in place to show the raw path.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`Source : ${hit.username}`}
      onPress={() => setOpen(value => !value)}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <View style={styles.chipRow}>
        <View style={styles.chipIcon}>
          <Icon name="peer" size={18} color={colors.text} />
        </View>
        <View style={styles.chipText}>
          <View style={styles.chipUser}>
            <Text style={styles.chipName} numberOfLines={1}>
              @{hit.username}
            </Text>
            <Dot tone={availability === 'free' ? 'good' : availability === 'queued' ? 'warn' : 'bad'} />
          </View>
          <Text style={styles.chipMeta} numberOfLines={1}>
            {sourceSummary(hit, live)}
          </Text>
        </View>
        <Icon
          name={open ? 'down' : 'right'}
          size={20}
          color="rgba(255,255,255,0.6)"
        />
      </View>
      {open ? (
        <View style={styles.chipDetails}>
          <Text style={styles.chipPath} selectable>
            {hit.filename}
          </Text>
          <Text style={styles.chipMeta}>
            Reçu {formatBytes(transfer?.received ?? 0)} / {formatBytes(transfer?.size || hit.size)}
            {transfer ? ` · ${transferStateLabel(transfer)}` : ''}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function transferStateLabel(transfer: TransferSnapshot): string {
  switch (transfer.state) {
    case 'requesting':
      return 'requête envoyée';
    case 'queued':
      return transfer.queuePosition ? `en file, position ${transfer.queuePosition}` : 'en file';
    case 'awaiting-file':
      return 'connexion au pair';
    case 'streaming':
      return 'réception';
    case 'complete':
      return 'entièrement reçu';
    case 'failed':
      return 'échec';
    default:
      return 'annulé';
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: SIDE,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  emptyButton: {
    alignSelf: 'center',
    marginTop: spacing.lg,
  },
  pressed: {
    opacity: 0.8,
  },
  top: {
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  eyebrow: {
    ...type.eyebrow,
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
  },
  topQuery: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  art: {
    alignSelf: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 24 },
    elevation: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...type.title,
    color: colors.text,
  },
  artist: {
    ...type.body,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  scrubber: {
    marginTop: spacing.lg,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  skipLabel: {
    position: 'absolute',
    color: colors.text,
    fontSize: 9,
    fontWeight: '800',
    top: 18,
  },
  card: {
    marginTop: spacing.lg,
  },
  chip: {
    marginTop: 18,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.scrim,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chipIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    flex: 1,
    minWidth: 0,
  },
  chipUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipName: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  chipMeta: {
    color: colors.textOnMedia,
    fontSize: 11.5,
    marginTop: 2,
  },
  chipDetails: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
    gap: spacing.xs,
  },
  chipPath: {
    color: colors.textMuted,
    fontSize: 11.5,
    lineHeight: 16,
  },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
});
