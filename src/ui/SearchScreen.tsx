import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { formatSearchQuery } from '../core/search';
import { displayArtist, displayTitle } from '../core/types';
import { useAppStore } from '../state/store';
import { CoverArt } from './components';
import { colors, spacing } from './theme';

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
  const retryPlayback = useAppStore(state => state.retryPlayback);
  const setTab = useAppStore(state => state.setTab);

  const online = connection === 'online';
  const activeHit = current?.hit ?? matchHit;
  const formattedQuery = formatSearchQuery(query);
  const canSearch = online && query.trim().length > 0;

  const submit = () => {
    if (searching) {
      cancelSearch();
      return;
    }

    if (canSearch) {
      void runSearch();
    }
  };

  const submitFromKeyboard = () => {
    if (canSearch) {
      void runSearch();
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Écoute</Text>
        <Text style={styles.subtitle}>
          Un titre, un MP3 : on trouve la meilleure source et ça joue.
        </Text>
      </View>

      <View style={styles.searchCard}>
        <View style={styles.inputRow}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Artiste, titre, album…"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={submitFromKeyboard}
            style={styles.input}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityLabel="Effacer la recherche"
              onPress={() => setQuery('')}
              hitSlop={10}
              style={styles.clearButton}>
              <Text style={styles.clearText}>×</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={submit}
          disabled={!searching && !canSearch}
          style={({ pressed }) => [
            styles.action,
            !searching && !canSearch && styles.actionDisabled,
            pressed && { opacity: 0.85 },
          ]}>
          {searching ? (
            <View style={styles.actionContent}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={styles.actionText}>Arrêter</Text>
            </View>
          ) : (
            <View style={styles.actionContent}>
              <Text style={styles.actionGlyph}>▶</Text>
              <Text style={styles.actionText}>Écouter</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.policyRow}>
          <Text style={styles.policy}>MP3 uniquement</Text>
          <View style={styles.policyDot} />
          <Text style={styles.policy}>démarrage quasi instantané</Text>
        </View>
      </View>

      {!online ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Hors ligne</Text>
          <Text style={styles.infoBody}>
            La recherche reprendra dès que la connexion Soulseek sera rétablie.
          </Text>
        </View>
      ) : searching ? (
        <View style={styles.searchingCard}>
          <View style={styles.searchingHeader}>
            <ActivityIndicator size="small" color={colors.accentBright} />
            <Text style={styles.searchingTitle}>Recherche du meilleur MP3…</Text>
          </View>
          <Text style={styles.queryPreview} numberOfLines={1}>
            {searchQuery || formattedQuery || query}
          </Text>
          <Text style={styles.searchingHint}>
            On s’arrête dès qu’un match suffisant est trouvé.
          </Text>
        </View>
      ) : searchError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>
            {matchHit ? 'Lecture impossible' : 'Recherche impossible'}
          </Text>
          <Text style={styles.errorBody}>{searchError}</Text>
          {canSearch ? (
            <Pressable onPress={() => void runSearch()} style={styles.retryButton}>
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          ) : null}
        </View>
      ) : searchEmpty ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Aucun MP3 trouvé</Text>
          <Text style={styles.infoBody}>
            Rien de convaincant pour « {query} ». Essaie avec l’artiste et le titre,
            ou une autre orthographe.
          </Text>
          {canSearch ? (
            <Pressable onPress={() => void runSearch()} style={styles.retryButton}>
              <Text style={styles.retryText}>Relancer</Text>
            </Pressable>
          ) : null}
        </View>
      ) : activeHit && current?.phase === 'playing' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setTab('player')}
          style={({ pressed }) => [styles.playingRow, pressed && { opacity: 0.8 }]}>
          <View style={styles.playingDot} />
          <Text style={styles.playingText}>
            En lecture · {displayTitle(activeHit.filename)}
          </Text>
          <Text style={styles.playingOpen}>Ouvrir</Text>
        </Pressable>
      ) : activeHit ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setTab('player')}
          style={({ pressed }) => [styles.nowCard, pressed && { opacity: 0.9 }]}>
          <CoverArt
            seed={`${activeHit.username}:${activeHit.filename}`}
            title={displayTitle(activeHit.filename)}
            size={64}
          />
          <View style={styles.nowBody}>
            <Text
              style={[
                styles.nowEyebrow,
                current?.phase === 'error' && { color: colors.danger },
              ]}>
              {current?.phase === 'error' ? 'LECTURE INTERROMPUE' : 'MATCH TROUVÉ'}
            </Text>
            <Text style={styles.nowTitle} numberOfLines={2}>
              {displayTitle(activeHit.filename)}
            </Text>
            <Text style={styles.nowArtist} numberOfLines={1}>
              {displayArtist(activeHit) ?? activeHit.username}
            </Text>
            <Text style={styles.nowMeta} numberOfLines={1}>
              {!current || current.phase === 'preparing'
                ? 'Préparation du flux…'
                : current.phase === 'error'
                  ? current.error ?? 'Le flux n’a pas pu démarrer'
                  : 'Touchez pour ouvrir le lecteur'}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : (
        <View style={styles.idleCard}>
          <Text style={styles.idleGlyph}>♫</Text>
          <Text style={styles.idleTitle}>Tape un titre pour lancer la lecture</Text>
          <Text style={styles.idleBody}>
            SoulStream choisit le premier MP3 qui correspond, le précharge en
            arrière-plan et démarre sans autre écran intermédiaire.
          </Text>
        </View>
      )}

      {current?.phase === 'error' ? (
        <Pressable onPress={retryPlayback} style={styles.retryButton}>
          <Text style={styles.retryText}>Réessayer la lecture</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  header: {
    paddingVertical: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    maxWidth: 330,
  },
  searchCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSoft,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 54,
  },
  searchGlyph: {
    color: colors.textDim,
    fontSize: 26,
    marginRight: 8,
    marginTop: -3,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 20,
  },
  action: {
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDisabled: {
    opacity: 0.4,
  },
  actionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  actionGlyph: {
    color: '#ffffff',
    fontSize: 15,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  policyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'center',
  },
  policy: {
    color: colors.textDim,
    fontSize: 11,
  },
  policyDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textDim,
  },
  searchingCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  searchingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  searchingTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  queryPreview: {
    color: colors.accentBright,
    fontSize: 12,
  },
  searchingHint: {
    color: colors.textDim,
    fontSize: 11.5,
  },
  infoCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  infoTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  infoBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  errorCard: {
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248, 113, 113, 0.4)',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorTitle: {
    color: '#fca5a5',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  retryText: {
    color: colors.accentBright,
    fontSize: 12.5,
    fontWeight: '700',
  },
  nowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  nowBody: {
    flex: 1,
    gap: 2,
  },
  nowEyebrow: {
    color: colors.success,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  nowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  nowArtist: {
    color: colors.accentBright,
    fontSize: 12.5,
  },
  nowMeta: {
    color: colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  chevron: {
    color: colors.textDim,
    fontSize: 28,
    lineHeight: 30,
  },
  playingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  playingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  playingText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  playingOpen: {
    color: colors.accentBright,
    fontSize: 12,
    fontWeight: '700',
  },
  idleCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  idleGlyph: {
    color: colors.accent,
    fontSize: 42,
    marginBottom: 2,
  },
  idleTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  idleBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 310,
  },
});
