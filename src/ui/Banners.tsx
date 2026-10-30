import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppStore } from '../state/store';
import { messages } from '../strings';
import { Toast } from './components';
import { gutter, spacing } from './theme';

const NOTICE_MS = 4000;

/** Connection state and network notices, shown above the current screen. */
export function Banners() {
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
              ? messages.bannerReconnecting
              : messages.bannerConnecting
          }
        />
      ) : null}
      {offline ? (
        <Toast
          key="offline"
          tone="bad"
          icon="offline"
          message={connectionError ?? messages.bannerOffline}
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

const styles = StyleSheet.create({
  banners: {
    paddingTop: spacing.sm,
    paddingHorizontal: gutter,
    gap: spacing.sm,
  },
});
