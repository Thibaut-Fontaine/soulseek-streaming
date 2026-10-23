import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tab } from '../state/store';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { colors, spacing } from './theme';

// TODO(phase-3): Accueil / Rechercher / Bibliothèque, with Réglages behind
// the avatar (DESIGN.md §5).
const TABS: Array<{ id: Tab; icon: IconName; label: string; fillable: boolean }> = [
  { id: 'search', icon: 'search', label: 'Rechercher', fillable: false },
  { id: 'player', icon: 'play', label: 'Lecture', fillable: true },
  { id: 'settings', icon: 'gear', label: 'Réglages', fillable: false },
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
    <View
      accessibilityRole="tablist"
      style={[styles.wrap, { paddingBottom: Math.max(bottomInset, spacing.sm) }]}>
      {TABS.map(tab => {
        const selected = active === tab.id;
        const color = selected ? colors.text : colors.textDim;

        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
            <Icon
              name={tab.icon}
              size={26}
              color={color}
              filled={selected && tab.fillable}
              strokeWidth={selected ? 2.8 : 2}
            />
            <Text style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: spacing.sm,
  },
  tab: {
    width: 96,
    alignItems: 'center',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.text,
  },
});
