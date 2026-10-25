import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CatalogAlbum, CatalogArtist, CatalogSearchResult, CatalogTrack, TrackGroup } from '../core/catalogTypes';
import { AUTO_MATCH_SCORE } from '../core/search';
import type { SearchHit } from '../core/types';
import { useAppStore } from '../state/store';
import type { PlayContext } from '../state/store';
import { AlbumCard, ArtistCard, CatalogTrackRow, MoreToggle, Shelf, useIsCurrentCatalog } from './catalog';
import {
  bestCatalogResult,
  catalogContext,
  catalogTrackGroups,
  formatFans,
  otherFileGroups,
  sourcesLabel,
  trackArtists,
} from './catalogFormat';
import { Button, ConnectionPill, Cover, ScanBar, StatusCard } from './components';
import { ACTION_LABELS } from './errors';
import { Icon } from './Icon';
import { groupSources } from './p2p';
import { TrackCover, TrackRow, useIsCurrent, useTrackInfo } from './track';
import { colors, gutter, radius, spacing, type } from './theme';

export function SearchScreen() {
  const query = useAppStore(state => state.query);
  const setQuery = useAppStore(state => state.setQuery);
  const searching = useAppStore(state => state.searching);
  const searchQuery = useAppStore(state => state.searchQuery);
  const searchEmpty = useAppStore(state => state.searchEmpty);
  const searchError = useAppStore(state => state.searchError);
  const connection = useAppStore(state => state.connection);
  const runSearch = useAppStore(state => state.runSearch);
  const cancelSearch = useAppStore(state => state.cancelSearch);
  const reconnect = useAppStore(state => state.reconnect);
  const results = useAppStore(state => state.results);
  const deviceResults = useAppStore(state => state.deviceResults);
  const recentSearches = useAppStore(state => state.library.recentSearches);
  const forgetSearch = useAppStore(state => state.forgetSearch);
  const playTrack = useAppStore(state => state.playTrack);
  const openSheet = useAppStore(state => state.openSheet);
  const catalogResults = useAppStore(state => state.catalogResults);
  const fileSearch = useAppStore(state => state.fileSearch);

  const online = connection === 'online';
  const groups = React.useMemo(() => groupSources(results.map(ranked => ranked.hit)), [results]);
  const bestHits = React.useMemo(() => groups.map(group => group.hits[0]), [groups]);
  // Hundreds of rows are slow to build on modest phones: show a first page.
  const [allFiles, setAllFiles] = React.useState(false);
  React.useEffect(() => setAllFiles(false), [searchQuery]);
  const shownGroups = allFiles ? groups : groups.slice(0, FILES_SHOWN);
  const label = `Recherche « ${query.trim() || searchQuery} »`;
  const hasSearched = searchQuery.length > 0 || searching;
  const best = results.length > 0 && results[0].score >= AUTO_MATCH_SCORE ? groups[0] : null;

  const submit = (text = query) => {
    if (text.trim()) {
      void runSearch(text);
    }
  };

  const contextFor = (items: SearchHit[], hit: SearchHit): PlayContext => ({
    label,
    items,
    index: Math.max(0, items.indexOf(hit)),
  });

  const playFromResults = (hit: SearchHit) => void playTrack(hit, contextFor(bestHits, hit));
  const playFromDevice = (hit: SearchHit) => void playTrack(hit, contextFor(deviceResults, hit));
  const showActions = (items: SearchHit[]) => (hit: SearchHit) =>
    openSheet({ kind: 'actions', hit, context: contextFor(items, hit) });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Rechercher
        </Text>
        <ConnectionPill connection={connection} />
      </View>

      <View style={styles.field}>
        <Icon name="search" size={22} color={colors.searchFieldText} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Titre, artiste…"
          placeholderTextColor={colors.searchFieldPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => submit()}
          style={styles.input}
          accessibilityLabel="Rechercher un titre ou un artiste"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Effacer la recherche"
            onPress={() => setQuery('')}
            hitSlop={10}>
            <Icon name="x" size={20} color={colors.searchFieldPlaceholder} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <View style={styles.statusRow}>
          <Text style={styles.statusText} numberOfLines={1}>
            {fileSearch !== 'running'
              ? `Recherche de « ${searchQuery} » dans le catalogue…`
              : results.length > 0
              ? `${results.length} fichier${results.length > 1 ? 's' : ''} trouvé${results.length > 1 ? 's' : ''} · les pairs répondent encore…`
              : `Recherche de « ${searchQuery} » sur le réseau…`}
          </Text>
          <Pressable onPress={cancelSearch} hitSlop={8} accessibilityRole="button">
            <Text style={styles.statusAction}>Arrêter</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.scan}>
        <ScanBar active={searching} />
      </View>

      {!online && !searching ? (
        <StatusCard
          tone="warn"
          icon="offline"
          title="Hors ligne"
          body="La recherche sur le réseau reprendra dès que la connexion Soulseek sera rétablie. Les morceaux sur l’appareil restent disponibles."
          actions={
            connection === 'disconnected' || connection === 'error'
              ? [{ label: ACTION_LABELS.reconnect, onPress: () => void reconnect() }]
              : undefined
          }
          style={styles.card}
        />
      ) : null}

      {online && searchError ? (
        <StatusCard
          tone="bad"
          icon="info"
          title="Recherche impossible"
          body={searchError}
          actions={[{ label: ACTION_LABELS.retry, onPress: () => submit(searchQuery) }]}
          style={styles.card}
        />
      ) : null}

      {!hasSearched || query.trim().length === 0 ? (
        <RecentSearches
          items={recentSearches}
          onPick={text => {
            setQuery(text);
            submit(text);
          }}
          onForget={forgetSearch}
        />
      ) : (
        <>
          {deviceResults.length > 0 ? (
            <>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                Sur votre appareil
              </Text>
              {deviceResults.map(hit => (
                <TrackRow
                  key={`${hit.username}:${hit.filename}`}
                  hit={hit}
                  onDevice
                  onPress={playFromDevice}
                  onMore={showActions(deviceResults)}
                />
              ))}
            </>
          ) : null}

          {catalogResults ? (
            <CatalogResults label={label} />
          ) : (
            <>
              {best ? <BestResult hit={best.hits[0]} sources={best.hits.length} onPlay={playFromResults} /> : null}

              {groups.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle} accessibilityRole="header">
                    Titres
                  </Text>
                  {shownGroups.map(group => (
                    <TrackRow
                      key={group.key}
                      hit={group.hits[0]}
                      detail={`${group.hits.length} source${group.hits.length > 1 ? 's' : ''}${group.allQueued ? ' · tous en file' : ''}`}
                      showAvailability
                      onPress={playFromResults}
                      onMore={showActions(bestHits)}
                    />
                  ))}
                  {groups.length > FILES_SHOWN ? (
                    <MoreToggle expanded={allFiles} onPress={() => setAllFiles(value => !value)} />
                  ) : null}
                </>
              ) : null}
            </>
          )}

          {searchEmpty && !catalogHasResults(catalogResults) ? (
            <StatusCard
              tone="info"
              icon="search"
              title="Aucun MP3 trouvé"
              body={`Personne n’a répondu avec un MP3 proche de « ${searchQuery} ». Essayez « artiste titre », sans le nom de l’album, ou une autre orthographe.`}
              actions={[{ label: ACTION_LABELS['relaunch-search'], onPress: () => submit(searchQuery) }]}
              style={styles.card}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const CATALOG_TRACKS = 5;
/** File rows built before "Afficher plus" (modest phones). */
const FILES_SHOWN = 20;

function catalogHasResults(catalog: CatalogSearchResult | null): boolean {
  return !!catalog && (catalog.tracks.length > 0 || catalog.artists.length > 0 || catalog.albums.length > 0);
}

/**
 * Results when the online catalog answered: the best match, catalog tracks
 * with their Soulseek sources, artists, albums, then files no catalog track
 * matched (shown the old way, from their paths).
 */
function CatalogResults({ label }: { label: string }) {
  const catalog = useAppStore(state => state.catalogResults);
  const groups = useAppStore(state => state.groups);
  const searchQuery = useAppStore(state => state.searchQuery);
  const searching = useAppStore(state => state.searching);
  const fileSearch = useAppStore(state => state.fileSearch);
  const searchFilesToo = useAppStore(state => state.searchFilesToo);
  const online = useAppStore(state => state.connection === 'online');
  const playCatalogTrack = useAppStore(state => state.playCatalogTrack);
  const playTrack = useAppStore(state => state.playTrack);
  const openSheet = useAppStore(state => state.openSheet);
  const openPage = useAppStore(state => state.openPage);
  const [expanded, setExpanded] = React.useState(false);
  const [allOthers, setAllOthers] = React.useState(false);

  const trackGroups = React.useMemo(() => catalogTrackGroups(catalog, groups), [catalog, groups]);
  const tracks = React.useMemo(() => trackGroups.flatMap(group => (group.track ? [group.track] : [])), [trackGroups]);
  const others = React.useMemo(() => otherFileGroups(groups), [groups]);
  const otherHits = React.useMemo(() => others.map(group => group.sources[0].hit), [others]);
  const best = React.useMemo(() => bestCatalogResult(searchQuery, catalog, groups), [searchQuery, catalog, groups]);

  if (!catalog) {
    return null;
  }

  const play = (track: CatalogTrack) => void playCatalogTrack(track, catalogContext(label, tracks, track));
  const more = (track: CatalogTrack) =>
    openSheet({ kind: 'catalogActions', track, context: catalogContext(label, tracks, track) });
  const showSources = (group: TrackGroup) =>
    openSheet({ kind: 'sources', hits: group.sources.map(ranked => ranked.hit), title: group.title });
  const openArtist = (artist: CatalogArtist) => openPage({ kind: 'artist', id: artist.id, name: artist.name });
  const openAlbum = (album: CatalogAlbum) => openPage({ kind: 'album', id: album.id, title: album.title });
  const playOther = (hit: SearchHit) =>
    void playTrack(hit, { label, items: otherHits, index: Math.max(0, otherHits.indexOf(hit)) });
  const shown = expanded ? trackGroups : trackGroups.slice(0, CATALOG_TRACKS);

  return (
    <>
      {best?.kind === 'artist' ? (
        <BestArtist artist={best.artist} onPress={openArtist} />
      ) : best?.kind === 'track' ? (
        <BestTrack
          track={best.track}
          sources={fileSearch === 'idle' ? null : best.group?.sources.length ?? 0}
          searching={searching}
          onPlay={play}
        />
      ) : null}

      {shown.length > 0 ? (
        <>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Titres
          </Text>
          {shown.map(group =>
            group.track ? (
              <CatalogTrackRow
                key={group.id}
                track={group.track}
                // Before a file search, sources are only looked up on play.
                sources={fileSearch === 'idle' ? undefined : group.sources.length}
                onSources={() => showSources(group)}
                onPress={play}
                onMore={more}
              />
            ) : null,
          )}
          {trackGroups.length > CATALOG_TRACKS ? (
            <MoreToggle expanded={expanded} onPress={() => setExpanded(value => !value)} />
          ) : null}
        </>
      ) : null}

      {catalog.artists.length > 0 ? (
        <Shelf title="Artistes">
          {catalog.artists.map(artist => (
            <ArtistCard key={artist.id} artist={artist} onPress={openArtist} />
          ))}
        </Shelf>
      ) : null}

      {catalog.albums.length > 0 ? (
        <Shelf title="Albums">
          {catalog.albums.map(album => (
            <AlbumCard key={album.id} album={album} withArtist onPress={openAlbum} />
          ))}
        </Shelf>
      ) : null}

      {others.length > 0 ? (
        <>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Autres fichiers
          </Text>
          <Text style={styles.sectionHint}>Fichiers du réseau qui ne correspondent à aucun titre du catalogue.</Text>
          {(allOthers ? others : others.slice(0, FILES_SHOWN)).map(group => (
            <TrackRow
              key={group.id}
              hit={group.sources[0].hit}
              detail={sourcesLabel(group.sources.length)}
              showAvailability
              onPress={playOther}
              onMore={hit => openSheet({ kind: 'actions', hit })}
            />
          ))}
          {others.length > FILES_SHOWN ? (
            <MoreToggle expanded={allOthers} onPress={() => setAllOthers(value => !value)} />
          ) : null}
        </>
      ) : null}

      {fileSearch === 'idle' && online ? (
        <View style={styles.filesSearch}>
          <Button
            label="Chercher les fichiers sur Soulseek"
            icon="search"
            variant="ghost"
            onPress={() => void searchFilesToo()}
          />
          <Text style={styles.filesSearchHint}>
            Pour un titre absent du catalogue (remix, live, bootleg…). Sinon, les sources d’un titre sont cherchées quand vous l’écoutez.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function BestArtist({ artist, onPress }: { artist: CatalogArtist; onPress: (artist: CatalogArtist) => void }) {
  const fans = formatFans(artist.fans);

  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Meilleur résultat
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Artiste ${artist.name}`}
        onPress={() => onPress(artist)}
        style={({ pressed }) => [styles.best, pressed && styles.pressed]}>
        <Cover
          artwork={artist.picture}
          seed={artist.id}
          title={artist.name}
          size={92}
          rounded="round"
          style={styles.bestCover}
        />
        <Text style={styles.bestTitle} numberOfLines={2}>
          {artist.name}
        </Text>
        <View style={styles.bestTag}>
          <Text style={styles.bestTagLabel}>Artiste</Text>
          {fans ? <Text style={styles.bestMetaInline}>{fans}</Text> : null}
        </View>
      </Pressable>
    </>
  );
}

function BestTrack({
  track,
  sources,
  searching,
  onPlay,
}: {
  track: CatalogTrack;
  /** Null before any file search: sources are found when the track plays. */
  sources: number | null;
  searching: boolean;
  onPlay: (track: CatalogTrack) => void;
}) {
  const active = useIsCurrentCatalog(track);
  const sourceText =
    sources === null
      ? track.album?.title ?? ''
      : sources > 0
      ? sourcesLabel(sources)
      : searching
      ? 'recherche des sources…'
      : 'aucune source';

  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Meilleur résultat
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Écouter ${track.title}, ${track.artist.name}`}
        onPress={() => onPlay(track)}
        style={({ pressed }) => [styles.best, pressed && styles.pressed]}>
        <Cover
          artwork={track.album?.cover}
          seed={track.id}
          title={track.title}
          size={92}
          rounded="sm"
          style={styles.bestCover}
        />
        <Text style={[styles.bestTitle, active && styles.activeText]} numberOfLines={2}>
          {track.title}
        </Text>
        <Text style={styles.bestMeta} numberOfLines={1}>
          {['Titre', trackArtists(track), sourceText].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.bestPlay}>
          <Icon name="play" size={24} filled color={colors.onAccent} />
        </View>
      </Pressable>
    </>
  );
}

function BestResult({
  hit,
  sources,
  onPlay,
}: {
  hit: SearchHit;
  sources: number;
  onPlay: (hit: SearchHit) => void;
}) {
  const info = useTrackInfo(hit);
  const active = useIsCurrent(hit);

  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Meilleur résultat
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Écouter ${info.title}, ${info.artist}`}
        onPress={() => onPlay(hit)}
        style={({ pressed }) => [styles.best, pressed && styles.pressed]}>
        <TrackCover hit={hit} size={92} rounded="sm" style={styles.bestCover} />
        <Text style={[styles.bestTitle, active && styles.activeText]} numberOfLines={2}>
          {info.title}
        </Text>
        <Text style={styles.bestMeta} numberOfLines={1}>
          Titre · {info.artist} · {sources} source{sources > 1 ? 's' : ''}
          {hit.bitrate ? ` · ${hit.bitrate} kb/s` : ''}
        </Text>
        <View style={styles.bestPlay}>
          <Icon name="play" size={24} filled color={colors.onAccent} />
        </View>
      </Pressable>
    </>
  );
}

function RecentSearches({
  items,
  onPick,
  onForget,
}: {
  items: string[];
  onPick: (query: string) => void;
  onForget: (query: string) => void;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.hint}>
        <Text style={styles.hintTitle}>Que voulez-vous écouter ?</Text>
        <Text style={styles.hintBody}>
          Tapez un artiste et un titre, puis touchez le morceau voulu dans la liste. SoulStream choisit la meilleure
          source et passe à une autre si elle ne répond pas.
        </Text>
      </View>
    );
  }

  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Recherches récentes
      </Text>
      {items.map(item => (
        <View key={item} style={styles.recentRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rechercher ${item}`}
            onPress={() => onPick(item)}
            style={({ pressed }) => [styles.recentMain, pressed && styles.pressed]}>
            <View style={styles.recentIcon}>
              <Icon name="clock" size={20} color={colors.textMuted} />
            </View>
            <Text style={styles.recentLabel} numberOfLines={1}>
              {item}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${item} des recherches récentes`}
            onPress={() => onForget(item)}
            hitSlop={6}
            style={styles.recentRemove}>
            <Icon name="x" size={18} color={colors.textDim} />
          </Pressable>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.sm,
    paddingBottom: 140,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingHorizontal: gutter,
  },
  title: {
    ...type.title,
    color: colors.text,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    marginTop: spacing.md,
    marginHorizontal: gutter,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.searchField,
  },
  input: {
    flex: 1,
    color: colors.searchFieldText,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 30,
    marginTop: spacing.sm,
    paddingHorizontal: gutter,
  },
  statusText: {
    ...type.caption,
    flex: 1,
    color: colors.textMuted,
  },
  statusAction: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  scan: {
    paddingHorizontal: gutter,
    marginTop: spacing.xs,
  },
  card: {
    marginTop: spacing.lg,
    marginHorizontal: gutter,
  },
  sectionTitle: {
    ...type.heading,
    fontSize: 18,
    color: colors.text,
    paddingHorizontal: gutter,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.8,
  },
  filesSearch: {
    paddingHorizontal: gutter,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  filesSearchHint: {
    ...type.caption,
    color: colors.textDim,
  },
  sectionHint: {
    ...type.caption,
    color: colors.textDim,
    paddingHorizontal: gutter,
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
  },
  bestTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bestTagLabel: {
    ...type.badge,
    color: colors.text,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  bestMetaInline: {
    ...type.bodySm,
    color: colors.textMuted,
  },
  best: {
    marginHorizontal: gutter,
    padding: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    gap: 6,
  },
  bestCover: {
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  bestTitle: {
    ...type.title,
    color: colors.text,
    paddingRight: 64,
  },
  activeText: {
    color: colors.accent,
  },
  bestMeta: {
    ...type.bodySm,
    color: colors.textMuted,
    paddingRight: 64,
  },
  bestPlay: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  hintTitle: {
    ...type.heading,
    color: colors.text,
    textAlign: 'center',
  },
  hintBody: {
    ...type.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: gutter,
    paddingRight: spacing.xs,
  },
  recentMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  recentIcon: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  recentRemove: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
