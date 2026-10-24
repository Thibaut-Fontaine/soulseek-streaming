/**
 * Artist, album and genre pages, pushed above the current tab like a
 * navigation stack (`state.pages`). Only the top page is visible; the ones
 * below stay mounted so their scroll position survives "back".
 */
import React from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import type {
  AlbumPageData,
  ArtistPageData,
  CatalogAlbum,
  CatalogArtist,
  CatalogTrack,
  GenrePageData,
  Loadable,
  Page,
} from '../core/catalogTypes';
import { useAppStore } from '../state/store';
import {
  AlbumCard,
  ArtistCard,
  CatalogTrackRow,
  MoreToggle,
  PlayButtons,
  SectionTitle,
  Shelf,
  ShelfSkeleton,
  TrackListSkeleton,
} from './catalog';
import {
  albumMetaLine,
  catalogContext,
  discSections,
  formatFans,
  formatReleaseDate,
  pickArtwork,
  shuffleStart,
  splitDiscography,
  trackArtists,
} from './catalogFormat';
import { Button, Cover, IconButton, Skeleton, StatusCard, TrackGradient } from './components';
import { colors, gutter, spacing, type } from './theme';

const TOP_TRACKS = 5;
const TOP_TRACKS_EXPANDED = 10;
const HEADER_HEIGHT = 52;

export function PageHost() {
  const pages = useAppStore(state => state.pages);

  if (pages.length === 0) {
    return null;
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.host]}>
      {pages.map((page, index) => (
        <View
          key={`${index}:${page.kind}:${page.id}`}
          style={[StyleSheet.absoluteFill, index !== pages.length - 1 && styles.hidden]}
          importantForAccessibility={index === pages.length - 1 ? 'auto' : 'no-hide-descendants'}
        >
          <PageView page={page} />
        </View>
      ))}
    </View>
  );
}

function PageView({ page }: { page: Page }) {
  switch (page.kind) {
    case 'artist':
      return <ArtistPage id={page.id} name={page.name} />;
    case 'album':
      return <AlbumPage id={page.id} title={page.title} />;
    default:
      return <GenrePage id={page.id} name={page.name} />;
  }
}

/** Loads a page's data once, when nothing is cached for that id. */
function usePageData<T>(
  select: (id: string) => Loadable<T> | undefined,
  load: (id: string, force?: boolean) => Promise<void>,
  id: string,
): { entry: Loadable<T> | undefined; retry: () => void } {
  const entry = select(id);
  const missing = entry === undefined;

  React.useEffect(() => {
    if (missing) {
      void load(id);
    }
  }, [id, load, missing]);

  return { entry, retry: () => void load(id, true) };
}

// ---------------------------------------------------------------------------
// Scaffold: scroll view, hero and a header that fades in on scroll.

function PageScaffold({
  title,
  heroHeight,
  children,
}: {
  title: string;
  /** Scroll distance after which the header shows the title. */
  heroHeight: number;
  children: React.ReactNode;
}) {
  const closePage = useAppStore(state => state.closePage);
  const scrollY = React.useRef(new Animated.Value(0)).current;
  const fade = scrollY.interpolate({
    inputRange: [Math.max(0, heroHeight - 120), Math.max(1, heroHeight - 40)],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.page}>
      <Animated.ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        {children}
      </Animated.ScrollView>
      <View style={styles.header} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, styles.headerBg, { opacity: fade }]} pointerEvents="none" />
        <IconButton
          icon="left"
          size={36}
          iconSize={22}
          variant="soft"
          accessibilityLabel="Retour"
          onPress={closePage}
        />
        <Animated.Text style={[styles.headerTitle, { opacity: fade }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Animated.Text>
      </View>
    </View>
  );
}

function PageError({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return (
    <StatusCard
      tone="bad"
      icon="offline"
      title={title}
      body={error}
      actions={[{ label: 'Réessayer', icon: 'refresh', onPress: onRetry }]}
      style={styles.errorCard}
    />
  );
}

/** Play a list from its start, or from a random track with shuffle on. */
function usePlayList() {
  const playCatalogTrack = useAppStore(state => state.playCatalogTrack);
  const toggleShuffle = useAppStore(state => state.toggleShuffle);

  return {
    play: (label: string, tracks: CatalogTrack[], track?: CatalogTrack) => {
      const first = track ?? tracks[0];
      if (first) {
        void playCatalogTrack(first, catalogContext(label, tracks, first));
      }
    },
    shuffle: (label: string, tracks: CatalogTrack[]) => {
      if (tracks.length === 0) {
        return;
      }
      if (!useAppStore.getState().shuffle) {
        toggleShuffle();
      }
      const index = shuffleStart(tracks);
      void playCatalogTrack(tracks[index], { label, tracks, index });
    },
  };
}

function useOpeners() {
  const openPage = useAppStore(state => state.openPage);
  const openSheet = useAppStore(state => state.openSheet);

  return {
    openArtist: (artist: Pick<CatalogArtist, 'id' | 'name'>) =>
      openPage({ kind: 'artist', id: artist.id, name: artist.name }),
    openAlbum: (album: Pick<CatalogAlbum, 'id' | 'title'>) =>
      openPage({ kind: 'album', id: album.id, title: album.title }),
    more: (label: string, tracks: CatalogTrack[]) => (track: CatalogTrack) =>
      openSheet({
        kind: 'catalogActions',
        track,
        context: catalogContext(label, tracks, track),
      }),
  };
}

// ---------------------------------------------------------------------------
// Artist

export function ArtistPage({ id, name }: { id: string; name?: string }) {
  const loadArtistPage = useAppStore(state => state.loadArtistPage);
  const artistPages = useAppStore(state => state.artistPages);
  const { entry, retry } = usePageData(key => artistPages[key], loadArtistPage, id);
  const { width } = useWindowDimensions();
  const heroHeight = Math.min(width * 0.8, 340);
  const title = entry?.status === 'ready' ? entry.data.artist.name : name ?? 'Artiste';

  return (
    <PageScaffold title={title} heroHeight={heroHeight}>
      {entry?.status === 'ready' ? (
        <ArtistContent data={entry.data} heroHeight={heroHeight} />
      ) : (
        <>
          <View style={[styles.artistHero, { height: heroHeight }]}>
            <TrackGradient seed={id} />
            <Text style={styles.artistName} numberOfLines={2}>
              {name ?? ''}
            </Text>
          </View>
          {entry?.status === 'error' ? (
            <PageError title="Impossible de charger l’artiste" error={entry.error} onRetry={retry} />
          ) : (
            <>
              <SectionTitle title="Titres populaires" style={styles.sectionGap} />
              <TrackListSkeleton />
              <ShelfSkeleton />
            </>
          )}
        </>
      )}
    </PageScaffold>
  );
}

function ArtistContent({ data, heroHeight }: { data: ArtistPageData; heroHeight: number }) {
  const { artist, topTracks, albums, related } = data;
  const [expanded, setExpanded] = React.useState(false);
  const playArtistRadio = useAppStore(state => state.playArtistRadio);
  const { play, shuffle } = usePlayList();
  const { openArtist, openAlbum, more } = useOpeners();
  const discography = React.useMemo(() => splitDiscography(albums), [albums]);
  const picture = pickArtwork(artist.picture, 1000);
  const fans = formatFans(artist.fans);
  const shown = topTracks.slice(0, expanded ? TOP_TRACKS_EXPANDED : TOP_TRACKS);
  const label = artist.name;

  return (
    <>
      <View style={[styles.artistHero, { height: heroHeight }]}>
        {picture ? (
          <Image
            source={{ uri: picture }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <TrackGradient seed={artist.id} />
        )}
        <LinearGradient
          colors={HERO_SHADE}
          locations={[0.35, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Text style={styles.artistName} numberOfLines={2} accessibilityRole="header">
          {artist.name}
        </Text>
      </View>
      {fans ? <Text style={styles.fans}>{fans}</Text> : null}

      <PlayButtons
        label={label}
        disabled={topTracks.length === 0}
        onPlay={() => play(label, topTracks)}
        onShuffle={() => shuffle(label, topTracks)}
        left={
          <Button
            label="Radio"
            icon="wave"
            variant="ghost"
            size="sm"
            accessibilityLabel={`Radio ${artist.name}`}
            onPress={() => void playArtistRadio(artist.id, artist.name)}
          />
        }
      />

      {topTracks.length > 0 ? (
        <>
          <SectionTitle title="Titres populaires" style={styles.sectionGap} />
          {shown.map((track, index) => (
            <CatalogTrackRow
              key={track.id}
              track={track}
              number={index + 1}
              subtitle={track.album?.title ?? trackArtists(track)}
              onPress={picked => play(label, topTracks, picked)}
              onMore={more(label, topTracks)}
            />
          ))}
          {topTracks.length > TOP_TRACKS ? (
            <MoreToggle expanded={expanded} onPress={() => setExpanded(value => !value)} />
          ) : null}
        </>
      ) : (
        <Text style={styles.emptyText}>Aucun titre populaire connu pour cet artiste.</Text>
      )}

      {discography.albums.length > 0 || discography.singles.length > 0 ? (
        <SectionTitle title="Discographie" style={styles.sectionGap} />
      ) : null}
      {discography.albums.length > 0 ? (
        <Shelf title="Albums" style={styles.subShelf}>
          {discography.albums.map(album => (
            <AlbumCard key={album.id} album={album} onPress={openAlbum} />
          ))}
        </Shelf>
      ) : null}
      {discography.singles.length > 0 ? (
        <Shelf title="Singles et EP" style={styles.subShelf}>
          {discography.singles.map(album => (
            <AlbumCard key={album.id} album={album} onPress={openAlbum} />
          ))}
        </Shelf>
      ) : null}

      {related.length > 0 ? (
        <Shelf title="Les fans aiment aussi">
          {related.map(other => (
            <ArtistCard key={other.id} artist={other} onPress={openArtist} />
          ))}
        </Shelf>
      ) : null}
    </>
  );
}

const HERO_SHADE = ['rgba(11,10,15,0)', colors.bg];

// ---------------------------------------------------------------------------
// Album

const ALBUM_COVER = 220;

export function AlbumPage({ id, title }: { id: string; title?: string }) {
  const loadAlbumPage = useAppStore(state => state.loadAlbumPage);
  const albumPages = useAppStore(state => state.albumPages);
  const { entry, retry } = usePageData(key => albumPages[key], loadAlbumPage, id);
  const heading = entry?.status === 'ready' ? entry.data.album.title : title ?? 'Album';

  return (
    <PageScaffold title={heading} heroHeight={ALBUM_COVER + 140}>
      {entry?.status === 'ready' ? (
        <AlbumContent data={entry.data} />
      ) : (
        <>
          <View style={styles.albumHero}>
            <TrackGradient seed={id} />
            <Skeleton width={ALBUM_COVER} height={ALBUM_COVER} />
            <Text style={styles.albumTitle} numberOfLines={2}>
              {title ?? ''}
            </Text>
          </View>
          {entry?.status === 'error' ? (
            <PageError title="Impossible de charger l’album" error={entry.error} onRetry={retry} />
          ) : (
            <TrackListSkeleton count={8} covers={false} />
          )}
        </>
      )}
    </PageScaffold>
  );
}

function AlbumContent({ data }: { data: AlbumPageData }) {
  const { album, tracks, moreByArtist } = data;
  const { play, shuffle } = usePlayList();
  const { openArtist, openAlbum, more } = useOpeners();
  const sections = React.useMemo(() => discSections(tracks), [tracks]);
  const ordered = React.useMemo(() => sections.flatMap(section => section.tracks), [sections]);
  const label = album.title;
  const released = formatReleaseDate(album.releaseDate);

  return (
    <>
      <View style={styles.albumHero}>
        <TrackGradient seed={album.id} />
        <Cover
          artwork={album.cover}
          seed={album.id}
          title={album.title}
          size={ALBUM_COVER}
          rounded="xs"
          style={styles.albumCover}
        />
        <Text style={styles.albumTitle} numberOfLines={3} accessibilityRole="header">
          {album.title}
        </Text>
      </View>
      <View style={styles.albumInfo}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Aller à l’artiste ${album.artist.name}`}
          onPress={() => openArtist(album.artist)}
          hitSlop={6}
        >
          <Text style={styles.albumArtist}>{album.artist.name}</Text>
        </Pressable>
        <Text style={styles.albumMeta}>{albumMetaLine(album, tracks)}</Text>
      </View>

      <PlayButtons
        label={label}
        disabled={ordered.length === 0}
        onPlay={() => play(label, ordered)}
        onShuffle={() => shuffle(label, ordered)}
      />

      <View style={styles.tracklist}>
        {sections.map(section => (
          <React.Fragment key={section.disc}>
            {sections.length > 1 ? <Text style={styles.disc}>{`Disque ${section.disc}`}</Text> : null}
            {section.tracks.map((track, index) => (
              <CatalogTrackRow
                key={track.id}
                track={track}
                hideCover
                number={track.trackNumber ?? index + 1}
                subtitle={albumTrackSubtitle(track)}
                onPress={picked => play(label, ordered, picked)}
                onMore={more(label, ordered)}
              />
            ))}
          </React.Fragment>
        ))}
        {ordered.length === 0 ? <Text style={styles.emptyText}>La liste des titres n’est pas disponible.</Text> : null}
      </View>

      {released || album.label ? (
        <View style={styles.release}>
          {released ? <Text style={styles.releaseDate}>{released}</Text> : null}
          {album.label ? <Text style={styles.releaseLabel}>{`© ${album.label}`}</Text> : null}
        </View>
      ) : null}

      {moreByArtist.length > 0 ? (
        <Shelf title={`Plus de ${album.artist.name}`}>
          {moreByArtist.map(other => (
            <AlbumCard key={other.id} album={other} onPress={openAlbum} />
          ))}
        </Shelf>
      ) : null}
    </>
  );
}

/** Version first ("Radio Edit"), then the artists. */
function albumTrackSubtitle(track: CatalogTrack): string {
  const version = track.version.replace(/^[([]\s*|\s*[)\]]$/g, '').trim();
  return [version, trackArtists(track)].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Genre

export function GenrePage({ id, name }: { id: string; name?: string }) {
  const loadGenrePage = useAppStore(state => state.loadGenrePage);
  const genrePages = useAppStore(state => state.genrePages);
  const { entry, retry } = usePageData(key => genrePages[key], loadGenrePage, id);
  const heading = entry?.status === 'ready' ? entry.data.genre.name : name ?? 'Genre';

  return (
    <PageScaffold title={heading} heroHeight={180}>
      <View style={styles.genreHero}>
        <TrackGradient seed={id} />
        {entry?.status === 'ready' ? (
          <Cover
            artwork={entry.data.genre.picture}
            seed={id}
            title={heading}
            size={96}
            rounded="sm"
            style={styles.albumCover}
          />
        ) : null}
        <Text style={styles.genreName} numberOfLines={2} accessibilityRole="header">
          {heading}
        </Text>
      </View>
      {entry?.status === 'ready' ? (
        <GenreContent data={entry.data} />
      ) : entry?.status === 'error' ? (
        <PageError title="Impossible de charger ce genre" error={entry.error} onRetry={retry} />
      ) : (
        <>
          <ShelfSkeleton round />
          <TrackListSkeleton count={6} />
        </>
      )}
    </PageScaffold>
  );
}

function GenreContent({ data }: { data: GenrePageData }) {
  const { genre, artists, chartTracks } = data;
  const [expanded, setExpanded] = React.useState(false);
  const { play, shuffle } = usePlayList();
  const { openArtist, more } = useOpeners();
  const label = genre.name;
  const shown = expanded ? chartTracks : chartTracks.slice(0, TOP_TRACKS_EXPANDED);

  return (
    <>
      <PlayButtons
        label={label}
        disabled={chartTracks.length === 0}
        onPlay={() => play(label, chartTracks)}
        onShuffle={() => shuffle(label, chartTracks)}
      />
      {artists.length > 0 ? (
        <Shelf title="Artistes">
          {artists.map(artist => (
            <ArtistCard key={artist.id} artist={artist} onPress={openArtist} />
          ))}
        </Shelf>
      ) : null}
      {chartTracks.length > 0 ? (
        <>
          <SectionTitle title="Titres du moment" style={styles.sectionGap} />
          {shown.map((track, index) => (
            <CatalogTrackRow
              key={track.id}
              track={track}
              number={index + 1}
              onPress={picked => play(label, chartTracks, picked)}
              onMore={more(label, chartTracks)}
            />
          ))}
          {chartTracks.length > TOP_TRACKS_EXPANDED ? (
            <MoreToggle expanded={expanded} onPress={() => setExpanded(value => !value)} />
          ) : null}
        </>
      ) : null}
      {artists.length === 0 && chartTracks.length === 0 ? (
        <Text style={styles.emptyText}>Rien à afficher pour ce genre pour l’instant.</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  host: {
    backgroundColor: colors.bg,
  },
  hidden: {
    display: 'none',
  },
  page: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pageContent: {
    paddingBottom: 140,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  headerBg: {
    backgroundColor: colors.surface,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginRight: 44,
    textAlign: 'center',
  },
  errorCard: {
    marginTop: spacing.xl,
    marginHorizontal: gutter,
  },
  sectionGap: {
    marginTop: spacing.xl,
  },
  subShelf: {
    marginTop: 0,
    marginBottom: spacing.lg,
  },
  emptyText: {
    ...type.bodySm,
    color: colors.textMuted,
    paddingHorizontal: gutter,
    marginTop: spacing.lg,
  },
  artistHero: {
    justifyContent: 'flex-end',
    paddingHorizontal: gutter,
    paddingBottom: spacing.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  artistName: {
    ...type.display,
    fontSize: 44,
    lineHeight: 48,
    color: colors.text,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 16,
  },
  fans: {
    ...type.bodySm,
    color: colors.textMuted,
    paddingHorizontal: gutter,
    marginTop: spacing.xs,
  },
  albumHero: {
    alignItems: 'center',
    paddingTop: HEADER_HEIGHT + spacing.sm,
    paddingHorizontal: gutter,
    gap: spacing.lg,
    overflow: 'hidden',
  },
  albumCover: {
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  albumTitle: {
    ...type.title,
    color: colors.text,
    alignSelf: 'stretch',
  },
  albumInfo: {
    paddingHorizontal: gutter,
    marginTop: spacing.sm,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  albumArtist: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  albumMeta: {
    ...type.bodySm,
    color: colors.textMuted,
  },
  tracklist: {
    marginTop: spacing.md,
  },
  disc: {
    ...type.eyebrow,
    color: colors.textMuted,
    paddingHorizontal: gutter,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  release: {
    paddingHorizontal: gutter,
    marginTop: spacing.xl,
    gap: 2,
  },
  releaseDate: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  releaseLabel: {
    ...type.caption,
    color: colors.textMuted,
  },
  genreHero: {
    minHeight: 180,
    justifyContent: 'flex-end',
    gap: spacing.md,
    paddingTop: HEADER_HEIGHT + spacing.sm,
    paddingHorizontal: gutter,
    paddingBottom: spacing.md,
    overflow: 'hidden',
  },
  genreName: {
    ...type.display,
    color: colors.text,
  },
});
