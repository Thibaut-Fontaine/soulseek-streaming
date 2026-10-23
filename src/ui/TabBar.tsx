import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tab } from '../state/store';
import { colors, spacing } from './theme';

const TABS: Array<{ id: Tab; glyph: string; label: string }> = [
  { id: 'search', glyph: '⌕', label: 'Recherche' },
  { id: 'player', glyph: '♫', label: 'Lecture' },
  { id: 'settings', glyph: '⚙', label: 'Réglages' },
];

export function TabBar({
  active,
  onChange,
  bottomInset,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  bottomInset: number;
}) {
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(bottomInset, 8) }]}>
      {TABS.map(tab => {
        const selected = active === tab.id;

        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.75 }]}>
            <Text style={[styles.glyph, selected && styles.glyphActive]}>{tab.glyph}</Text>
            <Text style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
            <View style={[styles.indicator, selected && styles.indicatorActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.bgSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingHorizontal: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    gap: 3,
  },
  glyph: {
    color: colors.textDim,
    fontSize: 22,
    lineHeight: 25,
  },
  glyphActive: {
    color: colors.accentBright,
  },
  label: {
    color: colors.textDim,
    fontSize: 10.5,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.text,
  },
  indicator: {
    width: 16,
    height: 2,
    borderRadius: 1,
    marginTop: 1,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: colors.accentBright,
  },
});
