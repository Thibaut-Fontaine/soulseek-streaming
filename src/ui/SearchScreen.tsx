import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { SearchHit } from '../core/types';
import { displayArtist, displayTitle, hitKey } from '../core/types';
import { useAppStore } from '../state/store';
import { Chip, CoverArt, EmptyState } from './components';
import { colors, formatBytes, formatDuration, formatQuality, formatSpeed, spacing } from './theme';

type SortMode = 'quality' | 'speed';

function qualityScore(hit: SearchHit): number {
  let score = hit.bitrate ?? 0;

  if (hit.bitDepth) {
    score += 1000 + hit.bitDepth * 10;
  }

  if (hit.sampleRate) {
    score += Math.floor(hit.sampleRate / 1000);
  }

  return score;
}

export function SearchScreen() {
  const query = useAppStore(state => state.query);
  const setQuery = useAppStore(state => state.setQuery);
  const runSearch = useAppStore(state => state.runSearch);
  const cancelSearch = useAppStore(state => state.cancelSearch);
  const searching = useAppStore(state => state.searching);
  const hits = useAppStore(state => state.hits);
  const searchError = useAppStore(state => state.searchError);
  const playHit = useAppStore(state => state.playHit);
  const connection = useAppStore(state => state.connection);

  const [sortMode, setSortMode] = React.useState<SortMode>('quality');

  const sortedHits = React.useMemo(() => {
    const copy = hits.slice();

    if (sortMode === 'quality') {
      copy.sort((a, b) => qualityScore(b) - qualityScore(a) || b.avgSpeed - a.avgSpeed);
    } else {
      copy.sort(
        (a, b) =>
          Number(b.slotFree) - Number(a.slotFree) ||
          b.avgSpeed - a.avgSpeed ||
          qualityScore(b) - qualityScore(a),
      );
    }

    return copy;
  }, [hits, sortMode]);

  const online = connection === 'online';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.title}>Recherche</Text>
            <Text style={styles.subtitle}>Musique partagée sur Soulseek</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{hits.length}</Text>
          </View>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <Text style={styles.inputGlyph}>⌕</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Artiste, album, morceau…"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => runSearch()}
              style={styles.input}
            />
          </View>
          <Pressable
            onPress={() => (searching ? cancelSearch() : runSearch())}
            disabled={!searching && (!online || !query.trim())}
            style={({ pressed }) => [
              styles.searchButton,
              !searching && (!online || !query.trim()) && styles.searchButtonDisabled,
              pressed && { opacity: 0.8 },
            ]}>
            <Text style={styles.searchButtonText}>{searching ? '×' : 'Go'}</Text>
          </Pressable>
        </View>

        {(hits.length > 0 || searching) && (
          <View style={styles.toolsRow}>
            <SwitchChip
              label="Qualité"
              active={sortMode === 'quality'}
              onPress={() => setSortMode('quality')}
            />
            <SwitchChip
              label="Disponibilité"
              active={sortMode === 'speed'}
              onPress={() => setSortMode('speed')}
            />
            {searching ? (
              <View style={styles.searchingTag}>
                <ActivityIndicator size="small" color={colors.accentBright} />
                <Text style={styles.searchingText}>Recherche…</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>

      {!online ? (
        <EmptyState
          glyph="⚡"
          title="Hors ligne"
          body="La recherche démarre dès que la connexion au réseau Soulseek est rétablie."
        />
      ) : searchError ? (
        <EmptyState glyph="!" title="Recherche impossible" body={searchError} />
      ) : sortedHits.length === 0 ? (
        searching ? (
          <EmptyState
            glyph="⌛"
            title="Recherche sur le réseau…"
            body="Les résultats arrivent au fil des réponses des autres utilisateurs."
          />
        ) : query.trim() ? (
          <EmptyState
            glyph="♪"
            title="Aucun résultat"
            body={
              'Essayez un autre terme, ou vérifiez que votre port d’écoute est accessible. ' +
              'Les pairs derrière un NAT strict peuvent mettre plus de temps à répondre.'
            }
          />
        ) : (
          <EmptyState
            glyph="⌕"
            title="Cherchez un morceau"
            body="Tapez un artiste ou un titre. Touchez ensuite un résultat pour l’écouter en streaming."
          />
        )
      ) : (
        <FlatList
          data={sortedHits}
          keyExtractor={hitKey}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          renderItem={({ item }) => (
            <ResultRow hit={item} onPress={() => playHit(item)} />
          )}
        />
      )}
    </View>
  );
}

function SwitchChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.switchChip, active && styles.switchChipActive]}>
      <Text style={[styles.switchChipText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function ResultRow({ hit, onPress }: { hit: SearchHit; onPress: () => void }) {
  const artist = displayArtist(hit);
  const title = displayTitle(hit.filename);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <CoverArt seed={`${hit.username}:${hit.filename}`} title={title} size={52} />

      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowArtist} numberOfLines={1}>
          {artist ? artist : hit.username}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {formatQuality(hit)} · {formatDuration(hit.durationSec)} · {formatBytes(hit.size)}
        </Text>
        <View style={styles.rowFooter}>
          <View
            style={[
              styles.slotDot,
              { backgroundColor: hit.slotFree ? colors.success : colors.warning },
            ]}
          />
          <Text style={styles.rowUser} numberOfLines={1}>
            {hit.username}
          </Text>
          <Text style={styles.rowSpeed}>{formatSpeed(hit.avgSpeed)}</Text>
          {hit.queueLength > 0 ? (
            <Chip label={`file ${hit.queueLength}`} tone="muted" />
          ) : null}
        </View>
      </View>

      <View style={styles.playPill}>
        <Text style={styles.playGlyph}>▶</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  countBadge: {
    minWidth: 38,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: colors.accentBright,
    fontSize: 13,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  inputGlyph: {
    color: colors.textDim,
    fontSize: 25,
    marginRight: 8,
    marginTop: -3,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  searchButton: {
    width: 54,
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonDisabled: {
    opacity: 0.4,
  },
  searchButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  switchChip: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  switchChipActive: {
    backgroundColor: colors.cardAlt,
    borderColor: 'rgba(167, 139, 250, 0.55)',
  },
  switchChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  searchingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },
  searchingText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 24,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 10,
  },
  rowPressed: {
    backgroundColor: colors.cardAlt,
  },
  rowBody: {
    flex: 1,
    marginLeft: 11,
    marginRight: 8,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  rowArtist: {
    color: colors.accentBright,
    fontSize: 12.5,
    marginTop: 1,
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: 11.5,
    marginTop: 3,
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  slotDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowUser: {
    color: colors.textDim,
    fontSize: 11,
    maxWidth: 110,
  },
  rowSpeed: {
    color: colors.textDim,
    fontSize: 11,
  },
  playPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    color: colors.accentBright,
    fontSize: 14,
    marginLeft: 2,
  },
});
