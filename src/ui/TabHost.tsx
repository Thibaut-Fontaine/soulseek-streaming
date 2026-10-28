import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Tab } from '../state/store';
import { Banners } from './Banners';
import { HomeScreen } from './HomeScreen';
import { LibraryScreen } from './LibraryScreen';
import { SearchScreen } from './SearchScreen';

type KeptTab = 'home' | 'search' | 'library';

/** Bumped when the user taps the tab already shown: rebuilds it at its root. */
export type TabResets = Record<KeptTab, number>;

const KEPT_TABS: KeptTab[] = ['home', 'search', 'library'];

/**
 * Accueil, Rechercher and Bibliothèque stay mounted once visited, hidden when
 * another tab shows: coming back is instant and keeps the scroll position,
 * instead of rebuilding a screen full of covers (slow on low-end phones).
 * Réglages is rarely opened and stays outside (built on each visit).
 */
export function TabHost({ tab, resets }: { tab: Tab; resets: TabResets }) {
  const insets = useSafeAreaInsets();
  const visited = React.useRef(new Set<KeptTab>());

  if (tab !== 'settings') {
    visited.current.add(tab);
  }

  return (
    <>
      {KEPT_TABS.filter(id => visited.current.has(id)).map(id => {
        const active = id === tab;
        return (
          <View
            key={`${id}:${resets[id]}`}
            testID={`tab-${id}`}
            style={[styles.tab, !active && styles.hidden]}
            pointerEvents={active ? 'auto' : 'none'}
            importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
            {id === 'home' ? (
              <>
                <HomeScreen />
                {active ? (
                  <View style={[styles.overlayBanners, { top: insets.top }]} pointerEvents="box-none">
                    <Banners />
                  </View>
                ) : null}
              </>
            ) : id === 'search' ? (
              <SearchScreen />
            ) : (
              <LibraryScreen />
            )}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  tab: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  overlayBanners: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
