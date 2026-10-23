import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppStore } from '../state/store';
import { Chip, GhostButton, PrimaryButton } from './components';
import { colors, spacing } from './theme';

function stateLabel(state: string): { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  switch (state) {
    case 'online':
      return { label: 'Connecté', tone: 'success' };
    case 'connecting':
      return { label: 'Connexion…', tone: 'warning' };
    case 'reconnecting':
      return { label: 'Reconnexion…', tone: 'warning' };
    case 'error':
      return { label: 'Erreur', tone: 'danger' };
    case 'disconnected':
      return { label: 'Déconnecté', tone: 'danger' };
    default:
      return { label: 'Inactif', tone: 'muted' };
  }
}

function parsePort(value: string, allowZero: boolean): number {
  const port = Number(value.trim());

  if (!Number.isInteger(port) || port < 0 || port > 65535 || (!allowZero && port === 0)) {
    throw new Error('Port invalide (1–65535)');
  }

  return port;
}

export function SettingsScreen() {
  const settings = useAppStore(state => state.settings);
  const applySettings = useAppStore(state => state.applySettings);
  const username = useAppStore(state => state.username);
  const connection = useAppStore(state => state.connection);
  const connectionError = useAppStore(state => state.connectionError);
  const listenPort = useAppStore(state => state.listenPort);
  const httpPort = useAppStore(state => state.httpPort);
  const logout = useAppStore(state => state.logout);

  const [host, setHost] = React.useState(settings.serverHost);
  const [serverPort, setServerPort] = React.useState(String(settings.serverPort));
  const [listen, setListen] = React.useState(String(settings.listenPort));
  const [stream, setStream] = React.useState(String(settings.streamPort));
  const [buffer, setBuffer] = React.useState(String(settings.bufferMb));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setHost(settings.serverHost);
    setServerPort(String(settings.serverPort));
    setListen(String(settings.listenPort));
    setStream(String(settings.streamPort));
    setBuffer(String(settings.bufferMb));
  }, [settings]);

  const status = stateLabel(connection);

  const save = async () => {
    setError(null);
    setSaved(false);

    try {
      const trimmedHost = host.trim();

      if (!trimmedHost) {
        throw new Error('Indiquez un serveur Soulseek');
      }

      const next = {
        serverHost: trimmedHost,
        serverPort: parsePort(serverPort, false),
        listenPort: parsePort(listen, true),
        streamPort: parsePort(stream, true),
        bufferMb: Number(buffer.replace(',', '.')),
      };

      if (
        !Number.isFinite(next.bufferMb) ||
        next.bufferMb < 0.25 ||
        next.bufferMb > 64
      ) {
        throw new Error('Tampon invalide (0,25 à 64 Mo)');
      }

      setSaving(true);
      await applySettings(next);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert(
      'Se déconnecter',
      'Le compte et le mot de passe seront supprimés de cet appareil.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Se déconnecter', style: 'destructive', onPress: () => logout() },
      ],
    );
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
        <Text style={styles.title}>Réglages</Text>
        <Text style={styles.subtitle}>Connexion, réseau et stockage</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Compte</Text>
            <Chip label={status.label} tone={status.tone} />
          </View>
          <Text style={styles.accountName}>{username ?? '—'}</Text>
          <View style={styles.infoGrid}>
            <InfoLine label="Port d’écoute" value={listenPort > 0 ? String(listenPort) : '—'} />
            <InfoLine label="Port local" value={httpPort > 0 ? String(httpPort) : '—'} />
          </View>
          {connectionError ? <Text style={styles.inlineError}>{connectionError}</Text> : null}
          <GhostButton label="Se déconnecter" onPress={confirmLogout} danger />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Réseau Soulseek</Text>
          <Text style={styles.help}>
            Le serveur officiel est server.slsknet.org:2242. Ne le changez que si vous
            utilisez un proxy ou un serveur compatible.
          </Text>

          <Field label="Serveur" value={host} onChangeText={setHost} autoCapitalize="none" />
          <View style={styles.row}>
            <Field
              label="Port serveur"
              value={serverPort}
              onChangeText={setServerPort}
              keyboardType="number-pad"
              style={styles.flex}
            />
            <Field
              label="Port d’écoute"
              value={listen}
              onChangeText={setListen}
              keyboardType="number-pad"
              style={styles.flex}
            />
          </View>
          <Text style={styles.helpSmall}>
            0 = port choisi automatiquement. Pour maximiser les résultats et la vitesse,
            redirigez le port d’écoute (TCP) vers votre téléphone sur votre box.
          </Text>

          <View style={styles.row}>
            <Field
              label="Port HTTP local"
              value={stream}
              onChangeText={setStream}
              keyboardType="number-pad"
              style={styles.flex}
            />
            <Field
              label="Tampon (Mo)"
              value={buffer}
              onChangeText={setBuffer}
              keyboardType="decimal-pad"
              style={styles.flex}
            />
          </View>
          <Text style={styles.helpSmall}>
            Le port HTTP local ne sert qu’au lecteur audio de l’application
            (127.0.0.1).
          </Text>

          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          {saved ? <Text style={styles.inlineSuccess}>Réglages enregistrés.</Text> : null}

          <View style={styles.actions}>
            <GhostButton label="Ports par défaut" onPress={resetPorts} />
            <PrimaryButton
              label={saving ? 'Application…' : 'Enregistrer'}
              onPress={save}
              loading={saving}
              style={styles.saveButton}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>À propos</Text>
          <Text style={styles.about}>
            SoulStream est un client Soulseek expérimental. Il ne fournit aucun
            catalogue ni aucun fichier : tout provient des utilisateurs du réseau.
          </Text>
          <Text style={styles.about}>
            N’écoutez et ne partagez que des œuvres que vous avez le droit d’utiliser.
            Le téléchargement ou le partage d’œuvres protégées sans autorisation peut
            être illégal dans votre pays.
          </Text>
          <Text style={styles.about}>
            SoulStream ne télécharge que des MP3 : les fichiers sont plus petits et
            démarrent presque instantanément, sur iOS comme sur Android.
          </Text>
          <Text style={styles.about}>
            Le partage de fichiers n’est pas encore implémenté. Le partage se
            configure dans le client, pas dans le compte Soulseek ; certains
            utilisateurs limitent ou bloquent les téléchargements des pairs qui ne
            partagent rien.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  style,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  autoCapitalize?: 'none' | 'sentences';
  style?: any;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
      />
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
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
    marginTop: -8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  accountName: {
    color: colors.accentBright,
    fontSize: 20,
    fontWeight: '800',
    marginTop: -4,
  },
  infoGrid: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
  infoLine: {
    gap: 2,
  },
  infoLabel: {
    color: colors.textDim,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  infoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  help: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -4,
  },
  helpSmall: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: -4,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldInput: {
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 15,
  },
  inlineError: {
    color: '#fca5a5',
    fontSize: 12,
    lineHeight: 17,
  },
  inlineSuccess: {
    color: colors.success,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  saveButton: {
    flex: 1,
  },
  about: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
