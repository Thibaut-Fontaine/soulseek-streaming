/**
 * Catalog content for the Accueil tab, built only from what the user played:
 * their recent artists, the albums of recent tracks, and artists similar to
 * the ones they listen to. No charts or trends.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import type { CatalogAlbum, CatalogArtist } from '../core/catalogTypes';
import type { SavedTrack } from '../services/library';
import { recentArtists, useAppStore } from '../state/store';
import { AlbumCard, ArtistCard, Shelf, ShelfSkeleton } from './catalog';
import { StatusCard } from './components';
import { colors, gutter, spacing, type } from './theme';

const MAX_ALBUMS = 12;

/** Albums of the recently played catalog tracks, most recent first. */
export function recentAlbums(history: SavedTrack[], max = MAX_ALBUMS): CatalogAlbum[] {
  const albums: CatalogAlbum[] = [];
  const seen = new Set<string>();

  for (const saved of history) {
    const track = saved.catalog;
    if (!track?.album?.id || seen.has(track.album.id)) {
      continue;
    }
    seen.add(track.album.id);
    albums.push({ ...track.album, artist: track.artist, kind: 'album', releaseDate: null });
    if (albums.length >= max) {
      break;
    }
  }

  return albums;
}

export function ForYouSections() {
  const enabled = useAppStore(state => state.settings.catalogEnabled !== false);
  const history = useAppStore(state => state.library.history);
  const home = useAppStore(state => state.home);
  const loadHome = useAppStore(state => state.loadHome);
  const openPage = useAppStore(state => state.openPage);

  // Rebuild only when the set of recent artists changes.
  const artistKey = React.useMemo(
    () => recentArtists({ history, liked: [], recentSearches: [] }).map(artist => artist.id).join(','),
    [history],
  );
  const albums = React.useMemo(() => recentAlbums(history), [history]);

  React.useEffect(() => {
    if (enabled) {
      void loadHome();
    }
  }, [enabled, artistKey, loadHome]);

  if (!enabled) {
    return null;
  }

  const openArtist = (artist: CatalogArtist) => openPage({ kind: 'artist', id: artist.id, name: artist.name });
  const openAlbum = (album: CatalogAlbum) => openPage({ kind: 'album', id: album.id, title: album.title });

  return (
    <>
      {home?.status === 'loading' ? <ShelfSkeleton round /> : null}

      {home?.status === 'ready' && home.data.artists.length > 0 ? (
        <Shelf title="Vos artistes" style={styles.shelf}>
          {home.data.artists.map(artist => (
            <ArtistCard key={artist.id} artist={artist} onPress={openArtist} />
          ))}
        </Shelf>
      ) : null}

      {albums.length > 0 ? (
        <Shelf title="Albums de vos écoutes" style={styles.shelf}>
          {albums.map(album => (
            <AlbumCard key={album.id} album={album} subtitle={album.artist.name} onPress={openAlbum} />
          ))}
        </Shelf>
      ) : null}

      {home?.status === 'ready'
        ? home.data.similar.map(entry => (
            <Shelf key={entry.artist.id} title={`Parce que vous écoutez ${entry.artist.name}`} style={styles.shelf}>
              {entry.related.map(artist => (
                <ArtistCard key={artist.id} artist={artist} onPress={openArtist} />
              ))}
            </Shelf>
          ))
        : null}

      {home?.status === 'error' ? (
        <StatusCard
          tone="warn"
          icon="offline"
          title="Suggestions indisponibles"
          body={`Le catalogue en ligne ne répond pas (${home.error}). Vos titres et la recherche restent disponibles.`}
          actions={[{ label: 'Réessayer', icon: 'refresh', onPress: () => void loadHome(true) }]}
          style={styles.error}
        />
      ) : null}

      {home || albums.length > 0 ? <Text style={styles.credit}>Pochettes et artistes : Deezer</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  shelf: {
    marginTop: 28,
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
