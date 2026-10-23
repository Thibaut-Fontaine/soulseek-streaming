import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatSearchQuery } from '../core/search';
import { displayArtist, displayTitle } from '../core/types';
import type { SearchHit } from '../core/types';
import { useAppStore } from '../state/store';
import type { CurrentPlayback } from '../state/store';
import {
  Button,
  ConnectionPill,
  CoverArt,
  EmptyState,
  ScanBar,
  SectionHeader,
  StatusCard,
  TrackGradient,
} from './components';
import type { CardAction } from './components';
import { ACTION_LABELS, describePlaybackError } from './errors';
import type { ErrorAction } from './errors';
import { Icon } from './Icon';
import { PeerBadges } from './peer';
import { colors, coverSeed, gutter, percent, radius, spacing, type } from './theme';

export function SearchScreen() {
  const query = useAppStore(state => state.query);
  const setQuery = useAppStore(state => state.setQuery);
  const searching = useAppStore(state => state.searching);
  const searchQuery = useAppStore(state => state.searchQuery);
  const searchEmpty = useAppStore(state => state.searchEmpty);
  const searchError = useAppStore(state => state.searchError);
  const current = useAppStore(state => state.current);
  const matchHit = useAppStore(state => state.matchHit);
  const connection = useAppStore(state => state.connection);
  const runSearch = useAppStore(state => state.runSearch);
  const cancelSearch = useAppStore(state => state.cancelSearch);
  const reconnect = useAppStore(state => state.reconnect);

  const online = connection === 'online';
  const activeHit = current?.hit ?? matchHit;
  const canSearch = online && query.trim().length > 0;

  const submit = () => {
    if (canSearch) {
      void runSearch();
    }
  };

  const errorActions = (actions: ErrorAction[]): CardAction[] =>
    actions.flatMap(action => {
      switch (action) {
        case 'reconnect':
          return [{ label: ACTION_LABELS.reconnect, onPress: () => void reconnect() }];
        case 'retry':
        case 'relaunch-search':
          return canSearch ? [{ label: ACTION_LABELS[action], onPress: submit }] : [];
        default:
          return [];
      }
    });

  let body: React.ReactNode;

  if (!online) {
    body = (
      <StatusCard
        tone="warn"
        icon="offline"
        title="Hors ligne"
        body="La recherche reprendra dès que la connexion Soulseek sera rétablie."
        actions={
          connection === 'disconnected' || connection === 'error'
            ? [{ label: ACTION_LABELS.reconnect, onPress: () => void reconnect() }]
            : undefined
        }
      />
    );
  } else if (searching) {
    body = null;
  } else if (searchError) {
    const described = describePlaybackError(searchError);
    body = (
      <StatusCard
        tone={described.tone}
        icon={described.icon}
        title={matchHit ? described.title : 'Recherche impossible'}
        body={matchHit ? described.body : searchError}
        actions={errorActions(matchHit ? described.actions : ['retry'])}
      />
    );
  } else if (searchEmpty) {
    body = (
      <StatusCard
        tone="info"
        icon="search"
        title="Aucun MP3 convaincant"
        body={`Rien de convaincant pour « ${query} ». Essayez « artiste titre », sans le nom de l’album, ou une autre orthographe.`}
        actions={errorActions(['relaunch-search'])}
      />
    );
  } else if (activeHit) {
    body = <BestSource hit={activeHit} current={current} />;
  } else {
    body = (
      <EmptyState
        icon="music"
        title="Tapez un titre pour lancer la lecture"
        body="SoulStream choisit le MP3 qui correspond le mieux, le précharge en arrière-plan et démarre sans écran intermédiaire."
      />
    );
  }

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
          placeholder="Artiste, titre…"
          placeholderTextColor={colors.searchFieldPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={submit}
          style={styles.input}
          accessibilityLabel="Rechercher un morceau"
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

      <View style={styles.statusRow}>
        <Text style={styles.statusText} numberOfLines={1}>
          {searching
            ? `Recherche de « ${searchQuery || formatSearchQuery(query) || query} »…`
            : 'MP3 uniquement · démarrage quasi instantané'}
        </Text>
        {searching ? (
          <Pressable onPress={cancelSearch} hitSlop={8} accessibilityRole="button">
            <Text style={styles.statusAction}>Arrêter</Text>
          </Pressable>
        ) : canSearch ? (
          <Button label="Écouter" icon="play" size="sm" onPress={submit} />
        ) : null}
      </View>
      <ScanBar active={searching} />

      <View style={styles.body}>{body}</View>

      {/* TODO(wire): store.results — render <SourcesList hits={results}
          currentKey={current && hitKey(current.hit)} onPick={playHit} /> under a
          "Morceaux" SectionHeader once the store retains search batches. */}
    </ScrollView>
  );
}

function BestSource({ hit, current }: { hit: SearchHit; current: CurrentPlayback | null }) {
  const setTab = useAppStore(state => state.setTab);
  const retryPlayback = useAppStore(state => state.retryPlayback);
  const received = useAppStore(state =>
    state.current ? state.transfers[state.current.transferId]?.received ?? 0 : 0,
  );

  const title = displayTitle(hit.filename);
  const artist = displayArtist(hit) ?? hit.username;
  const seed = coverSeed(hit);
  const phase = current?.phase ?? 'preparing';
  const failure = phase === 'error' ? describePlaybackError(current?.error) : null;

  const status =
    phase === 'playing'
      ? `Lecture lancée · @${hit.username}`
      : phase === 'error'
        ? failure?.title ?? 'Lecture interrompue'
        : `Préparation · ${Math.round(percent(received, current?.bufferTarget ?? 1) * 100)} %`;

  return (
    <>
      <SectionHeader title="Meilleure source" style={styles.sectionFirst} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir le lecteur : ${title}`}
        onPress={() => setTab('player')}
        style={({ pressed }) => [styles.best, pressed && styles.pressed]}>
        <TrackGradient seed={seed} strength={0.55} />
        <View style={styles.bestRow}>
          <CoverArt seed={seed} title={title} size={88} />
          <View style={styles.bestText}>
            <Text style={styles.bestTitle} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.bestArtist} numberOfLines={1}>
              {artist}
            </Text>
            <PeerBadges hit={hit} long style={styles.bestBadges} />
          </View>
        </View>
        <View style={styles.bestFooter}>
          <Text
            style={[styles.bestStatus, phase === 'error' && styles.bestStatusError]}
            numberOfLines={1}>
            {status}
          </Text>
          {phase === 'error' ? (
            <Button label="Réessayer" icon="refresh" size="sm" variant="ghost" onPress={retryPlayback} />
          ) : null}
          {/* TODO(wire): "Autre source" (icon swap) → playHit(next candidate of
              the same group) once the store keeps results. */}
        </View>
      </Pressable>
      {failure ? <Text style={styles.bestHint}>{failure.body}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
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
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.searchField,
  },
  input: {
    flex: 1,
    color: colors.searchFieldText,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 34,
    marginTop: 10,
    marginBottom: spacing.sm,
  },
  statusText: {
    ...type.caption,
    flex: 1,
    color: colors.textDim,
  },
  statusAction: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    marginTop: spacing.lg,
  },
  sectionFirst: {
    marginTop: 0,
  },
  pressed: {
    opacity: 0.9,
  },
  best: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  bestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  bestText: {
    flex: 1,
    minWidth: 0,
  },
  bestTitle: {
    ...type.heading,
    fontSize: 19,
    color: colors.text,
  },
  bestArtist: {
    ...type.bodySm,
    color: colors.textMuted,
    marginTop: 2,
  },
  bestBadges: {
    marginTop: spacing.sm,
  },
  bestFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 14,
    minHeight: 34,
  },
  bestStatus: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12.5,
    fontWeight: '600',
  },
  bestStatusError: {
    color: colors.danger,
  },
  bestHint: {
    ...type.caption,
    color: colors.textDim,
    marginTop: spacing.sm,
  },
});
