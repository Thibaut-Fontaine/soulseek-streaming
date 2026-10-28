import React from 'react';
import { ActivityIndicator, AppState, BackHandler, StatusBar, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { debugLog } from './src/services/debugLog';
import { useAppStore } from './src/state/store';
import { IconButton } from './src/ui/components';
import { Banners } from './src/ui/Banners';
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
import { colors, spacing, type } from './src/ui/theme';

/** A JS-thread gap longer than this is written to the journal. */
const STALL_LOG_MS = 1000;
const STALL_TICK_MS = 250;

/**
 * Journal lines to tell a dead UI apart (taps that do nothing): a tap that
 * reaches JS is logged, and so is any long stall of the JS thread. No tap
 * logged means something native caught it or JS was busy.
 */
function logTouch(event: { nativeEvent: { pageX: number; pageY: number } }): boolean {
  debugLog('app', `toucher ${Math.round(event.nativeEvent.pageX)},${Math.round(event.nativeEvent.pageY)}`);
  return false;
}

function useStallWatchdog(): void {
  React.useEffect(() => {
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const gap = now - last - STALL_TICK_MS;
      last = now;
      // A gap while in the background is the OS pausing timers, not a stall.
      if (gap > STALL_LOG_MS && AppState.currentState === 'active') {
        debugLog('app', `fil JS bloqué ${gap} ms`);
      }
    }, STALL_TICK_MS);
    return () => clearInterval(timer);
  }, []);
}

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
  useStallWatchdog();
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
    <View style={styles.root} onStartShouldSetResponderCapture={logTouch}>
      <View style={styles.main}>
        <View style={styles.content}>
          {/* Tabs stay below the status bar; pages (PageHost) fill up to the
              top edge of the screen, like the full player. */}
          <View style={[styles.content, { paddingTop: insets.top }]}>
            <Banners />
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
          </View>
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
