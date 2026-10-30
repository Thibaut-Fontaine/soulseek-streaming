import React from 'react';
import { FlatList, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import {
  clearDebugLog,
  formatDebugLog,
  formatLogTime,
  getDebugLog,
  subscribeDebugLog,
} from '../services/debugLog';
import type { LogEntry, LogTag } from '../services/debugLog';
import { useAppStore } from '../state/store';
import type { SearchHit } from '../core/types';
import { redactUploaderNames, uploaderPhrase } from '../strings';
import { Button } from './components';
import { Icon } from './Icon';
import { colors, gutter, spacing, type } from './theme';

const TAG_COLORS: Record<LogTag, string> = {
  net: colors.textMuted,
  peer: colors.info,
  transfer: colors.accent,
  http: colors.success,
  player: colors.warning,
  play: colors.text,
  app: colors.textDim,
  perf: colors.danger,
};

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

function useDebugLog(): readonly LogEntry[] {
  const [, setVersion] = React.useState(0);

  React.useEffect(() => subscribeDebugLog(() => setVersion(value => value + 1)), []);

  return getDebugLog();
}

/** Uploaders that may appear in the journal, so they can be redacted. */
function knownUploaders(): string[] {
  const state = useAppStore.getState();
  const hits: Array<SearchHit | undefined> = [
    state.current?.hit,
    ...state.results.map(ranked => ranked.hit),
    ...state.queue,
    ...(state.context?.items ?? []),
    ...state.device,
    ...state.library.history.map(saved => saved.hit),
    ...state.library.liked.map(saved => saved.hit),
  ];
  return [...new Set(hits.map(hit => hit?.username).filter((name): name is string => !!name))];
}

/** Réglages → Journal de débogage: every step of fetching and playing a track. */
export function DebugLogScreen({ onBack }: { onBack: () => void }) {
  const entries = useDebugLog();
  const showUploaders = useAppStore(state => state.settings.showUploaders);
  // The journal is one array mutated in place: copy it on every update.
  const list = [...entries].reverse();

  const share = () => {
    const state = useAppStore.getState();
    const header = [
      `SoulStream — journal du ${new Date().toLocaleString('fr-FR')}`,
      `${Platform.OS} ${String(Platform.Version)}`,
      `serveur ${state.settings.serverHost}:${state.settings.serverPort}, connexion ${state.connection}`,
      `port d'écoute ${state.listenPort || state.settings.listenPort}, port lecteur ${state.httpPort}`,
      `tampon ${state.settings.bufferMb} Mo, partage ${state.settings.shareEnabled ? 'oui' : 'non'}`,
      state.current
        ? `en cours : ${state.current.phase} ${uploaderPhrase(state.current.hit.username, showUploaders)} ${state.current.error ?? ''}`
        : 'aucune lecture en cours',
    ].join('\n');

    const message = formatDebugLog(header);
    Share.share({
      message: showUploaders ? message : redactUploaderNames(message, knownUploaders()),
    }).catch(() => {});
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Retour aux réglages"
          style={styles.back}>
          <Icon name="left" size={22} color={colors.text} />
          <Text style={styles.backLabel}>Réglages</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Journal de débogage
        </Text>
        <Text style={styles.help}>
          Chaque étape d’une recherche et d’une lecture : connexion au pair, file
          d’attente, transfert, requêtes du lecteur. Lancez un morceau, puis partagez le
          journal.
        </Text>
        <View style={styles.actions}>
          <Button label="Partager" icon="right" onPress={share} style={styles.flex} />
          <Button label="Effacer" variant="ghost" onPress={clearDebugLog} />
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item, index) => `${item.at}-${index}`}
        contentContainerStyle={styles.list}
        initialNumToRender={40}
        ListEmptyComponent={<Text style={styles.empty}>Rien pour l’instant.</Text>}
        renderItem={({ item }) => (
          <Text style={styles.line} selectable>
            <Text style={styles.time}>{formatLogTime(item.at)} </Text>
            <Text style={{ color: TAG_COLORS[item.tag] }}>{item.tag.padEnd(8)} </Text>
            <Text style={styles.message}>{item.message}</Text>
          </Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: gutter, paddingBottom: spacing.sm },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  backLabel: { ...type.body, color: colors.text },
  title: { ...type.title, color: colors.text, marginTop: spacing.md },
  help: { ...type.bodySm, color: colors.textMuted, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  list: { paddingHorizontal: gutter, paddingBottom: spacing.xxxl },
  line: { fontFamily: MONO, fontSize: 11, lineHeight: 16, marginBottom: 4 },
  time: { color: colors.textDim },
  message: { color: colors.text },
  empty: { ...type.bodySm, color: colors.textDim, marginTop: spacing.lg },
});
