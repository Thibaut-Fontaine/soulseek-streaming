import React from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import type { SearchHit } from '../core/types';
import { useAppStore } from '../state/store';
import type { PlayContext } from '../state/store';
import { FilterChip } from './components';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { TrackRow } from './track';
import { colors, formatBytes, gutter, spacing, type } from './theme';

type Filter = 'all' | 'liked' | 'history' | 'device';

const FILTERS: Array<{ id: Exclude<Filter, 'all'>; label: string }> = [
  { id: 'liked', label: 'Titres likés' },
  { id: 'history', label: 'Historique' },
  { id: 'device', label: 'Sur l’appareil' },
];

const RECENT_IN_OVERVIEW = 20;

export function LibraryScreen() {
  const username = useAppStore(state => state.username);
  const liked = useAppStore(state => state.library.liked);
  const history = useAppStore(state => state.library.history);
  const device = useAppStore(state => state.device);
  const settings = useAppStore(state => state.settings);
  const cacheStats = useAppStore(state => state.cacheStats);
  const importTracks = useAppStore(state => state.importTracks);
  const setTab = useAppStore(state => state.setTab);
  const playTrack = useAppStore(state => state.playTrack);
  const openSheet = useAppStore(state => state.openSheet);
  const [filter, setFilter] = React.useState<Filter>('all');
  // The tab stays mounted (TabHost); links from Accueil ("Tout voir") expect
  // the overview, so a filter does not outlive a visit.
  const tab = useAppStore(state => state.tab);
  React.useEffect(() => {
    if (tab !== 'library') {
      setFilter('all');
    }
  }, [tab]);

  const likedHits = React.useMemo(() => liked.map(track => track.hit), [liked]);
  const historyHits = React.useMemo(() => history.map(track => track.hit), [history]);
  const stats = cacheStats();
  const deviceBytes = (stats?.bytes ?? 0) + (stats?.importedBytes ?? 0);

  const lists: Record<Exclude<Filter, 'all'>, { items: SearchHit[]; label: string; caption: string }> = {
    liked: {
      items: likedHits,
      label: 'Titres likés',
      caption:
        likedHits.length > 0
          ? `${likedHits.length} titre${likedHits.length > 1 ? 's' : ''}`
          : 'Touchez ♥ dans le lecteur ou dans le menu d’un titre pour le retrouver ici.',
    },
    history: {
      items: historyHits,
      label: 'Historique',
      caption:
        historyHits.length > 0
          ? 'Les titres écoutés, du plus récent au plus ancien'
          : 'Les titres que vous écoutez apparaîtront ici.',
    },
    device: {
      items: device,
      label: 'Sur votre appareil',
      caption:
        device.length > 0
          ? `${device.length} titre${device.length > 1 ? 's' : ''} · ${formatBytes(deviceBytes)} · lisibles sans réseau${
              settings.shareEnabled ? ', partagés avec le réseau' : ''
            }`
          : 'Les morceaux écoutés en entier sont gardés ici (jusqu’à la taille choisie dans les réglages).',
    },
  };

  const more = React.useCallback((hit: SearchHit) => openSheet({ kind: 'actions', hit }), [openSheet]);

  const addFromPhone = async () => {
    try {
      const summary = await importTracks();
      if (summary) {
        Alert.alert('Ajout au partage', summary);
      }
    } catch (error) {
      Alert.alert('Ajout impossible', error instanceof Error ? error.message : String(error));
    }
  };

  const selected = filter === 'all' ? null : lists[filter];
  const items = selected?.items;
  const visible = React.useMemo(() => items ?? historyHits.slice(0, RECENT_IN_OVERVIEW), [items, historyHits]);
  const label = selected ? selected.label : 'Écoutés récemment';
  // Stable between renders so the memoized rows do not redraw.
  const playVisible = React.useCallback(
    (hit: SearchHit) => {
      const context: PlayContext = { label, items: visible, index: Math.max(0, visible.indexOf(hit)) };
      void playTrack(hit, context);
    },
    [label, visible, playTrack],
  );

  const header = (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profil et réglages"
          onPress={() => setTab('settings')}
          style={styles.avatar}>
          <Text style={styles.avatarLetter}>{(username ?? 'S').charAt(0).toUpperCase()}</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Bibliothèque
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajouter des MP3 du téléphone"
          onPress={() => void addFromPhone()}
          hitSlop={6}
          style={styles.headerButton}>
          <Icon name="plus" size={26} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {filter !== 'all' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tout afficher"
            onPress={() => setFilter('all')}
            style={styles.clearChip}>
            <Icon name="x" size={16} color={colors.text} />
          </Pressable>
        ) : null}
        {FILTERS.map(item => (
          <FilterChip
            key={item.id}
            label={item.label}
            selected={filter === item.id}
            onPress={() => setFilter(filter === item.id ? 'all' : item.id)}
          />
        ))}
      </ScrollView>

      {filter === 'all' ? (
        <>
          <Collection
            icon="heart"
            gradient
            title="Titres likés"
            meta={`Collection · ${likedHits.length} titre${likedHits.length > 1 ? 's' : ''}`}
            onPress={() => setFilter('liked')}
          />
          <Collection
            icon="clock"
            title="Historique"
            meta={`${historyHits.length} titre${historyHits.length > 1 ? 's' : ''} écouté${historyHits.length > 1 ? 's' : ''}`}
            onPress={() => setFilter('history')}
          />
          <Collection
            icon="download"
            tint={colors.success}
            title="Sur l’appareil"
            meta={`${device.length} titre${device.length > 1 ? 's' : ''} · ${formatBytes(deviceBytes)}${
              settings.shareEnabled ? ' · partagés' : ''
            }`}
            onPress={() => setFilter('device')}
          />
          {historyHits.length > 0 ? (
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Écoutés récemment
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.caption}>{selected?.caption}</Text>
      )}
    </>
  );

  // Liked titles, history (up to 200) and device tracks can be long: only the
  // rows near the screen are built.
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      data={visible}
      keyExtractor={rowKey}
      ListHeaderComponent={header}
      initialNumToRender={12}
      windowSize={7}
      renderItem={({ item }) => (
        <TrackRow hit={item} onDevice={filter === 'device'} onPress={playVisible} onMore={more} />
      )}
    />
  );
}

function rowKey(hit: SearchHit): string {
  return `${hit.username}:${hit.filename}`;
}

function Collection({
  icon,
  title,
  meta,
  gradient,
  tint,
  onPress,
}: {
  icon: IconName;
  title: string;
  meta: string;
  gradient?: boolean;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.collection, pressed && styles.pressed]}>
      <View style={[styles.collectionTile, tint ? { backgroundColor: tint } : null]}>
        {gradient ? <LinearGradient colors={LIKED_GRADIENT} start={START} end={END} style={StyleSheet.absoluteFill} /> : null}
        <Icon name={icon} size={26} filled={icon === 'heart'} color={tint ? colors.bg : colors.text} />
      </View>
      <View style={styles.collectionText}>
        <Text style={styles.collectionTitle}>{title}</Text>
        <Text style={styles.collectionMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

const LIKED_GRADIENT = ['#5B2DD6', '#C9A6FF'];
const START = { x: 0, y: 1 };
const END = { x: 1, y: 0 };

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 140,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: colors.onAccent,
    fontSize: 15,
    fontWeight: '800',
  },
  title: {
    ...type.title,
    flex: 1,
    color: colors.text,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: gutter,
    paddingBottom: spacing.md,
  },
  clearChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.75,
  },
  collectionTile: {
    width: 64,
    height: 64,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectionText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  collectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  collectionMeta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  sectionTitle: {
    ...type.heading,
    fontSize: 18,
    color: colors.text,
    paddingHorizontal: gutter,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  caption: {
    ...type.bodySm,
    color: colors.textMuted,
    paddingHorizontal: gutter,
    marginBottom: spacing.sm,
  },
});
