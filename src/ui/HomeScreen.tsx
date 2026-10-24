import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import type { SearchHit } from '../core/types';
import { useAppStore } from '../state/store';
import type { PlayContext } from '../state/store';
import { Button, EmptyState } from './components';
import { Icon } from './Icon';
import { AppLogo, DeviceMark, TrackCover, useIsCurrent, useTrackInfo } from './track';
import { colors, gutter, spacing, type } from './theme';

const QUICK_COUNT = 6;
const SHELF_COUNT = 12;

export function HomeScreen() {
  const username = useAppStore(state => state.username);
  const history = useAppStore(state => state.library.history);
  const liked = useAppStore(state => state.library.liked);
  const recentSearches = useAppStore(state => state.library.recentSearches);
  const device = useAppStore(state => state.device);
  const setTab = useAppStore(state => state.setTab);
  const playTrack = useAppStore(state => state.playTrack);
  const runSearch = useAppStore(state => state.runSearch);
  const openSheet = useAppStore(state => state.openSheet);

  const recent = React.useMemo(() => history.slice(0, QUICK_COUNT).map(t => t.hit), [history]);
  const likedHits = React.useMemo(() => liked.slice(0, SHELF_COUNT).map(t => t.hit), [liked]);
  const deviceHits = React.useMemo(() => device.slice(0, SHELF_COUNT), [device]);

  const play = (items: SearchHit[], label: string) => (hit: SearchHit) => {
    const context: PlayContext = { label, items, index: Math.max(0, items.indexOf(hit)) };
    void playTrack(hit, context);
  };
  const more = (hit: SearchHit) => openSheet({ kind: 'actions', hit });

  const nothingYet = recent.length === 0 && deviceHits.length === 0 && likedHits.length === 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={HEADER_FADE} style={styles.headerFade} pointerEvents="none" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profil et réglages"
          onPress={() => setTab('settings')}
          style={styles.avatar}>
          <Text style={styles.avatarLetter}>{(username ?? 'S').charAt(0).toUpperCase()}</Text>
        </Pressable>
        <Text style={styles.greeting} accessibilityRole="header">
          {greeting()}
        </Text>
      </View>

      {nothingYet ? (
        <View style={styles.welcome}>
          <AppLogo size={72} />
          <EmptyState
            icon="search"
            title="Votre musique apparaîtra ici"
            body="Cherchez un titre et touchez-le pour l’écouter. Vos écoutes, vos titres likés et les morceaux gardés sur le téléphone se retrouvent sur cette page.">
            <Button label="Rechercher" icon="search" onPress={() => setTab('search')} style={styles.welcomeButton} />
          </EmptyState>
        </View>
      ) : null}

      {recent.length > 0 ? (
        <View style={styles.quickGrid}>
          {recent.map(hit => (
            <QuickTile key={`${hit.username}:${hit.filename}`} hit={hit} onPress={play(recent, 'Écoutés récemment')} onLongPress={more} />
          ))}
        </View>
      ) : null}

      {deviceHits.length > 0 ? (
        <Shelf
          title="Sur votre appareil"
          subtitle="Démarrage instantané, même sans réseau"
          hits={deviceHits}
          onDevice
          onPress={play(device, 'Sur votre appareil')}
          onLongPress={more}
          onAll={() => setTab('library')}
        />
      ) : null}

      {likedHits.length > 0 ? (
        <Shelf
          title="Vos titres likés"
          hits={likedHits}
          onPress={play(liked.map(t => t.hit), 'Titres likés')}
          onLongPress={more}
          onAll={() => setTab('library')}
        />
      ) : null}

      {recentSearches.length > 0 ? (
        <>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Recherches récentes
          </Text>
          <View style={styles.chips}>
            {recentSearches.map(query => (
              <Pressable
                key={query}
                accessibilityRole="button"
                accessibilityLabel={`Rechercher ${query}`}
                onPress={() => {
                  setTab('search');
                  void runSearch(query);
                }}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                <Icon name="search" size={14} color={colors.textMuted} />
                <Text style={styles.chipLabel} numberOfLines={1}>
                  {query}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5 || hour >= 18) {
    return 'Bonsoir';
  }
  return hour < 12 ? 'Bonjour' : 'Bon après-midi';
}

const QuickTile = React.memo(function QuickTile({
  hit,
  onPress,
  onLongPress,
}: {
  hit: SearchHit;
  onPress: (hit: SearchHit) => void;
  onLongPress: (hit: SearchHit) => void;
}) {
  const info = useTrackInfo(hit);
  const active = useIsCurrent(hit);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Écouter ${info.title}`}
      onPress={() => onPress(hit)}
      onLongPress={() => onLongPress(hit)}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed]}>
      <TrackCover hit={hit} size={56} rounded="xs" style={styles.quickCover} />
      <Text style={[styles.quickTitle, active && styles.activeText]} numberOfLines={2}>
        {info.title}
      </Text>
    </Pressable>
  );
});

function Shelf({
  title,
  subtitle,
  hits,
  onDevice,
  onPress,
  onLongPress,
  onAll,
}: {
  title: string;
  subtitle?: string;
  hits: SearchHit[];
  onDevice?: boolean;
  onPress: (hit: SearchHit) => void;
  onLongPress: (hit: SearchHit) => void;
  onAll: () => void;
}) {
  return (
    <View style={styles.shelf}>
      <View style={styles.shelfHead}>
        <View style={styles.shelfText}>
          <Text style={styles.sectionTitleInline} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.shelfSubtitle}>{subtitle}</Text> : null}
        </View>
        <Pressable onPress={onAll} hitSlop={8} accessibilityRole="button">
          <Text style={styles.shelfAll}>Tout afficher</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
        {hits.map(hit => (
          <ShelfCard key={`${hit.username}:${hit.filename}`} hit={hit} onDevice={onDevice} onPress={onPress} onLongPress={onLongPress} />
        ))}
      </ScrollView>
    </View>
  );
}

const CARD = 140;

const ShelfCard = React.memo(function ShelfCard({
  hit,
  onDevice,
  onPress,
  onLongPress,
}: {
  hit: SearchHit;
  onDevice?: boolean;
  onPress: (hit: SearchHit) => void;
  onLongPress: (hit: SearchHit) => void;
}) {
  const info = useTrackInfo(hit);
  const active = useIsCurrent(hit);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Écouter ${info.title}, ${info.artist}`}
      onPress={() => onPress(hit)}
      onLongPress={() => onLongPress(hit)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <TrackCover hit={hit} size={CARD} rounded="sm" style={styles.cardCover} />
      <Text style={[styles.cardTitle, active && styles.activeText]} numberOfLines={1}>
        {info.title}
      </Text>
      <View style={styles.cardArtistRow}>
        {onDevice ? <DeviceMark size={12} /> : null}
        <Text style={styles.cardArtist} numberOfLines={1}>
          {info.artist}
        </Text>
      </View>
    </Pressable>
  );
});

const HEADER_FADE = ['rgba(169,112,255,0.28)', 'rgba(11,10,15,0)'];

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 140,
  },
  headerFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
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
  greeting: {
    ...type.title,
    color: colors.text,
  },
  welcome: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  welcomeButton: {
    alignSelf: 'center',
    marginTop: spacing.lg,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: gutter,
  },
  quick: {
    width: '48.5%',
    flexGrow: 1,
    flexBasis: '45%',
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  quickCover: {
    borderRadius: 0,
  },
  quickTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
    paddingRight: spacing.sm,
  },
  activeText: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.75,
  },
  shelf: {
    marginTop: 28,
  },
  shelfHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: gutter,
    marginBottom: spacing.md,
  },
  shelfText: {
    flex: 1,
  },
  shelfSubtitle: {
    ...type.bodySm,
    color: colors.textMuted,
    marginTop: 2,
  },
  shelfAll: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  shelfRow: {
    gap: 14,
    paddingHorizontal: gutter,
  },
  card: {
    width: CARD,
  },
  cardCover: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  cardArtistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  cardArtist: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: 12,
  },
  sectionTitle: {
    ...type.heading,
    color: colors.text,
    paddingHorizontal: gutter,
    marginTop: 28,
    marginBottom: spacing.md,
  },
  sectionTitleInline: {
    ...type.heading,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: gutter,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    maxWidth: '100%',
  },
  chipLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
});
