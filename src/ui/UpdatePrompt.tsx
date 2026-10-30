import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { useUpdateStore } from '../state/updateStore';
import { Button, ProgressBar } from './components';
import { colors, radius, spacing, type } from './theme';

/**
 * A single clear prompt when a newer build is on the VPS. It never installs by
 * itself: the user downloads, then Android's package installer asks for the
 * final confirmation.
 */
export function UpdatePrompt() {
  const status = useUpdateStore(state => state.status);
  const manifest = useUpdateStore(state => state.manifest);
  const progress = useUpdateStore(state => state.progress);
  const error = useUpdateStore(state => state.error);
  const download = useUpdateStore(state => state.download);
  const cancel = useUpdateStore(state => state.cancel);
  const install = useUpdateStore(state => state.install);
  const dismiss = useUpdateStore(state => state.dismiss);

  if (!manifest || status === 'idle' || status === 'checking') {
    return null;
  }

  const downloading = status === 'downloading';
  const installing = status === 'installing';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void dismiss()}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            Mise à jour disponible
          </Text>
          <Text style={styles.version}>Version {manifest.versionName}</Text>
          {manifest.notes ? <Text style={styles.notes}>{manifest.notes}</Text> : null}

          {downloading ? (
            <>
              <ProgressBar value={progress} height={6} tone="accent" style={styles.progress} />
              <Text style={styles.progressLabel}>{`${Math.round(progress * 100)} %`}</Text>
              <Button
                label="Annuler le téléchargement"
                variant="ghost"
                onPress={cancel}
                style={styles.action}
              />
            </>
          ) : status === 'ready' ? (
            <Button label="Installer" onPress={() => void install()} style={styles.action} />
          ) : installing ? (
            <Button label="Ouverture de l’installateur…" loading onPress={() => {}} style={styles.action} />
          ) : status === 'error' ? (
            <>
              <Text style={styles.error}>{error}</Text>
              <Button label="Réessayer" onPress={() => void download()} style={styles.action} />
            </>
          ) : (
            <Button label="Télécharger" onPress={() => void download()} style={styles.action} />
          )}

          <Button label="Plus tard" variant="ghost" onPress={() => void dismiss()} style={styles.later} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.overlay,
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    ...type.heading,
    color: colors.text,
  },
  version: {
    ...type.title,
    color: colors.accent,
  },
  notes: {
    ...type.bodySm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  progress: {
    marginTop: spacing.sm,
  },
  progressLabel: {
    ...type.mono,
    color: colors.textMuted,
    textAlign: 'right',
  },
  action: {
    marginTop: spacing.md,
  },
  later: {
    marginTop: spacing.xs,
  },
  error: {
    ...type.bodySm,
    color: colors.danger,
    marginTop: spacing.sm,
  },
});
