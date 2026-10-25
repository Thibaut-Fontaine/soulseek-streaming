import React from 'react';
import { ActivityIndicator, AppState, BackHandler, StatusBar, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from './src/state/store';
import { IconButton, Toast } from './src/ui/components';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { HomeScreen } from './src/ui/HomeScreen';
import { LibraryScreen } from './src/ui/LibraryScreen';
import { LoginScreen } from './src/ui/LoginScreen';
import { MiniPlayer } from './src/ui/MiniPlayer';
import { PageHost } from './src/ui/pages';
import { PlayerSheet } from './src/ui/PlayerScreen';
import { SearchScreen } from './src/ui/SearchScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { SheetHost } from './src/ui/Sheets';
import { TabBar } from './src/ui/TabBar';
import { AppLogo } from './src/ui/track';
import { colors, gutter, spacing, type } from './src/ui/theme';

/** After this long in the background, check the server connection on return. */
const CHECK_AFTER_BACKGROUND_MS = 60_000;

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
  const closeAllPages = useAppStore(state => state.closeAllPages);
  const connection = useAppStore(state => state.connection);
  const hasCurrent = useAppStore(state => state.current !== null);
  const init = useAppStore(state => state.init);
  const reconnect = useAppStore(state => state.reconnect);

  const insets = useSafeAreaInsets();
  const backgroundSince = React.useRef<number | null>(null);

  React.useEffect(() => {
    void init();
  }, [init]);

  // Artist/album pages belong to the tab they were opened from: switching
  // tab (from the bar or from code, e.g. "Rechercher « artiste »") clears them.
  React.useEffect(() => {
    closeAllPages();
  }, [tab, closeAllPages]);

  // Tapping a tab, even the current one, goes back to its root.
  const changeTab = React.useCallback(
    (next: typeof tab) => {
      closeAllPages();
      setTab(next);
    },
    [closeAllPages, setTab],
  );

  // Android back: close the sheet, then the player, then the top page, then
  // leave Réglages.
  React.useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const state = useAppStore.getState();

      if (state.sheet) {
        state.closeSheet();
        return true;
      }
      if (state.playerOpen) {
        state.closePlayer();
        return true;
      }
      if (state.closePage()) {
        return true;
      }
      if (state.tab === 'settings') {
        state.setTab('home');
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        backgroundSince.current ??= Date.now();
        return;
      }

      const away = backgroundSince.current ? Date.now() - backgroundSince.current : 0;
      backgroundSince.current = null;

      if (
        username &&
        (connection === 'disconnected' || connection === 'error' || connection === 'reconnecting')
      ) {
        void reconnect();
      } else if (username && connection === 'online' && away > CHECK_AFTER_BACKGROUND_MS) {
        // The phone may have slept: make sure "online" is still true.
        void useAppStore.getState().checkConnection();
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
    <View style={styles.root}>
      <View style={[styles.main, { paddingTop: insets.top }]}>
        <Banners />
        <View style={styles.content}>
          {tab === 'home' ? (
            <HomeScreen />
          ) : tab === 'search' ? (
            <SearchScreen />
          ) : tab === 'library' ? (
            <LibraryScreen />
          ) : (
            <>
              <View style={styles.settingsBar}>
                <IconButton icon="left" accessibilityLabel="Retour" onPress={() => setTab('home')} />
                <Text style={styles.settingsTitle} accessibilityRole="header">
                  Réglages
                </Text>
              </View>
              <SettingsScreen />
            </>
          )}
          <PageHost />
        </View>

        <View style={styles.dock}>
          <LinearGradient colors={DOCK_FADE} style={styles.dockFade} pointerEvents="none" />
          {hasCurrent ? <MiniPlayer /> : null}
          <TabBar active={tab} onChange={changeTab} bottomInset={insets.bottom} />
        </View>
      </View>

      <PlayerSheet />
      <SheetHost />
    </View>
  );
}

const DOCK_FADE = ['rgba(11,10,15,0)', colors.bg];
const NOTICE_MS = 4000;

/** Connection state and network notices, shown above the current screen. */
function Banners() {
  const connection = useAppStore(state => state.connection);
  const connectionError = useAppStore(state => state.connectionError);
  const notice = useAppStore(state => state.notice);
  const dismissNotice = useAppStore(state => state.dismissNotice);
  const reconnect = useAppStore(state => state.reconnect);

  // Notices ("Sera lu ensuite", "Fin de la liste"…) go away on their own.
  React.useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(dismissNotice, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

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
      <AppLogo size={92} />
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
  main: {
    flex: 1,
  },
  settingsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  settingsTitle: {
    ...type.heading,
    color: colors.text,
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
