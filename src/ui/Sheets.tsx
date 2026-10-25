import React from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CatalogPlayContext, CatalogTrack, Page } from '../core/catalogTypes';
import { hitKey } from '../core/types';
import type { SearchHit } from '../core/types';
import { trackIdentity } from '../services/library';
import { useAppStore } from '../state/store';
import type { PlayContext, Sheet } from '../state/store';
import { trackArtists } from './catalogFormat';
import { Cover } from './components';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { groupSources } from './p2p';
import { SourceRow } from './peer';
import { TrackCover, TrackRow, useIsLiked, useTrackInfo } from './track';
import { colors, radius, spacing, type } from './theme';

/** Renders the open bottom sheet, above the tabs and the player. */
export function SheetHost() {
  const sheet = useAppStore(state => state.sheet);
  const closeSheet = useAppStore(state => state.closeSheet);
  const [shown, setShown] = React.useState<Sheet | null>(sheet);
  const progress = React.useRef(new Animated.Value(0)).current;
  const { height } = useWindowDimensions();

  React.useEffect(() => {
    if (sheet) {
      setShown(sheet);
      progress.setValue(0);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(
        ({ finished }) => finished && setShown(null),
      );
    }
  }, [sheet, progress]);

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, g) => g.dy > 8 && g.dy > Math.abs(g.dx),
        onPanResponderMove: (_event, g) => progress.setValue(Math.max(0, 1 - g.dy / 400)),
        onPanResponderRelease: (_event, g) => {
          if (g.dy > 100 || g.vy > 1) {
            closeSheet();
          } else {
            Animated.spring(progress, { toValue: 1, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
      }),
    [progress, closeSheet],
  );

  if (!shown) {
    return null;
  }

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.6, 0] });

  return (
    <View style={[StyleSheet.absoluteFill, styles.host]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} accessibilityLabel="Fermer" />
      </Animated.View>
      <Animated.View
        style={[styles.panel, shown.kind === 'queue' && styles.panelTall, { transform: [{ translateY }] }]}
        accessibilityViewIsModal>
        <View {...responder.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />
        </View>
        {shown.kind === 'actions' ? (
          <TrackActions hit={shown.hit} context={shown.context} />
        ) : shown.kind === 'catalogActions' ? (
          <CatalogActions track={shown.track} context={shown.context} />
        ) : shown.kind === 'sources' ? (
          <Sources hits={shown.hits} title={shown.title} />
        ) : (
          <Queue />
        )}
      </Animated.View>
    </View>
  );
}

function SheetFooter() {
  const insets = useSafeAreaInsets();
  return <View style={{ height: insets.bottom + spacing.md }} />;
}

/** All network sources of the same song, from the last search. */
function useSourcesOf(hit: SearchHit): SearchHit[] {
  const results = useAppStore(state => state.results);

  return React.useMemo(() => {
    const groups = groupSources(results.map(ranked => ranked.hit));
    const key = hitKey(hit);
    const group = groups.find(item => item.hits.some(other => hitKey(other) === key));
    return group ? group.hits : hit.username ? [hit] : [];
  }, [results, hit]);
}

function TrackActions({ hit, context }: { hit: SearchHit; context?: PlayContext }) {
  const info = useTrackInfo(hit);
  const liked = useIsLiked(hit);
  const sources = useSourcesOf(hit);
  const onDevice = useAppStore(state => state.device.some(other => hitKey(other) === hitKey(hit)));
  const isCurrent = useAppStore(state => !!state.current && trackIdentity(state.current.hit) === trackIdentity(hit));
  const closeSheet = useAppStore(state => state.closeSheet);
  const openSheet = useAppStore(state => state.openSheet);
  const toggleLike = useAppStore(state => state.toggleLike);
  const enqueue = useAppStore(state => state.enqueue);
  const playTrack = useAppStore(state => state.playTrack);
  const stopPlayback = useAppStore(state => state.stopPlayback);
  const runSearch = useAppStore(state => state.runSearch);
  const setTab = useAppStore(state => state.setTab);
  const closePlayer = useAppStore(state => state.closePlayer);

  const run = (action: () => void) => () => {
    closeSheet();
    action();
  };

  const openPage = useAppStore(state => state.openPage);
  const artist = info.artist.startsWith('@') ? null : info.artist;
  const catalog = info.catalog;

  return (
    <>
      <View style={styles.trackHead}>
        <TrackCover hit={hit} size={52} />
        <View style={styles.trackHeadText}>
          <Text style={styles.trackTitle} numberOfLines={1}>
            {info.title}
          </Text>
          <Text style={styles.trackMeta} numberOfLines={1}>
            {[info.artist, info.album].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <ScrollView bounces={false}>
        {!isCurrent ? (
          <ActionRow icon="play" filled label="Écouter" onPress={run(() => void playTrack(hit, context))} />
        ) : null}
        <ActionRow
          icon="heart"
          filled={liked}
          accent={liked}
          label={liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
          onPress={run(() => toggleLike(hit))}
        />
        {!isCurrent ? (
          <>
            <ActionRow icon="playNext" label="Lire ensuite" onPress={run(() => enqueue(hit, true))} />
            <ActionRow icon="queue" label="Ajouter à la file d’attente" onPress={run(() => enqueue(hit))} />
          </>
        ) : null}
        {sources.length > 0 ? (
          <ActionRow
            icon="peer"
            label="Voir les sources"
            meta={`${sources.length} pair${sources.length > 1 ? 's' : ''}`}
            onPress={() => openSheet({ kind: 'sources', hits: sources, title: info.title, context })}
          />
        ) : null}
        {onDevice ? <ActionRow icon="download" label="Sur l’appareil, lisible sans réseau" onPress={closeSheet} /> : null}
        {catalog ? (
          <GoToRows
            track={catalog}
            onOpen={page => {
              closeSheet();
              openPage(page);
            }}
          />
        ) : artist ? (
          <ActionRow
            icon="search"
            label={`Rechercher « ${artist} »`}
            onPress={run(() => {
              closePlayer();
              setTab('search');
              void runSearch(artist);
            })}
          />
        ) : null}
        {isCurrent ? <ActionRow icon="stop" label="Arrêter la lecture" onPress={run(() => void stopPlayback())} /> : null}
        <SheetFooter />
      </ScrollView>
    </>
  );
}

function GoToRows({ track, onOpen }: { track: CatalogTrack; onOpen: (page: Page) => void }) {
  const album = track.album;
  return (
    <>
      <ActionRow
        icon="user"
        label="Aller à l’artiste"
        meta={track.artist.name}
        onPress={() => onOpen({ kind: 'artist', id: track.artist.id, name: track.artist.name })}
      />
      {album ? (
        <ActionRow
          icon="disc"
          label="Aller à l’album"
          meta={album.title}
          onPress={() => onOpen({ kind: 'album', id: album.id, title: album.title })}
        />
      ) : null}
    </>
  );
}

/** Menu of a catalog track: play, queue, artist/album pages, sources. */
function CatalogActions({ track, context }: { track: CatalogTrack; context?: CatalogPlayContext }) {
  const group = useAppStore(state => state.groups.find(item => item.track?.id === track.id));
  const resolution = useAppStore(state => state.resolutions[track.id]);
  const isCurrent = useAppStore(state => !!state.current && state.trackForHit(state.current.hit)?.id === track.id);
  const closeSheet = useAppStore(state => state.closeSheet);
  const openSheet = useAppStore(state => state.openSheet);
  const openPage = useAppStore(state => state.openPage);
  const playCatalogTrack = useAppStore(state => state.playCatalogTrack);
  const enqueueCatalogTrack = useAppStore(state => state.enqueueCatalogTrack);
  const resolveTrack = useAppStore(state => state.resolveTrack);

  const sources = (group?.sources.length ? group.sources : resolution?.sources ?? []).map(ranked => ranked.hit);
  const searching = resolution?.status === 'searching';
  const run = (action: () => void) => () => {
    closeSheet();
    action();
  };
  const showSources = (hits: SearchHit[]) => openSheet({ kind: 'sources', hits, title: track.title });
  const findSources = () => {
    if (searching) {
      return;
    }
    void resolveTrack(track, true).then(result => {
      if (result.sources.length > 0 && useAppStore.getState().sheet?.kind === 'catalogActions') {
        showSources(result.sources.map(ranked => ranked.hit));
      }
    });
  };

  return (
    <>
      <View style={styles.trackHead}>
        <Cover artwork={track.album?.cover} seed={track.id} title={track.title} size={52} rounded="xs" />
        <View style={styles.trackHeadText}>
          <Text style={styles.trackTitle} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={styles.trackMeta} numberOfLines={1}>
            {[trackArtists(track), track.album?.title].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <ScrollView bounces={false}>
        {!isCurrent ? (
          <>
            <ActionRow icon="play" filled label="Écouter" onPress={run(() => void playCatalogTrack(track, context))} />
            <ActionRow icon="playNext" label="Lire ensuite" onPress={run(() => enqueueCatalogTrack(track, true))} />
            <ActionRow icon="queue" label="Ajouter à la file d’attente" onPress={run(() => enqueueCatalogTrack(track))} />
          </>
        ) : null}
        <GoToRows
          track={track}
          onOpen={page => {
            closeSheet();
            openPage(page);
          }}
        />
        {sources.length > 0 ? (
          <ActionRow
            icon="peer"
            label="Voir les sources"
            meta={`${sources.length} pair${sources.length > 1 ? 's' : ''}`}
            onPress={() => showSources(sources)}
          />
        ) : (
          <ActionRow
            icon="search"
            label={searching ? 'Recherche de sources…' : 'Chercher des sources'}
            meta={resolution?.status === 'none' ? 'Aucune trouvée' : undefined}
            onPress={findSources}
          />
        )}
        <SheetFooter />
      </ScrollView>
    </>
  );
}

function ActionRow({
  icon,
  label,
  meta,
  filled,
  accent,
  onPress,
}: {
  icon: IconName;
  label: string;
  meta?: string;
  filled?: boolean;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Icon name={icon} size={24} filled={filled} color={accent ? colors.accent : colors.textMuted} />
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
      {meta ? (
        <Text style={styles.actionMeta} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Sources({ hits, title }: { hits: SearchHit[]; title: string }) {
  const sources = useSourcesOf(hits[0]);
  // Catalog groups can hold files with different names; keep the bigger list.
  const list = sources.length >= hits.length ? sources : hits;
  const currentKey = useAppStore(state =>
    state.current && state.current.source === 'network' ? hitKey(state.current.hit) : null,
  );
  const playHit = useAppStore(state => state.playHit);
  const closeSheet = useAppStore(state => state.closeSheet);

  return (
    <>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>Sources</Text>
        <Text style={styles.sheetSubtitle} numberOfLines={2}>
          {title} · les pairs qui ont ce fichier, le plus disponible en premier
        </Text>
      </View>
      <ScrollView bounces={false} style={styles.sourcesList}>
        {list.map((hit, index) => (
          <SourceRow
            key={hitKey(hit)}
            hit={hit}
            chosen={hitKey(hit) === currentKey}
            last={index === list.length - 1}
            onPress={picked => {
              closeSheet();
              void playHit(picked);
            }}
          />
        ))}
        {list.length <= 1 ? (
          <Text style={styles.empty}>
            Lancez une recherche pour ce titre afin de voir d’autres pairs qui l’ont.
          </Text>
        ) : null}
        <SheetFooter />
      </ScrollView>
    </>
  );
}

const UP_NEXT_LIMIT = 30;

function Queue() {
  const current = useAppStore(state => state.current);
  const queue = useAppStore(state => state.queue);
  const context = useAppStore(state => state.context);
  const device = useAppStore(state => state.device);
  const removeFromQueue = useAppStore(state => state.removeFromQueue);
  const playHit = useAppStore(state => state.playHit);
  const playTrack = useAppStore(state => state.playTrack);
  const closeSheet = useAppStore(state => state.closeSheet);

  const deviceKeys = React.useMemo(() => new Set(device.map(hitKey)), [device]);
  const upNext = context ? context.items.slice(context.index + 1, context.index + 1 + UP_NEXT_LIMIT) : [];

  return (
    <>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>File d’attente</Text>
      </View>
      <ScrollView>
        {current ? (
          <>
            <Text style={styles.queueSection}>En cours de lecture</Text>
            <TrackRow hit={current.hit} onDevice={current.source === 'cache'} onPress={closeSheet} />
          </>
        ) : null}

        {queue.length > 0 ? (
          <>
            <Text style={styles.queueSection}>Dans la file</Text>
            {queue.map((hit, index) => (
              <View key={`${hitKey(hit)}:${index}`} style={styles.queueRow}>
                <View style={styles.queueRowMain}>
                  <TrackRow
                    hit={hit}
                    onDevice={deviceKeys.has(hitKey(hit))}
                    onPress={() => {
                      removeFromQueue(index);
                      closeSheet();
                      void playHit(hit);
                    }}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retirer de la file"
                  onPress={() => removeFromQueue(index)}
                  hitSlop={6}
                  style={styles.queueRemove}>
                  <Icon name="x" size={18} color={colors.textDim} />
                </Pressable>
              </View>
            ))}
          </>
        ) : null}

        {context && upNext.length > 0 ? (
          <>
            <Text style={styles.queueSection}>À suivre · {context.label}</Text>
            {upNext.map((hit, offset) => (
              <TrackRow
                key={`${hitKey(hit)}:ctx${offset}`}
                hit={hit}
                onDevice={deviceKeys.has(hitKey(hit))}
                onPress={() => {
                  closeSheet();
                  void playTrack(hit, { ...context, index: context.index + 1 + offset });
                }}
              />
            ))}
          </>
        ) : null}

        {queue.length === 0 && upNext.length === 0 ? (
          <Text style={styles.empty}>
            Rien à suivre. Dans le menu ⋮ d’un titre, choisissez « Lire ensuite » ou « Ajouter à la file d’attente ».
          </Text>
        ) : null}
        <SheetFooter />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  host: {
    zIndex: 30,
    elevation: 30,
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
  },
  panelTall: {
    top: 56,
    // `undefined` would not override the 85% above.
    maxHeight: '100%',
    backgroundColor: colors.surface,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  pressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  trackHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  trackHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  trackTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  trackMeta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
  },
  actionLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  actionMeta: {
    color: colors.textMuted,
    fontSize: 13,
    maxWidth: '45%',
  },
  sheetHead: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  sheetTitle: {
    ...type.heading,
    color: colors.text,
  },
  sheetSubtitle: {
    ...type.bodySm,
    color: colors.textMuted,
    marginTop: 2,
  },
  sourcesList: {
    paddingHorizontal: spacing.lg,
  },
  empty: {
    ...type.bodySm,
    color: colors.textMuted,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  queueSection: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueRowMain: {
    flex: 1,
    minWidth: 0,
  },
  queueRemove: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
});
