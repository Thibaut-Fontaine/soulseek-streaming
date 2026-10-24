import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackPlayer, { State, usePlaybackState, useProgress } from 'react-native-track-player';

import type { TransferSnapshot } from '../core/transfer';
import type { SearchHit } from '../core/types';
import { useAppStore } from '../state/store';
import { Dot, IconButton, StatusCard, TrackGradient } from './components';
import type { CardAction } from './components';
import { ACTION_LABELS, SHARING_EXPLANATION, describePlaybackError } from './errors';
import type { ErrorAction } from './errors';
import { useByteRate } from './hooks';
import { Icon } from './Icon';
import { QUEUE_WARN_POSITION, peerAvailability, sourceSummary } from './p2p';
import { Scrubber, TransferSteps } from './peer';
import { TrackCover, largeCoverUri, useIsLiked, useTrackInfo } from './track';
import { colors, coverSeed, percent, radius, spacing, type } from './theme';

const SIDE = spacing.xl;
const CLOSE_DISTANCE = 150;
const SKIP_DISTANCE = 80;

/**
 * Full-screen player. Slides up over the tabs from the bottom bar; pull it
 * down (or tap the chevron, or Android back) to close it. Swipe the cover
 * sideways to change track.
 */
export function PlayerSheet() {
  const open = useAppStore(state => state.playerOpen && state.current !== null);
  const { height } = useWindowDimensions();
  const translateY = React.useRef(new Animated.Value(height)).current;
  const [mounted, setMounted] = React.useState(open);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 18,
      }).start();
    } else {
      Animated.timing(translateY, { toValue: height, duration: 240, useNativeDriver: true }).start(
        ({ finished }) => finished && setMounted(false),
      );
    }
  }, [open, height, translateY]);

  if (!mounted) {
    return null;
  }

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.sheet, { transform: [{ translateY }] }]}
      accessibilityViewIsModal>
      <PlayerContent translateY={translateY} />
    </Animated.View>
  );
}

function PlayerContent({ translateY }: { translateY: Animated.Value }) {
  const current = useAppStore(state => state.current);
  const transfer = useAppStore(state =>
    state.current ? state.transfers[state.current.transferId] : undefined,
  );
  const context = useAppStore(state => state.context);
  const catalogContext = useAppStore(state => state.catalogContext);
  const openPage = useAppStore(state => state.openPage);
  const queue = useAppStore(state => state.queue);
  const shuffle = useAppStore(state => state.shuffle);
  const repeat = useAppStore(state => state.repeat);
  const closePlayer = useAppStore(state => state.closePlayer);
  const openSheet = useAppStore(state => state.openSheet);
  const stopPlayback = useAppStore(state => state.stopPlayback);
  const retryPlayback = useAppStore(state => state.retryPlayback);
  const playNextSource = useAppStore(state => state.playNextSource);
  const playNext = useAppStore(state => state.playNext);
  const playPrevious = useAppStore(state => state.playPrevious);
  const toggleLike = useAppStore(state => state.toggleLike);
  const toggleShuffle = useAppStore(state => state.toggleShuffle);
  const toggleRepeat = useAppStore(state => state.toggleRepeat);
  const reconnect = useAppStore(state => state.reconnect);
  const runSearch = useAppStore(state => state.runSearch);
  const setTab = useAppStore(state => state.setTab);

  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const progress = useProgress(250);
  const playbackState = usePlaybackState();
  const speed = useByteRate(transfer?.received ?? 0, transfer?.id);
  const info = useTrackInfo(current?.hit);
  const liked = useIsLiked(current?.hit);
  const artShift = React.useRef(new Animated.Value(0)).current;

  const latest = React.useRef({ closePlayer, playNext, playPrevious, position: 0 });
  latest.current = { closePlayer, playNext, playPrevious, position: progress.position };

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, g) =>
          (g.dy > 8 && g.dy > Math.abs(g.dx) * 1.2) || (Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy)),
        onPanResponderMove: (_event, g) => {
          if (Math.abs(g.dx) > Math.abs(g.dy)) {
            artShift.setValue(g.dx);
          } else {
            translateY.setValue(Math.max(0, g.dy));
          }
        },
        onPanResponderRelease: (_event, g) => {
          const actions = latest.current;

          if (Math.abs(g.dx) > Math.abs(g.dy)) {
            Animated.spring(artShift, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
            if (g.dx < -SKIP_DISTANCE) {
              void actions.playNext();
            } else if (g.dx > SKIP_DISTANCE) {
              void actions.playPrevious(0);
            }
            return;
          }

          if (g.dy > CLOSE_DISTANCE || g.vy > 1.2) {
            actions.closePlayer();
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(artShift, { toValue: 0, useNativeDriver: true }).start();
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [artShift, translateY],
  );

  if (!current) {
    return null;
  }

  const hit = current.hit;
  const state = playbackState.state;
  const playing = state === State.Playing;
  const preparing = current.phase === 'preparing';
  const hasError = current.phase === 'error' || state === State.Error;

  const duration =
    progress.duration && Number.isFinite(progress.duration) && progress.duration > 0
      ? progress.duration
      : hit.durationSec ?? 0;
  const position = Number.isFinite(progress.position) ? progress.position : 0;
  const total = transfer?.size || hit.size || 0;
  const receivedRatio =
    current.source === 'cache' || transfer?.state === 'complete' ? 1 : percent(transfer?.received ?? 0, total);

  const seekTo = async (seconds: number) => {
    try {
      await TrackPlayer.seekTo(seconds);
    } catch {
      // The player reports failures through its state.
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

  const searchThisTrack = () => {
    const text = [info.artist.startsWith('@') ? '' : info.artist, info.title].filter(Boolean).join(' ');
    closePlayer();
    setTab('search');
    void runSearch(text);
  };

  const toCardActions = (actions: ErrorAction[]): CardAction[] => [
    ...actions.map((action): CardAction => {
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
    }),
    { label: 'Chercher ce titre', icon: 'search', onPress: searchThisTrack },
  ];

  const failure = hasError
    ? describePlaybackError(
        current.error ?? 'Le flux audio n’a pas pu être lu. Le pair a peut-être coupé la connexion.',
        { receivedRatio },
      )
    : null;

  // Leave room for the controls on short screens.
  const artSize = Math.max(160, Math.min(width - SIDE * 2, height * 0.42, 420));
  const fromLabel = catalogContext?.label ?? context?.label ?? 'Lecture';
  const catalog = info.catalog;
  const album = catalog?.album ?? null;

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xs, paddingBottom: insets.bottom + spacing.md }]}>
      <Backdrop coverUri={largeCoverUri(info)} seed={coverSeed(hit)} />

      <View {...responder.panHandlers}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <IconButton icon="down" iconSize={28} accessibilityLabel="Réduire le lecteur" onPress={closePlayer} />
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Lecture depuis</Text>
            <Text style={styles.headerLabel} numberOfLines={1}>
              {fromLabel}
            </Text>
          </View>
          <IconButton
            icon="more"
            filled
            accessibilityLabel="Options du titre"
            onPress={() => openSheet({ kind: 'actions', hit })}
          />
        </View>

        <Animated.View
          style={[
            styles.artWrap,
            {
              transform: [
                { translateX: artShift },
                { rotate: artShift.interpolate({ inputRange: [-300, 300], outputRange: ['-6deg', '6deg'] }) },
              ],
            },
          ]}>
          <TrackCover hit={hit} size={artSize} rounded="sm" style={styles.art} />
        </Animated.View>

        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Pressable
              disabled={!album}
              accessibilityRole={album ? 'link' : undefined}
              accessibilityLabel={album ? `Aller à l’album ${album.title}` : undefined}
              onPress={() => album && openPage({ kind: 'album', id: album.id, title: album.title })}>
              <Text style={styles.title} numberOfLines={1}>
                {info.title}
              </Text>
            </Pressable>
            <Pressable
              disabled={!catalog}
              accessibilityRole={catalog ? 'link' : undefined}
              accessibilityLabel={catalog ? `Aller à l’artiste ${catalog.artist.name}` : undefined}
              onPress={() => catalog && openPage({ kind: 'artist', id: catalog.artist.id, name: catalog.artist.name })}>
              <Text style={styles.artist} numberOfLines={1}>
                {info.artist}
              </Text>
            </Pressable>
          </View>
          <IconButton
            icon="heart"
            filled={liked}
            color={liked ? colors.accent : colors.text}
            iconSize={26}
            accessibilityLabel={liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
            onPress={() => toggleLike(hit)}
          />
        </View>
      </View>

      <ScrollView style={styles.lower} contentContainerStyle={styles.lowerContent} showsVerticalScrollIndicator={false}>
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
          <View style={styles.scrubber}>
            <Scrubber
              position={position}
              duration={duration}
              receivedRatio={receivedRatio}
              onSeek={seconds => void seekTo(seconds)}
            />
          </View>
        )}

        <View style={styles.controls}>
          <Toggle icon="shuffle" label="Lecture aléatoire" on={shuffle} onPress={toggleShuffle} />
          <IconButton
            icon="prev"
            filled
            iconSize={30}
            size={52}
            accessibilityLabel="Précédent"
            onPress={() => void playPrevious(position)}
          />
          <IconButton
            icon={preparing ? 'x' : playing ? 'pause' : 'play'}
            filled={!preparing}
            size={68}
            iconSize={30}
            variant="white"
            accessibilityLabel={preparing ? 'Annuler' : playing ? 'Pause' : 'Lecture'}
            onPress={preparing ? () => void stopPlayback() : togglePlayback}
          />
          <IconButton icon="next" filled iconSize={30} size={52} accessibilityLabel="Suivant" onPress={() => void playNext()} />
          <Toggle icon="repeat" label="Répéter le titre" on={repeat} onPress={toggleRepeat} />
        </View>

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
            actions={[{ label: 'Autre source', icon: 'swap', onPress: () => void playNextSource() }]}
            style={styles.card}
          />
        ) : null}

        <View style={styles.bottomRow}>
          <SourceChip
            hit={hit}
            fromDevice={current.source === 'cache'}
            transfer={transfer}
            speed={speed}
            onPress={() => openSheet({ kind: 'sources', hits: [hit], title: info.title })}
          />
          <IconButton
            icon="queue"
            accessibilityLabel={`File d’attente${queue.length > 0 ? ` (${queue.length})` : ''}`}
            onPress={() => openSheet({ kind: 'queue' })}
          />
        </View>
      </ScrollView>
    </View>
  );
}

/** Blurred cover behind the player, like the big streaming apps. */
function Backdrop({ coverUri, seed }: { coverUri: string | null; seed: string }) {
  if (!coverUri) {
    return <TrackGradient seed={seed} />;
  }

  return (
    <>
      <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} blurRadius={40} resizeMode="cover" />
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

function Toggle({
  icon,
  label,
  on,
  onPress,
}: {
  icon: 'shuffle' | 'repeat';
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      hitSlop={6}
      style={styles.toggle}>
      <Icon name={icon} size={24} color={on ? colors.accent : colors.text} />
      <View style={[styles.toggleDot, on && styles.toggleDotOn]} />
    </Pressable>
  );
}

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
          actions={[{ label: 'Autre source', icon: 'swap', onPress: onOtherSource, variant: 'accent' }]}
          style={styles.card}
        />
      ) : null}
    </>
  );
}

function SourceChip({
  hit,
  fromDevice,
  transfer,
  speed,
  onPress,
}: {
  hit: SearchHit;
  fromDevice: boolean;
  transfer: TransferSnapshot | undefined;
  speed: number;
  onPress: () => void;
}) {
  const availability = peerAvailability(hit);
  const live = transfer?.state === 'streaming' ? speed : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fromDevice ? 'Lu depuis l’appareil' : `Source : ${hit.username}. Voir les sources`}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      {fromDevice ? (
        <Dot tone="good" />
      ) : (
        <Dot tone={availability === 'free' ? 'good' : availability === 'queued' ? 'warn' : 'bad'} />
      )}
      <Text style={styles.chipText} numberOfLines={1}>
        {fromDevice ? `Sur l’appareil · ${sourceSummary(hit)}` : `@${hit.username} · ${sourceSummary(hit, live)}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    zIndex: 20,
    elevation: 20,
  },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: SIDE,
  },
  pressed: {
    opacity: 0.8,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: -spacing.md,
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
  },
  eyebrow: {
    ...type.eyebrow,
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
  },
  headerLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  artWrap: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  art: {
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginRight: -spacing.md,
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
  lower: {
    flex: 1,
  },
  lowerContent: {
    paddingBottom: spacing.md,
  },
  scrubber: {
    marginTop: spacing.md,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  toggle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  toggleDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  toggleDotOn: {
    backgroundColor: colors.accent,
  },
  card: {
    marginTop: spacing.lg,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginRight: -spacing.sm,
  },
  chip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  chipText: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
});
