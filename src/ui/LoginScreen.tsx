import React from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../state/store';
import { Button, CoverArt } from './components';
import { Icon } from './Icon';
import { colors, gutter, radius, spacing, type } from './theme';

const MOSAIC_SEEDS = [
  'Teardrop',
  'Roygbiv',
  'Odessa',
  'Kerala',
  'Roads',
  'Genesis',
  'Bad Kingdom',
  'Fake Plastic Trees',
  'Windowlicker',
  'Midnight City',
  'Glory Box',
  'Archangel',
];

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const login = useAppStore(state => state.login);
  const connecting = useAppStore(state => state.connection === 'connecting');
  const connectionError = useAppStore(state => state.connectionError);
  const prefillUsername = useAppStore(state => state.prefillUsername);
  const settings = useAppStore(state => state.settings);

  const [username, setUsername] = React.useState(prefillUsername);
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [serverOpen, setServerOpen] = React.useState(false);
  const passwordRef = React.useRef<TextInput>(null);

  React.useEffect(() => {
    if (prefillUsername) {
      setUsername(prefillUsername);
    }
  }, [prefillUsername]);

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

  return (
    <View style={styles.root}>
      <View style={styles.hero} pointerEvents="none">
        <View style={styles.mosaic}>
          {MOSAIC_SEEDS.map(seed => (
            <CoverArt key={seed} seed={seed} title={seed} size={84} rounded="sm" />
          ))}
        </View>
        <LinearGradient colors={HERO_FADE} locations={HERO_STOPS} style={StyleSheet.absoluteFill} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 120, paddingBottom: insets.bottom + 28 },
          ]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.logo}>
            <Icon name="wave" size={34} color={colors.onAccent} strokeWidth={2.6} />
          </View>
          <Text style={styles.title}>SoulStream</Text>
          <Text style={styles.subtitle}>
            Streaming musical pair-à-pair sur le réseau Soulseek. Vos identifiants restent
            dans le trousseau sécurisé de l’appareil.
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
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel="Nom d'utilisateur"
          />

          <View style={styles.passwordHead}>
            <Text style={styles.label}>Mot de passe</Text>
            <Pressable onPress={() => setShowPassword(value => !value)} hitSlop={8}>
              <Text style={styles.link}>{showPassword ? 'Masquer' : 'Afficher'}</Text>
            </Pressable>
          </View>
          <TextInput
            ref={passwordRef}
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
            accessibilityLabel="Mot de passe"
          />

          {error ? (
            <View style={styles.errorBox}>
              <Icon name="info" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* TODO(wire): show Serveur → Auth → Port steps once the store exposes
              login sub-states; `connection` is only "connecting" today. */}
          <Button
            label={connecting ? 'Connexion au serveur…' : 'Se connecter'}
            onPress={submit}
            loading={connecting}
            block
            style={styles.submit}
          />

          <Pressable
            onPress={() => setServerOpen(true)}
            style={styles.serverLink}
            accessibilityRole="button">
            <Icon name="server" size={16} color={colors.textDim} />
            <Text style={styles.serverLinkText}>
              {settings.serverHost}:{settings.serverPort} · modifier
            </Text>
          </Pressable>

          <Pressable onPress={() => Linking.openURL('https://www.slsknet.org/')} style={styles.create}>
            <Text style={styles.link}>Pas encore de compte ? Créer un compte sur slsknet.org</Text>
          </Pressable>

          <Text style={styles.legal}>
            SoulStream ne fournit aucun contenu. Vous êtes responsable des œuvres que vous
            écoutez et partagez. Le réseau Soulseek nécessite un port entrant accessible pour
            de meilleures performances.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </View>
  );
}

const HERO_FADE = ['rgba(11,10,15,0.15)', 'rgba(11,10,15,0.7)', colors.bg];
const HERO_STOPS = [0, 0.55, 1];

/** Bottom sheet for the server address (rarely changed, so kept out of the way). */
function ServerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const settings = useAppStore(state => state.settings);
  const applySettings = useAppStore(state => state.applySettings);

  const [host, setHost] = React.useState(settings.serverHost);
  const [port, setPort] = React.useState(String(settings.serverPort));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      setHost(settings.serverHost);
      setPort(String(settings.serverPort));
      setError(null);
    }
  }, [visible, settings.serverHost, settings.serverPort]);

  const save = async () => {
    const nextPort = Number(port.trim());

    if (!host.trim() || !Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      setError('Serveur ou port invalide');
      return;
    }

    await applySettings({ ...settings, serverHost: host.trim(), serverPort: nextPort });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Fermer" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Serveur Soulseek</Text>
          <Text style={styles.sheetBody}>
            Le serveur officiel est server.slsknet.org:2242. Ne le changez que si vous utilisez
            un proxy ou un serveur compatible.
          </Text>
          <View style={styles.sheetRow}>
            <View style={styles.flex}>
              <Text style={styles.label}>Hôte</Text>
              <TextInput
                value={host}
                onChangeText={setHost}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="server.slsknet.org"
                placeholderTextColor={colors.textDim}
                style={styles.input}
              />
            </View>
            <View style={styles.sheetPort}>
              <Text style={styles.label}>Port</Text>
              <TextInput
                value={port}
                onChangeText={setPort}
                keyboardType="number-pad"
                placeholder="2242"
                placeholderTextColor={colors.textDim}
                style={styles.input}
              />
            </View>
          </View>
          {error ? <Text style={styles.sheetError}>{error}</Text> : null}
          <View style={styles.sheetActions}>
            <Button label="Annuler" variant="ghost" onPress={onClose} />
            <Button label="Enregistrer" onPress={save} style={styles.flex} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 420,
    overflow: 'hidden',
  },
  mosaic: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    width: 4 * 84 + 3 * spacing.sm,
    alignSelf: 'center',
    marginTop: -20,
    opacity: 0.55,
    transform: [{ rotate: '-8deg' }, { scale: 1.15 }],
  },
  content: {
    paddingHorizontal: spacing.xl,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...type.display,
    color: colors.text,
    marginTop: spacing.lg,
  },
  subtitle: {
    ...type.bodySm,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
  },
  passwordHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  link: {
    color: colors.accent,
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  input: {
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  submit: {
    marginTop: spacing.xl,
  },
  serverLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: 6,
  },
  serverLinkText: {
    color: colors.textDim,
    fontSize: 12,
  },
  create: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  legal: {
    ...type.caption,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHigh,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    ...type.heading,
    color: colors.text,
  },
  sheetBody: {
    ...type.bodySm,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  sheetRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  sheetPort: {
    width: 96,
  },
  sheetError: {
    color: colors.danger,
    fontSize: 12.5,
    marginTop: spacing.md,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
});
