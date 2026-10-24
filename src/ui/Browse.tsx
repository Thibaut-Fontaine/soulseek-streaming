/**
 * Catalog content for the Accueil tab, below the user's own shelves: top
 * tracks, albums of the moment, popular artists and the genre grid.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BrowseData, CatalogAlbum, CatalogArtist, CatalogGenre, CatalogTrack } from '../core/catalogTypes';
import { useAppStore } from '../state/store';
import { AlbumCard, ArtistCard, GenreTile, SectionTitle, Shelf, ShelfSkeleton, TrackCard } from './catalog';
import { catalogContext } from './catalogFormat';
import { Skeleton, StatusCard } from './components';
import { colors, gutter, spacing, type } from './theme';

const TOP_LABEL = 'Top titres';

export function BrowseSections() {
  const browse = useAppStore(state => state.browse);
  const loadBrowse = useAppStore(state => state.loadBrowse);
  const enabled = useAppStore(state => state.settings.catalogEnabled !== false);

  React.useEffect(() => {
    if (enabled && useAppStore.getState().browse === null) {
      void loadBrowse();
    }
  }, [enabled, loadBrowse]);

  if (!enabled || !browse) {
    return null;
  }

  if (browse.status === 'loading') {
    return (
      <View accessibilityLabel="Chargement des nouveautés">
        <ShelfSkeleton />
        <ShelfSkeleton />
        <ShelfSkeleton round />
        <GenreGridSkeleton />
      </View>
    );
  }

  if (browse.status === 'error') {
    return (
      <StatusCard
        tone="warn"
        icon="offline"
        title="Nouveautés indisponibles"
        body={`Le catalogue en ligne ne répond pas (${browse.error}). Vos titres et la recherche Soulseek restent disponibles.`}
        actions={[
          {
            label: 'Réessayer',
            icon: 'refresh',
            onPress: () => void loadBrowse(true),
          },
        ]}
        style={styles.error}
      />
    );
  }

  return <BrowseContent data={browse.data} />;
}

function BrowseContent({ data }: { data: BrowseData }) {
  const playCatalogTrack = useAppStore(state => state.playCatalogTrack);
  const openPage = useAppStore(state => state.openPage);
  const openSheet = useAppStore(state => state.openSheet);
  const { chartTracks, chartAlbums, chartArtists, genres } = data;

  const play = (track: CatalogTrack) => void playCatalogTrack(track, catalogContext(TOP_LABEL, chartTracks, track));
  const more = (track: CatalogTrack) =>
    openSheet({
      kind: 'catalogActions',
      track,
      context: catalogContext(TOP_LABEL, chartTracks, track),
    });
  const openAlbum = (album: CatalogAlbum) => openPage({ kind: 'album', id: album.id, title: album.title });
  const openArtist = (artist: CatalogArtist) => openPage({ kind: 'artist', id: artist.id, name: artist.name });
  const openGenre = (genre: CatalogGenre) => openPage({ kind: 'genre', id: genre.id, name: genre.name });

  return (
    <>
      {chartTracks.length > 0 ? (
        <Shelf title={TOP_LABEL} style={styles.shelf}>
          {chartTracks.map(track => (
            <TrackCard key={track.id} track={track} onPress={play} onMore={more} />
          ))}
        </Shelf>
      ) : null}
      {chartAlbums.length > 0 ? (
        <Shelf title="Albums du moment" style={styles.shelf}>
          {chartAlbums.map(album => (
            <AlbumCard key={album.id} album={album} withArtist onPress={openAlbum} />
          ))}
        </Shelf>
      ) : null}
      {chartArtists.length > 0 ? (
        <Shelf title="Artistes populaires" style={styles.shelf}>
          {chartArtists.map(artist => (
            <ArtistCard key={artist.id} artist={artist} onPress={openArtist} />
          ))}
        </Shelf>
      ) : null}
      {genres.length > 0 ? (
        <>
          <SectionTitle title="Genres" style={styles.shelf} />
          <View style={styles.grid}>
            {genres.map(genre => (
              <GenreTile key={genre.id} genre={genre} onPress={openGenre} />
            ))}
          </View>
        </>
      ) : null}
      <Text style={styles.credit}>Pochettes et classements : Deezer</Text>
    </>
  );
}

function GenreGridSkeleton() {
  return (
    <View style={[styles.grid, styles.shelf]}>
      {[0, 1, 2, 3].map(index => (
        <View key={index} style={styles.skeletonTile}>
          <Skeleton width="100%" height={96} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shelf: {
    marginTop: 28,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: gutter,
  },
  skeletonTile: {
    flexBasis: '45%',
    flexGrow: 1,
  },
  error: {
    marginTop: 28,
    marginHorizontal: gutter,
  },
  credit: {
    ...type.caption,
    color: colors.textDim,
    paddingHorizontal: gutter,
    marginTop: spacing.xl,
  },
});
