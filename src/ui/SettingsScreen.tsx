import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import type { Settings } from '../services/settings';
import { useAppStore } from '../state/store';
import { Button, Dot, ListRow, StepSlider, Toggle, connectionStatus } from './components';
import { DebugLogScreen } from './DebugLogScreen';
import { Icon } from './Icon';
import { colors, formatBytes, gutter, radius, spacing, type } from './theme';

/** Buffer sizes offered by the slider, within the 0.25–64 MB bounds of `loadSettings`. */
const BUFFER_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const;

function formatMb(value: number): string {
  return `${String(value).replace('.', ',')} Mo`;
}

function nearestBufferIndex(value: number): number {
  let best = 0;

  BUFFER_STEPS.forEach((step, index) => {
    if (Math.abs(step - value) < Math.abs(BUFFER_STEPS[best] - value)) {
      best = index;
    }
  });

  return best;
}

function parsePort(value: string, allowZero: boolean): number {
  const port = Number(value.trim());

  if (!Number.isInteger(port) || port < 0 || port > 65535 || (!allowZero && port === 0)) {
    throw new Error('Port invalide (1–65535)');
  }

  return port;
}

export function SettingsScreen() {
  const [page, setPage] = React.useState<'main' | 'network' | 'log'>('main');

  if (page === 'log') {
    return <DebugLogScreen onBack={() => setPage('main')} />;
  }

  return page === 'network' ? (
    <NetworkSettings onBack={() => setPage('main')} />
  ) : (
    <MainSettings onOpenNetwork={() => setPage('network')} onOpenLog={() => setPage('log')} />
  );
}

function MainSettings({
  onOpenNetwork,
  onOpenLog,
}: {
  onOpenNetwork: () => void;
  onOpenLog: () => void;
}) {
  const settings = useAppStore(state => state.settings);
  const applySettings = useAppStore(state => state.applySettings);
  const username = useAppStore(state => state.username);
  const connection = useAppStore(state => state.connection);
  const connectionError = useAppStore(state => state.connectionError);
  const listenPort = useAppStore(state => state.listenPort);
  const httpPort = useAppStore(state => state.httpPort);
  const logout = useAppStore(state => state.logout);
  const cacheStats = useAppStore(state => state.cacheStats);
  const clearCache = useAppStore(state => state.clearCache);
  const importTracks = useAppStore(state => state.importTracks);
  const [importing, setImporting] = React.useState(false);
  // Recomputed on each render; the settings screen is small.
  const stats = cacheStats();
  const [, refresh] = React.useReducer((n: number) => n + 1, 0);

  const toggle = (patch: Partial<Settings>) => {
    void applySettings({ ...settings, ...patch });
  };

  const confirmClear = () => {
    Alert.alert(
      'Vider les morceaux écoutés',
      'Les morceaux déjà écoutés seront supprimés de l’appareil et ne seront plus partagés. Les morceaux ajoutés restent.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Vider',
          style: 'destructive',
          onPress: () => {
            void clearCache().then(refresh);
          },
        },
      ],
    );
  };

  const addTracks = async () => {
    setImporting(true);

    try {
      const summary = await importTracks();

      if (summary) {
        Alert.alert('Ajout au partage', summary);
      }
    } catch (error) {
      Alert.alert('Ajout impossible', error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
      refresh();
    }
  };

  const confirmRemoveAdded = () => {
    Alert.alert(
      'Retirer les morceaux ajoutés',
      'Les copies faites par SoulStream seront supprimées et ne seront plus partagées. Les fichiers d’origine sur le téléphone ne sont pas touchés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: () => {
            void clearCache(true).then(refresh);
          },
        },
      ],
    );
  };

  // Index picked on the slider; null until the user moves it, so a stored
  // value between two steps (e.g. 3 Mo) is shown as is and not rewritten.
  const [picked, setPicked] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setPicked(null);
  }, [settings.bufferMb]);

  const status = connectionStatus(connection);
  const bufferIndex = picked ?? nearestBufferIndex(settings.bufferMb);
  const bufferMb = picked === null ? settings.bufferMb : BUFFER_STEPS[picked];
  const bufferDirty = bufferMb !== settings.bufferMb;

  const saveBuffer = async () => {
    setSaving(true);

    try {
      await applySettings({ ...settings, bufferMb });
    } finally {
      setSaving(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert('Se déconnecter', 'Le compte et le mot de passe seront supprimés de cet appareil.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const statusLine =
    connection === 'online' && listenPort > 0
      ? `${status.label} · port ${listenPort}`
      : connectionError ?? status.label;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.profile}>
        <LinearGradient colors={PROFILE_FADE} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{(username ?? 'S').charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.profileName} numberOfLines={1}>
            {username ?? '—'}
          </Text>
          <View style={styles.profileStatus}>
            <Dot tone={status.tone} pulse={connection === 'online'} />
            <Text style={styles.profileStatusText} numberOfLines={2}>
              {statusLine}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.groupTitle}>Lecture</Text>
      <View style={styles.group}>
        <View style={styles.sliderBlock}>
          <View style={styles.sliderHead}>
            <View style={styles.sliderText}>
              <Text style={styles.rowTitle}>Tampon avant lecture</Text>
              <Text style={styles.rowHint}>
                Plus grand = démarrage plus lent mais moins de coupures.
              </Text>
            </View>
            <Text style={styles.sliderValue}>{formatMb(bufferMb)}</Text>
          </View>
          <StepSlider
            values={BUFFER_STEPS}
            index={bufferIndex}
            onChange={setPicked}
            format={formatMb}
            accessibilityLabel="Taille du tampon"
          />
          {bufferDirty ? (
            <Button
              label="Appliquer"
              size="sm"
              onPress={saveBuffer}
              loading={saving}
              style={styles.sliderApply}
            />
          ) : null}
        </View>
      </View>

      <Text style={styles.groupTitle}>Catalogue</Text>
      <View style={styles.group}>
        <ListRow
          icon="disc"
          title="Catalogue en ligne"
          subtitle="Pochettes, titres, artistes et suggestions via Deezer. Désactivé : uniquement les noms de fichiers Soulseek."
          last
          right={
            <Toggle
              value={settings.catalogEnabled}
              onValueChange={value => toggle({ catalogEnabled: value })}
              accessibilityLabel="Catalogue en ligne"
            />
          }
        />
      </View>

      <Text style={styles.groupTitle}>Partage</Text>
      <View style={styles.group}>
        <ListRow
          icon="peer"
          title="Partager mes morceaux"
          subtitle="Beaucoup de pairs refusent d’envoyer à ceux qui ne partagent rien."
          right={
            <Toggle
              value={settings.shareEnabled}
              onValueChange={value => toggle({ shareEnabled: value })}
              accessibilityLabel="Partager mes morceaux"
            />
          }
        />
        <ListRow
          title="Envoyer uniquement en Wi-Fi"
          subtitle="Évite d’utiliser les données mobiles pour les autres."
          right={
            <Toggle
              value={settings.shareWifiOnly}
              onValueChange={value => toggle({ shareWifiOnly: value })}
              disabled={!settings.shareEnabled}
              accessibilityLabel="Envoyer uniquement en Wi-Fi"
            />
          }
        />
        <ListRow
          icon="music"
          title={importing ? 'Ajout en cours…' : 'Ajouter des morceaux'}
          subtitle="Choisissez des MP3 sur le téléphone : une copie est partagée tout de suite, même avant votre premier téléchargement."
          onPress={importing ? undefined : addTracks}
          chevron
        />
        <ListRow
          title="Morceaux ajoutés"
          value={stats ? `${stats.importedCount} · ${formatBytes(stats.importedBytes)}` : '—'}
        />
        <ListRow
          title="Morceaux écoutés"
          value={stats ? `${stats.count} · ${formatBytes(stats.bytes)}` : '—'}
        />
        {stats && stats.importedCount > 0 ? (
          <ListRow title="Retirer les morceaux ajoutés" onPress={confirmRemoveAdded} danger />
        ) : null}
        <ListRow
          title="Vider les morceaux écoutés"
          onPress={confirmClear}
          danger
          last
        />
      </View>

      <Text style={styles.groupTitle}>Réseau</Text>
      <View style={styles.group}>
        <ListRow
          icon="server"
          title="Serveur et ports"
          value={`${settings.serverHost}:${settings.serverPort}`}
          onPress={onOpenNetwork}
          chevron
        />
        <ListRow title="Port d’écoute" value={listenPort > 0 ? String(listenPort) : '—'} />
        <ListRow title="Port local du lecteur" value={httpPort > 0 ? String(httpPort) : '—'} />
        <ListRow
          icon="info"
          title="Journal de débogage"
          subtitle="Détail des connexions, transferts et erreurs du lecteur"
          onPress={onOpenLog}
          chevron
          last
        />
      </View>

      <Text style={styles.groupTitle}>Compte</Text>
      <View style={styles.group}>
        <ListRow icon="logout" title="Se déconnecter" onPress={confirmLogout} danger last />
      </View>

      <Text style={styles.groupTitle}>À propos</Text>
      <View style={[styles.group, styles.about]}>
        <Text style={styles.aboutText}>
          SoulStream est un client Soulseek expérimental. Il ne fournit aucun catalogue ni
          aucun fichier : tout provient des utilisateurs du réseau.
        </Text>
        <Text style={styles.aboutText}>
          N’écoutez et ne partagez que des œuvres que vous avez le droit d’utiliser. Le
          téléchargement ou le partage d’œuvres protégées sans autorisation peut être illégal
          dans votre pays.
        </Text>
        <Text style={styles.aboutText}>
          SoulStream ne télécharge que des MP3 : les fichiers sont plus petits et démarrent
          presque instantanément, sur iOS comme sur Android.
        </Text>
        <Text style={styles.aboutText}>
          Le partage se configure dans le client, pas dans le compte Soulseek. SoulStream
          partage les morceaux écoutés et ceux que vous ajoutez ; certains utilisateurs
          limitent ou bloquent les téléchargements des pairs qui ne partagent rien.
        </Text>
      </View>
    </ScrollView>
  );
}

const PROFILE_FADE = ['rgba(169,112,255,0.35)', 'rgba(169,112,255,0)'];

function NetworkSettings({ onBack }: { onBack: () => void }) {
  const settings = useAppStore(state => state.settings);
  const applySettings = useAppStore(state => state.applySettings);

  const [host, setHost] = React.useState(settings.serverHost);
  const [serverPort, setServerPort] = React.useState(String(settings.serverPort));
  const [listen, setListen] = React.useState(String(settings.listenPort));
  const [stream, setStream] = React.useState(String(settings.streamPort));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setHost(settings.serverHost);
    setServerPort(String(settings.serverPort));
    setListen(String(settings.listenPort));
    setStream(String(settings.streamPort));
  }, [settings]);

  const save = async () => {
    setError(null);
    setSaved(false);

    try {
      const trimmedHost = host.trim();

      if (!trimmedHost) {
        throw new Error('Indiquez un serveur Soulseek');
      }

      const next: Settings = {
        ...settings,
        serverHost: trimmedHost,
        serverPort: parsePort(serverPort, false),
        listenPort: parsePort(listen, true),
        streamPort: parsePort(stream, true),
      };

      setSaving(true);
      await applySettings(next);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const resetPorts = () => {
    setListen('22345');
    setStream('0');
    setSaved(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Retour aux réglages"
          style={styles.back}>
          <Icon name="left" size={22} color={colors.text} />
          <Text style={styles.backLabel}>Réglages</Text>
        </Pressable>
        <Text style={styles.pageTitle} accessibilityRole="header">
          Serveur et ports
        </Text>
        <Text style={styles.help}>
          Le serveur officiel est server.slsknet.org:2242. Ne le changez que si vous utilisez
          un proxy ou un serveur compatible.
        </Text>

        <Field label="Serveur" value={host} onChangeText={setHost} />
        <View style={styles.fieldRow}>
          <Field
            label="Port serveur"
            value={serverPort}
            onChangeText={setServerPort}
            keyboardType="number-pad"
            flex
          />
          <Field
            label="Port d’écoute"
            value={listen}
            onChangeText={setListen}
            keyboardType="number-pad"
            flex
          />
        </View>
        <Text style={styles.helpSmall}>
          0 = port choisi automatiquement. Pour maximiser les résultats et la vitesse,
          redirigez le port d’écoute (TCP) vers votre téléphone sur votre box.
        </Text>

        <Field
          label="Port HTTP local"
          value={stream}
          onChangeText={setStream}
          keyboardType="number-pad"
        />
        <Text style={styles.helpSmall}>
          Le port HTTP local ne sert qu’au lecteur audio de l’application (127.0.0.1).
        </Text>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
        {saved ? <Text style={styles.inlineSuccess}>Réglages enregistrés.</Text> : null}

        <View style={styles.actions}>
          <Button label="Ports par défaut" variant="ghost" onPress={resetPorts} />
          <Button
            label={saving ? 'Application…' : 'Enregistrer'}
            onPress={save}
            loading={saving}
            style={styles.flex}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
  flex,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: KeyboardTypeOptions;
  flex?: boolean;
}) {
  return (
    <View style={[styles.field, flex && styles.flex]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: gutter,
    paddingBottom: spacing.xxxl,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: -gutter,
    paddingHorizontal: gutter,
    paddingTop: 18,
    paddingBottom: 22,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: colors.onAccent,
    fontSize: 28,
    fontWeight: '900',
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    ...type.title,
    color: colors.text,
  },
  profileStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  profileStatusText: {
    ...type.caption,
    flex: 1,
    color: colors.textMuted,
  },
  groupTitle: {
    ...type.eyebrow,
    fontSize: 12,
    color: colors.textDim,
    marginTop: 22,
    marginBottom: spacing.sm,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  sliderBlock: {
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  sliderHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  sliderText: {
    flex: 1,
    gap: 2,
  },
  sliderValue: {
    ...type.mono,
    color: colors.textMuted,
    fontSize: 13.5,
  },
  sliderApply: {
    marginTop: spacing.sm,
    alignSelf: 'flex-end',
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '600',
  },
  rowHint: {
    ...type.caption,
    color: colors.textDim,
  },
  about: {
    padding: 14,
    gap: spacing.md,
  },
  aboutText: {
    ...type.bodySm,
    color: colors.textMuted,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  backLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  pageTitle: {
    ...type.title,
    color: colors.text,
    marginTop: spacing.md,
  },
  help: {
    ...type.bodySm,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  helpSmall: {
    ...type.caption,
    color: colors.textDim,
    marginTop: spacing.sm,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  field: {
    marginTop: spacing.md,
    gap: 6,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  fieldInput: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  inlineError: {
    color: colors.danger,
    fontSize: 12.5,
    marginTop: spacing.md,
  },
  inlineSuccess: {
    color: colors.success,
    fontSize: 12.5,
    marginTop: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
});
