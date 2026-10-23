import React from 'react';
import { ActivityIndicator, AppState, StatusBar, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from './src/state/store';
import { CoverArt, Toast } from './src/ui/components';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { LoginScreen } from './src/ui/LoginScreen';
import { MiniPlayer } from './src/ui/MiniPlayer';
import { PlayerScreen } from './src/ui/PlayerScreen';
import { SearchScreen } from './src/ui/SearchScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { TabBar } from './src/ui/TabBar';
import { colors, gutter, spacing, type } from './src/ui/theme';

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
  const hasCurrent = useAppStore(state => state.current !== null);
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
      <Banners />
      <View style={styles.content}>
        {tab === 'search' ? (
          <SearchScreen />
        ) : tab === 'player' ? (
          <PlayerScreen />
        ) : (
          <SettingsScreen />
        )}
      </View>

      <View style={styles.dock}>
        <LinearGradient colors={DOCK_FADE} style={styles.dockFade} pointerEvents="none" />
        {hasCurrent && tab !== 'player' ? <MiniPlayer /> : null}
        <TabBar active={tab} onChange={setTab} bottomInset={insets.bottom} />
      </View>
    </View>
  );
}

const DOCK_FADE = ['rgba(11,10,15,0)', colors.bg];

/** Connection state and network notices, shown above the current screen. */
function Banners() {
  const connection = useAppStore(state => state.connection);
  const connectionError = useAppStore(state => state.connectionError);
  const notice = useAppStore(state => state.notice);
  const dismissNotice = useAppStore(state => state.dismissNotice);
  const reconnect = useAppStore(state => state.reconnect);

  const reconnecting = connection === 'connecting' || connection === 'reconnecting';
  const offline = connection === 'disconnected' || connection === 'error';

  if (!notice && !reconnecting && !offline) {
    return null;
  }

  return (
    <View style={styles.banners}>
      {reconnecting ? (
        <Toast
          key="reconnecting"
          tone="warn"
          icon="server"
          message={
            connection === 'reconnecting'
              ? 'Reconnexion au serveur Soulseek…'
              : 'Connexion au serveur Soulseek…'
          }
        />
      ) : null}
      {offline ? (
        <Toast
          key="offline"
          tone="bad"
          icon="offline"
          message={connectionError ?? 'Déconnecté du réseau Soulseek'}
          actionLabel="Réessayer"
          onAction={() => void reconnect()}
        />
      ) : null}
      {notice ? (
        <Toast key={notice} tone="warn" icon="info" message={notice} onDismiss={dismissNotice} />
      ) : null}
    </View>
  );
}

function Splash() {
  return (
    <View style={styles.splash}>
      <CoverArt seed="SoulStream" title="S" size={92} />
      <Text style={styles.splashTitle}>SoulStream</Text>
      <ActivityIndicator color={colors.accent} style={styles.splashSpinner} />
      <Text style={styles.splashText}>Initialisation du lecteur…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
  },
  banners: {
    paddingTop: spacing.sm,
    paddingHorizontal: gutter,
    gap: spacing.sm,
  },
  dock: {
    backgroundColor: colors.bg,
  },
  dockFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -28,
    height: 28,
  },
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTitle: {
    ...type.display,
    color: colors.text,
    marginTop: spacing.xl,
  },
  splashSpinner: {
    marginTop: spacing.xl,
  },
  splashText: {
    ...type.caption,
    color: colors.textDim,
    marginTop: spacing.sm,
  },
});

export default App;
