/**
 * Track pieces shared by every screen: cover (the MP3's own picture when it
 * has one), title/artist from its tag, and the standard list row.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { Artwork, CatalogTrack } from '../core/catalogTypes';
import { displayArtist, displayTitle, hitKey } from '../core/types';
import type { SearchHit } from '../core/types';
import { trackIdentity } from '../services/library';
import type { Library } from '../services/library';
import { useAppStore } from '../state/store';
import { pickArtwork, trackArtists } from './catalogFormat';
import { Cover, Dot } from './components';
import type { DotTone } from './components';
import { Icon } from './Icon';
import { peerAvailability } from './p2p';
import { colors, coverSeed, spacing } from './theme';

export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
  /** The MP3's own cover (ID3), when it has one. */
  coverUri: string | null;
  /** Catalog cover of the matched track; preferred over `coverUri`. */
  artwork: Artwork | null;
  /** The catalog track this file was matched to, if any. */
  catalog: CatalogTrack | null;
}

let savedCatalogs: { library: Library | null; byKey: Map<string, CatalogTrack> } = {
  library: null,
  byKey: new Map(),
};

/** Catalog tracks stored on liked/history entries, by song identity. */
function savedCatalogMap(library: Library): Map<string, CatalogTrack> {
  if (savedCatalogs.library !== library) {
    const byKey = new Map<string, CatalogTrack>();
    for (const saved of [...library.history, ...library.liked]) {
      if (saved.catalog) {
        byKey.set(saved.key, saved.catalog);
      }
    }
    savedCatalogs = { library, byKey };
  }
  return savedCatalogs.byKey;
}

/**
 * Catalog track matched to a Soulseek file, when the catalog knows it: the
 * live match first, else the one saved with a liked/history entry.
 */
export function useCatalogTrack(hit: SearchHit | null | undefined): CatalogTrack | null {
  const identity = React.useMemo(() => (hit ? trackIdentity(hit) : null), [hit]);
  return useAppStore(state => {
    if (!hit) {
      return null;
    }
    return state.trackForHit(hit) ?? (identity ? savedCatalogMap(state.library).get(identity) : null) ?? null;
  });
}

/**
 * Title, artist and cover of a hit: the catalog track it was matched to,
 * else its tag, else the file name.
 */
export function useTrackInfo(hit: SearchHit | null | undefined): TrackInfo {
  const meta = useAppStore(state => (hit ? state.meta[hitKey(hit)] : undefined));
  const catalog = useCatalogTrack(hit);

  if (!hit) {
    return { title: '', artist: '', coverUri: null, artwork: null, catalog: null };
  }

  return {
    title: catalog?.title || meta?.title || displayTitle(hit.filename),
    artist:
      (catalog ? trackArtists(catalog) : '') ||
      meta?.artist ||
      displayArtist(hit) ||
      (hit.username ? `@${hit.username}` : 'Sur l’appareil'),
    album: catalog?.album?.title || meta?.album,
    coverUri: meta?.coverUri ?? null,
    artwork: catalog?.album?.cover ?? null,
    catalog,
  };
}

/** Best cover URL for big surfaces (player backdrop). */
export function largeCoverUri(info: TrackInfo): string | null {
  return pickArtwork(info.artwork, 1000) ?? info.coverUri;
}

/** Whether the store holds this hit's song in the liked tracks. */
export function useIsLiked(hit: SearchHit | null | undefined): boolean {
  return useAppStore(state => {
    if (!hit) {
      return false;
    }
    const key = trackIdentity(hit);
    return state.library.liked.some(track => track.key === key);
  });
}

/** Whether this hit is the track being played. */
export function useIsCurrent(hit: SearchHit): boolean {
  return useAppStore(state => {
    const current = state.current?.hit;
    return !!current && trackIdentity(current) === trackIdentity(hit);
  });
}

export const TrackCover = React.memo(function TrackCover({
  hit,
  size,
  rounded = 'xs',
  style,
}: {
  hit: SearchHit;
  size: number;
  rounded?: 'xs' | 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const info = useTrackInfo(hit);
  const loadMeta = useAppStore(state => state.loadMeta);

  React.useEffect(() => {
    loadMeta(hit);
  }, [hit, loadMeta]);

  return (
    <Cover
      artwork={info.artwork}
      fallbackUri={info.coverUri}
      seed={coverSeed(hit)}
      title={info.title}
      size={size}
      rounded={rounded}
      style={style}
    />
  );
});

const AVAILABILITY: Record<ReturnType<typeof peerAvailability>, DotTone> = {
  free: 'good',
  queued: 'warn',
  busy: 'bad',
};

/** The standard song row: cover, title, artist line, ⋯ button. */
export const TrackRow = React.memo(function TrackRow({
  hit,
  detail,
  onPress,
  onMore,
  showAvailability,
  onDevice,
}: {
  hit: SearchHit;
  /** Extra text after the artist ("4 sources", "320 kb/s"). */
  detail?: string;
  onPress: (hit: SearchHit) => void;
  onMore?: (hit: SearchHit) => void;
  /** Coloured dot for the peer's slot / queue. */
  showAvailability?: boolean;
  /** Green "on the device" mark. */
  onDevice?: boolean;
}) {
  const info = useTrackInfo(hit);
  const active = useIsCurrent(hit);
  const subtitle = [info.artist, detail].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Écouter ${info.title}, ${info.artist}`}
        onPress={() => onPress(hit)}
        onLongPress={onMore ? () => onMore(hit) : undefined}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        <TrackCover hit={hit} size={48} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, active && styles.rowTitleActive]} numberOfLines={1}>
            {info.title}
          </Text>
          <View style={styles.rowSubtitle}>
            {onDevice ? <DeviceMark /> : null}
            {showAvailability && !onDevice ? <Dot tone={AVAILABILITY[peerAvailability(hit)]} /> : null}
            <Text style={styles.rowArtist} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
        {active ? <PlayingBars /> : null}
      </Pressable>
      {onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Options pour ${info.title}`}
          onPress={() => onMore(hit)}
          hitSlop={6}
          style={styles.more}>
          <Icon name="moreVertical" size={20} filled color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

/** Small green circle with a down arrow: the track is on the phone. */
export function DeviceMark({ size = 14 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="Sur l’appareil">
      <Circle cx={12} cy={12} r={11} fill={colors.success} />
      <Path
        d="M12 6.5v9m0 0-3.8-3.8M12 15.5l3.8-3.8"
        stroke={colors.bg}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Static "now playing" bars next to the current track in a list. */
export function PlayingBars() {
  return (
    <View style={styles.bars} accessibilityLabel="En cours de lecture">
      <View style={[styles.bar, styles.bar1]} />
      <View style={[styles.bar, styles.bar2]} />
      <View style={[styles.bar, styles.bar3]} />
    </View>
  );
}

/**
 * The app icon: a play button drawn by three connected peers. `round` gives
 * the circular variant.
 */
export function AppLogo({ size, round }: { size: number; round?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="SoulStream">
      {round ? (
        <Circle cx={50} cy={50} r={50} fill={colors.accent} />
      ) : (
        <Rect width={100} height={100} rx={23} fill={colors.accent} />
      )}
      <Path d="M37 29 L37 71 L73 50 Z" fill="none" stroke={colors.bg} strokeWidth={6.5} strokeLinejoin="round" />
      <Circle cx={37} cy={29} r={8.5} fill={colors.bg} />
      <Circle cx={37} cy={71} r={8.5} fill={colors.bg} />
      <Circle cx={73} cy={50} r={8.5} fill={colors.bg} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rowTitleActive: {
    color: colors.accent,
  },
  rowSubtitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowArtist: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: 13,
  },
  more: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 14,
    marginRight: spacing.xs,
  },
  bar: {
    width: 3,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  bar1: { height: 8 },
  bar2: { height: 14 },
  bar3: { height: 10 },
});
