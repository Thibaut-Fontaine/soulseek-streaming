/**
 * Building blocks for catalog content (Deezer tracks, artists, albums):
 * track rows, cards, shelves, play buttons and loading skeletons.
 * Shared by the pages, the catalog search results and the home page.
 */
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import type { CatalogAlbum, CatalogArtist, CatalogTrack } from '../core/catalogTypes';
import { useAppStore } from '../state/store';
import { albumCardSubtitle, sourcesLabel, trackArtists } from './catalogFormat';
import { Cover, IconButton, Skeleton } from './components';
import { Icon } from './Icon';
import { PlayingBars } from './track';
import { colors, formatDuration, gutter, radius, spacing, type } from './theme';

/** Whether this catalog track is the one playing. */
export function useIsCurrentCatalog(track: CatalogTrack): boolean {
  return useAppStore(state => !!state.current && state.trackForHit(state.current.hit)?.id === track.id);
}

/** Small "E" mark next to explicit tracks. */
export function ExplicitBadge() {
  return (
    <View style={styles.explicit} accessibilityLabel="Explicite">
      <Text style={styles.explicitLabel} allowFontScaling={false}>
        E
      </Text>
    </View>
  );
}

/** "3 sources" pill; opens the sources sheet. */
export function SourcesChip({ count, onPress }: { count: number; onPress?: () => void }) {
  const label = sourcesLabel(count);
  const content = (
    <>
      <Icon name="peer" size={12} strokeWidth={2.4} color={count > 0 ? colors.accent : colors.textDim} />
      <Text style={[styles.chipLabel, count === 0 && styles.chipLabelDim]}>{label}</Text>
    </>
  );

  if (!onPress || count === 0) {
    return <View style={[styles.chip, count === 0 && styles.chipDim]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Voir les ${label}`}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

/**
 * Row of a catalog track: cover (or its number on album pages), title,
 * artist line, duration and ⋮. Shows whether Soulseek sources were found
 * (`resolutions`): a spinner while searching, greyed when there are none.
 */
export const CatalogTrackRow = React.memo(function CatalogTrackRow({
  track,
  onPress,
  onMore,
  number,
  hideCover,
  subtitle,
  sources,
  onSources,
  showDuration = true,
}: {
  track: CatalogTrack;
  onPress: (track: CatalogTrack) => void;
  onMore?: (track: CatalogTrack) => void;
  /** Shown in place of the cover (album track number, top track rank). */
  number?: number;
  hideCover?: boolean;
  /** Replaces "artist · album". */
  subtitle?: string;
  /** Known Soulseek sources; shows the chip when set. */
  sources?: number;
  onSources?: () => void;
  showDuration?: boolean;
}) {
  const active = useIsCurrentCatalog(track);
  const resolution = useAppStore(state => state.resolutions[track.id]);
  const status = resolution?.status;
  const unavailable = status === 'none';
  const line =
    status === 'searching'
      ? 'Recherche de sources…'
      : status === 'none'
      ? 'Aucune source sur le réseau pour l’instant'
      : status === 'error'
      ? 'Recherche impossible · touchez pour réessayer'
      : subtitle ?? [trackArtists(track), track.album?.title].filter(Boolean).join(' · ');

  return (
    <View style={[styles.row, unavailable && styles.unavailable]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Écouter ${track.title}, ${trackArtists(track)}`}
        accessibilityHint={unavailable ? 'Aucune source trouvée pour ce titre' : undefined}
        onPress={() => onPress(track)}
        onLongPress={onMore ? () => onMore(track) : undefined}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
      >
        {number !== undefined ? (
          <Text style={[styles.number, active && styles.activeText]} allowFontScaling={false}>
            {number}
          </Text>
        ) : null}
        {!hideCover ? (
          <Cover artwork={track.album?.cover} seed={track.id} title={track.title} size={48} rounded="xs" />
        ) : null}
        <View style={styles.rowText}>
          <Text style={[styles.title, active && styles.activeText]} numberOfLines={1}>
            {hideCover && track.titleShort ? track.titleShort : track.title}
          </Text>
          <View style={styles.subtitleRow}>
            {track.explicit ? <ExplicitBadge /> : null}
            <Text style={[styles.subtitle, status === 'error' && styles.subtitleError]} numberOfLines={1}>
              {line}
            </Text>
          </View>
        </View>
        {sources !== undefined ? <SourcesChip count={sources} onPress={onSources} /> : null}
        {status === 'searching' ? (
          <ActivityIndicator size="small" color={colors.textMuted} accessibilityLabel="Recherche de sources" />
        ) : active ? (
          <PlayingBars />
        ) : null}
        {showDuration && sources === undefined ? (
          <Text style={styles.duration}>{formatDuration(track.durationSec)}</Text>
        ) : null}
      </Pressable>
      {onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Options pour ${track.title}`}
          onPress={() => onMore(track)}
          hitSlop={6}
          style={styles.more}
        >
          <Icon name="moreVertical" size={20} filled color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

export const CARD = 140;
const ARTIST_CARD = 120;

export const AlbumCard = React.memo(function AlbumCard({
  album,
  onPress,
  withArtist,
  subtitle,
}: {
  album: CatalogAlbum;
  onPress: (album: CatalogAlbum) => void;
  /** Replaces the default subtitle. */
  subtitle?: string;
  /** "Artist · Album" instead of "2001 · Album" (home, search). */
  withArtist?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Album ${album.title}, ${album.artist.name}`}
      onPress={() => onPress(album)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Cover
        artwork={album.cover}
        seed={album.id}
        title={album.title}
        size={CARD}
        rounded="sm"
        style={styles.cardShadow}
      />
      <Text style={styles.cardTitle} numberOfLines={2}>
        {album.title}
      </Text>
      <Text style={styles.cardSubtitle} numberOfLines={1}>
        {subtitle ?? albumCardSubtitle(album, withArtist)}
      </Text>
    </Pressable>
  );
});

export const ArtistCard = React.memo(function ArtistCard({
  artist,
  onPress,
}: {
  artist: CatalogArtist;
  onPress: (artist: CatalogArtist) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Artiste ${artist.name}`}
      onPress={() => onPress(artist)}
      style={({ pressed }) => [styles.artistCard, pressed && styles.pressed]}
    >
      <Cover artwork={artist.picture} seed={artist.id} title={artist.name} size={ARTIST_CARD} rounded="round" />
      <Text style={styles.artistName} numberOfLines={2}>
        {artist.name}
      </Text>
      <Text style={styles.cardSubtitle}>Artiste</Text>
    </Pressable>
  );
});

export function Shelf({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.shelf, style]}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
        {children}
      </ScrollView>
    </View>
  );
}

export function SectionTitle({ title, style }: { title: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

/** "Afficher plus" / "Afficher moins" under a short list. */
export function MoreToggle({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const label = expanded ? 'Afficher moins' : 'Afficher plus';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.moreToggle}>
      <Text style={styles.moreToggleLabel}>{label}</Text>
    </Pressable>
  );
}

/** Shuffle + big Play, right-aligned like the big streaming apps. */
export function PlayButtons({
  label,
  onPlay,
  onShuffle,
  disabled,
  left,
}: {
  /** What is played, for screen readers ("Daft Punk", "Discovery"). */
  label: string;
  onPlay: () => void;
  onShuffle: () => void;
  disabled?: boolean;
  left?: React.ReactNode;
}) {
  return (
    <View style={styles.playRow}>
      <View style={styles.playLeft}>{left}</View>
      <IconButton
        icon="shuffle"
        size={48}
        iconSize={26}
        color={colors.textMuted}
        disabled={disabled}
        accessibilityLabel={`Lecture aléatoire : ${label}`}
        onPress={onShuffle}
      />
      <IconButton
        icon="play"
        filled
        size={56}
        iconSize={26}
        variant="accent"
        disabled={disabled}
        accessibilityLabel={`Écouter ${label}`}
        onPress={onPlay}
      />
    </View>
  );
}

export function TrackListSkeleton({ count = 5, covers = true }: { count?: number; covers?: boolean }) {
  return (
    <View accessibilityLabel="Chargement…">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          {covers ? <Skeleton width={48} height={48} /> : null}
          <View style={styles.skeletonText}>
            <Skeleton width={`${60 - (index % 3) * 10}%`} height={14} />
            <Skeleton width={`${40 - (index % 2) * 10}%`} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ShelfSkeleton({ round }: { round?: boolean }) {
  const size = round ? ARTIST_CARD : CARD;
  return (
    <View style={styles.shelf}>
      <Skeleton width={160} height={20} style={styles.skeletonHeading} />
      <View style={styles.shelfRow}>
        {[0, 1, 2].map(index => (
          <View key={index} style={styles.skeletonCard}>
            <Skeleton width={size} height={size} round={round} />
            <Skeleton width={size * 0.7} height={12} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  activeText: {
    color: colors.accent,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: gutter,
    paddingRight: spacing.xs,
  },
  unavailable: {
    opacity: 0.45,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  number: {
    width: 22,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subtitle: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: 13,
  },
  subtitleError: {
    color: colors.danger,
  },
  duration: {
    color: colors.textDim,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  more: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explicit: {
    width: 15,
    height: 15,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explicitLabel: {
    color: colors.bg,
    fontSize: 9.5,
    fontWeight: '900',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  chipDim: {
    backgroundColor: colors.surfaceAlt,
  },
  chipLabel: {
    ...type.badge,
    color: colors.accent,
  },
  chipLabelDim: {
    color: colors.textDim,
  },
  card: {
    width: CARD,
  },
  cardShadow: {
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
  cardSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  cardSubtitle: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  artistCard: {
    width: ARTIST_CARD,
    alignItems: 'center',
  },
  artistName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  shelf: {
    marginTop: spacing.xl,
  },
  shelfRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: gutter,
  },
  sectionTitle: {
    ...type.heading,
    color: colors.text,
    paddingHorizontal: gutter,
    marginBottom: spacing.md,
  },
  moreToggle: {
    alignSelf: 'flex-start',
    marginLeft: gutter,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  moreToggleLabel: {
    color: colors.text,
    fontSize: 12.5,
    fontWeight: '700',
  },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: gutter,
    marginTop: spacing.md,
  },
  playLeft: {
    flex: 1,
    minWidth: 0,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingVertical: spacing.sm,
  },
  skeletonText: {
    flex: 1,
    gap: 6,
  },
  skeletonHeading: {
    marginLeft: gutter,
    marginBottom: spacing.md,
  },
  skeletonCard: {
    gap: spacing.sm,
  },
});
