import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from './theme';

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
    if (__DEV__) {
      console.error('[SoulStream] UI error', error, info.componentStack);
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.glyph}>!</Text>
          <Text style={styles.title}>L’interface a rencontré une erreur</Text>
          <Text style={styles.body}>
            Vous pouvez réessayer sans perdre la connexion au réseau, ou relancer
            l’application si le problème persiste.
          </Text>
          {this.state.error.message ? (
            <Text style={styles.detail}>{this.state.error.message}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => this.setState({ error: null })}
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
            <Text style={styles.buttonText}>Réessayer</Text>
          </Pressable>
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  glyph: {
    color: colors.accentBright,
    fontSize: 52,
    fontWeight: '800',
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 340,
  },
  detail: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: spacing.lg,
    maxWidth: 340,
  },
  button: {
    marginTop: spacing.xl,
    minWidth: 180,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
