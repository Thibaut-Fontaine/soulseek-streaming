import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { debugLog } from '../services/debugLog';
import { StatusCard } from './components';
import { colors, gutter, spacing, type } from './theme';

interface State {
  error: Error | null;
}

/**
 * Last-resort UI boundary. Without it a render error in release mode leaves a
 * completely blank screen; here the user can recover without restarting.
 */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Release builds drop console output: keep it in the journal.
    debugLog('app', `erreur d’affichage : ${error.name}: ${error.message}${info.componentStack ?? ''}`);
    if (__DEV__) {
      console.error('[SoulStream] UI error', error, info.componentStack);
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <StatusCard
            tone="bad"
            title="L’interface a rencontré une erreur"
            body="Vous pouvez réessayer sans perdre la connexion au réseau, ou relancer l’application si le problème persiste."
            actions={[{ label: 'Réessayer', icon: 'refresh', variant: 'accent', onPress: this.reset }]}>
            {this.state.error.message ? (
              <Text style={styles.detail} selectable>
                {this.state.error.message}
              </Text>
            ) : null}
          </StatusCard>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: gutter,
    gap: spacing.md,
  },
  detail: {
    ...type.caption,
    color: colors.textDim,
  },
});
