import React from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ConnectionState } from './src/core/soulseekClient';
import { useAppStore } from './src/state/store';
import { CoverArt } from './src/ui/components';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { LoginScreen } from './src/ui/LoginScreen';
import { MiniPlayer } from './src/ui/MiniPlayer';
import { PlayerScreen } from './src/ui/PlayerScreen';
import { SearchScreen } from './src/ui/SearchScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { TabBar } from './src/ui/TabBar';
import { colors, spacing } from './src/ui/theme';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function Root() {
  const ready = useAppStore(state => state.ready);
  const username = useAppStore(state => state.username);
  const tab = useAppStore(state => state.tab);
  const setTab = useAppStore(state => state.setTab);
  const connection = useAppStore(state => state.connection);
  const current = useAppStore(state => state.current);
  const notice = useAppStore(state => state.notice);
  const dismissNotice = useAppStore(state => state.dismissNotice);
  const init = useAppStore(state => state.init);
  const reconnect = useAppStore(state => state.reconnect);

  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    void init();
  }, [init]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (
        nextState === 'active' &&
        username &&
        (connection === 'disconnected' || connection === 'error')
      ) {
        void reconnect();
      }
    });

    return () => subscription.remove();
  }, [username, connection, reconnect]);

  if (!ready) {
    return <Splash />;
  }

  if (!username) {
    return <LoginScreen />;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar connection={connection} />

      {notice ? (
        <Pressable style={styles.notice} onPress={dismissNotice}>
          <Text style={styles.noticeText}>{notice}</Text>
          <Text style={styles.noticeClose}>×</Text>
        </Pressable>
      ) : null}

      <View style={styles.content}>
        {tab === 'search' ? (
          <SearchScreen />
        ) : tab === 'player' ? (
          <PlayerScreen />
        ) : (
          <SettingsScreen />
        )}
      </View>

      {current ? <MiniPlayer /> : null}

      <TabBar active={tab} onChange={setTab} bottomInset={insets.bottom} />
    </View>
  );
}

function Splash() {
  return (
    <View style={styles.splash}>
      <CoverArt seed="SoulStream" title="S" size={92} />
      <Text style={styles.splashTitle}>SoulStream</Text>
      <ActivityIndicator color={colors.accentBright} style={{ marginTop: 20 }} />
      <Text style={styles.splashText}>Initialisation du lecteur…</Text>
    </View>
  );
}

function TopBar({ connection }: { connection: ConnectionState }) {
  const status = connectionStatus(connection);

  return (
    <View style={styles.topBar}>
      <View style={styles.logo}>
        <Text style={styles.logoGlyph}>♫</Text>
      </View>
      <Text style={styles.brand}>SoulStream</Text>

      <View style={styles.topRight}>
        <View style={[styles.connectionDot, { backgroundColor: status.color }]} />
        <Text style={styles.connectionLabel}>{status.label}</Text>
      </View>
    </View>
  );
}

function connectionStatus(connection: ConnectionState): { label: string; color: string } {
  switch (connection) {
    case 'online':
      return { label: 'En ligne', color: colors.success };
    case 'connecting':
      return { label: 'Connexion', color: colors.warning };
    case 'reconnecting':
      return { label: 'Reconnexion', color: colors.warning };
    case 'error':
      return { label: 'Erreur', color: colors.danger };
    case 'disconnected':
      return { label: 'Hors ligne', color: colors.danger };
    default:
      return { label: 'Inactif', color: colors.textDim };
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 9,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlyph: {
    color: colors.accentBright,
    fontSize: 16,
    marginTop: -1,
  },
  brand: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  topRight: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  connectionLabel: {
    color: colors.textMuted,
    fontSize: 11.5,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(251, 191, 36, 0.35)',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    gap: spacing.md,
  },
  noticeText: {
    color: '#fcd34d',
    fontSize: 12,
    flex: 1,
  },
  noticeClose: {
    color: '#fcd34d',
    fontSize: 18,
    lineHeight: 20,
  },
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 20,
  },
  splashText: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: 10,
  },
});

export default App;
