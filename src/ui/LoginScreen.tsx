import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../state/store';
import { CoverArt, PrimaryButton } from './components';
import { colors, spacing } from './theme';

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const login = useAppStore(state => state.login);
  const connecting = useAppStore(state => state.connection === 'connecting');
  const connectionError = useAppStore(state => state.connectionError);
  const prefillUsername = useAppStore(state => state.prefillUsername);
  const settings = useAppStore(state => state.settings);
  const applySettings = useAppStore(state => state.applySettings);

  const [username, setUsername] = React.useState(prefillUsername);
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [showServer, setShowServer] = React.useState(false);
  const [host, setHost] = React.useState(settings.serverHost);
  const [port, setPort] = React.useState(String(settings.serverPort));
  const [serverSaved, setServerSaved] = React.useState(false);

  React.useEffect(() => {
    if (prefillUsername) {
      setUsername(prefillUsername);
    }
  }, [prefillUsername]);

  React.useEffect(() => {
    setHost(settings.serverHost);
    setPort(String(settings.serverPort));
  }, [settings.serverHost, settings.serverPort]);

  const submit = async () => {
    const nick = username.trim();

    if (!nick) {
      setLocalError("Indiquez votre nom d'utilisateur Soulseek");
      return;
    }

    if (nick.length > 30) {
      setLocalError("Le nom d'utilisateur ne peut pas dépasser 30 caractères");
      return;
    }

    if (!password) {
      setLocalError('Indiquez votre mot de passe');
      return;
    }

    setLocalError(null);
    await login(nick, password);
  };

  const error = localError ?? connectionError;

  const saveServer = async () => {
    const nextPort = Number(port.trim());

    if (!host.trim() || !Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      setLocalError('Serveur ou port invalide');
      return;
    }

    setLocalError(null);
    await applySettings({ ...settings, serverHost: host.trim(), serverPort: nextPort });
    setServerSaved(true);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <CoverArt seed="SoulStream" title="S" size={86} />
          <Text style={styles.title}>SoulStream</Text>
          <Text style={styles.subtitle}>
            Streaming musical pair-à-pair sur le réseau Soulseek
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connexion au réseau</Text>
          <Text style={styles.cardBody}>
            Utilisez votre compte Soulseek. Vos identifiants sont conservés dans le
            trousseau sécurisé de votre appareil.
          </Text>

          <Text style={styles.label}>Nom d'utilisateur</Text>
          <TextInput
            value={username}
            onChangeText={value => {
              setUsername(value);
              setLocalError(null);
            }}
            placeholder="votre_pseudo"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!connecting}
            style={styles.input}
            returnKeyType="next"
          />

          <View style={styles.passwordRow}>
            <Text style={styles.label}>Mot de passe</Text>
            <Pressable onPress={() => setShowPassword(value => !value)} hitSlop={8}>
              <Text style={styles.showPassword}>
                {showPassword ? 'Masquer' : 'Afficher'}
              </Text>
            </Pressable>
          </View>

          <TextInput
            value={password}
            onChangeText={value => {
              setPassword(value);
              setLocalError(null);
            }}
            placeholder="••••••••"
            placeholderTextColor={colors.textDim}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!connecting}
            style={styles.input}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={connecting ? 'Connexion…' : 'Se connecter'}
            onPress={submit}
            loading={connecting}
            style={styles.submit}
          />

          <View style={styles.connectingRow}>
            {connecting ? (
              <>
                <ActivityIndicator size="small" color={colors.accentBright} />
                <Text style={styles.connectingText}>Connexion au serveur Soulseek…</Text>
              </>
            ) : null}
          </View>
        </View>

        <Pressable
          onPress={() => {
            setShowServer(value => !value);
            setServerSaved(false);
          }}
          style={styles.serverToggle}>
          <Text style={styles.serverToggleText}>
            Serveur : {settings.serverHost}:{settings.serverPort} · modifier
          </Text>
        </Pressable>

        {showServer ? (
          <View style={styles.serverCard}>
            <View style={styles.serverRow}>
              <View style={styles.serverField}>
                <Text style={styles.label}>Hôte</Text>
                <TextInput
                  value={host}
                  onChangeText={value => {
                    setHost(value);
                    setServerSaved(false);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="server.slsknet.org"
                  placeholderTextColor={colors.textDim}
                  style={styles.input}
                />
              </View>
              <View style={styles.serverPortField}>
                <Text style={styles.label}>Port</Text>
                <TextInput
                  value={port}
                  onChangeText={value => {
                    setPort(value);
                    setServerSaved(false);
                  }}
                  keyboardType="number-pad"
                  placeholder="2242"
                  placeholderTextColor={colors.textDim}
                  style={styles.input}
                />
              </View>
            </View>
            <Pressable onPress={saveServer} style={styles.serverSave}>
              <Text style={styles.serverSaveText}>
                {serverSaved ? 'Serveur enregistré ✓' : 'Enregistrer le serveur'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={() => Linking.openURL('https://www.slsknet.org/')}
          style={styles.createAccount}>
          <Text style={styles.createAccountText}>
            Pas encore de compte ? Créer un compte sur slsknet.org
          </Text>
        </Pressable>

        <Text style={styles.legal}>
          SoulStream ne fournit aucun contenu. Vous êtes responsable des œuvres que
          vous écoutez et partagez. Le réseau Soulseek nécessite un port entrant
          accessible pour de meilleures performances.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.xl,
    flexGrow: 1,
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: spacing.lg,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 300,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: spacing.lg,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 7,
    textTransform: 'uppercase',
  },
  input: {
    height: 50,
    borderRadius: 13,
    backgroundColor: colors.bgSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.lg,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  showPassword: {
    color: colors.accentBright,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 7,
  },
  errorBox: {
    backgroundColor: 'rgba(248, 113, 113, 0.10)',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
  submit: {
    marginTop: spacing.xs,
  },
  connectingRow: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.md,
  },
  connectingText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  serverToggle: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingVertical: 6,
  },
  serverToggleText: {
    color: colors.textDim,
    fontSize: 11.5,
  },
  serverCard: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  serverRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  serverField: {
    flex: 1,
  },
  serverPortField: {
    width: 86,
  },
  serverSave: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
  },
  serverSaveText: {
    color: colors.accentBright,
    fontSize: 12,
    fontWeight: '600',
  },
  createAccount: {
    marginTop: spacing.xl,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  createAccountText: {
    color: colors.accentBright,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  legal: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
