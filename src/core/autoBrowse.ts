import type { CatalogTrack } from './catalogTypes';
import { trackArtists } from './catalog';
import type { Library, SavedTrack } from '../services/library';
import { displayArtist, displayTitle, hitKey } from './types';
import type { SearchHit } from './types';

/**
 * Browse tree shown in Android Auto (feature 8).
 *
 * Android Auto only sees a MediaBrowserService. Building the tree here keeps
 * the user-visible ordering and labels testable in Node; the native service
 * only turns this snapshot into MediaItems and sends commands back.
 */

export interface AutoMediaItem {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  artworkUri?: string;
}

export interface AutoFolder {
  id: string;
  title: string;
  folder: true;
  children: AutoBrowseNode[];
}

export interface AutoTrackNode extends AutoMediaItem {
  folder?: false;
}

export type AutoBrowseNode = AutoFolder | AutoTrackNode;

export interface AutoBrowseInput {
  library: Library;
  device: SearchHit[];
  /** Catalog tracks matched to a file, keyed by `hitKey`. */
  hitTracks?: Record<string, CatalogTrack>;
  /** Per-folder cap; the whole snapshot must stay small for a binder. */
  maxItems?: number;
}

export const AUTO_ROOT_ID = 'root';
export const AUTO_LIBRARY_ID = 'library';
export const AUTO_LIKED_ID = 'liked';
export const AUTO_HISTORY_ID = 'history';
export const AUTO_DEVICE_ID = 'device';
export const AUTO_CACHE_ID = 'cache';

const DEFAULT_MAX_ITEMS = 200;

export function buildAutoBrowseTree(input: AutoBrowseInput): AutoFolder {
  const maxItems = Math.max(1, input.maxItems ?? DEFAULT_MAX_ITEMS);
  const liked = input.library.liked.slice(0, maxItems).map(savedNode('liked'));
  const history = input.library.history.slice(0, maxItems).map(savedNode('history'));
  const device = input.device.slice(0, maxItems).map(hitNode(input.hitTracks ?? {}));

  return {
    id: AUTO_ROOT_ID,
    title: 'SoulStream',
    folder: true,
    children: [
      {
        id: AUTO_LIBRARY_ID,
        title: 'Bibliothèque',
        folder: true,
        children: [
          { id: AUTO_LIKED_ID, title: 'Titres likés', folder: true, children: liked },
          { id: AUTO_HISTORY_ID, title: 'Écoutés récemment', folder: true, children: history },
        ],
      },
      { id: AUTO_DEVICE_ID, title: 'Sur l’appareil', folder: true, children: device },
      // Downloads are the same local files today; keeping a separate folder
      // matches the library/device/cache contract and leaves room for a cache
      // list later.
      { id: AUTO_CACHE_ID, title: 'Téléchargés', folder: true, children: device },
    ],
  };
}

export function savedAutoId(prefix: 'liked' | 'history', key: string): string {
  return `${prefix}:${key}`;
}

export function deviceAutoId(hit: { username: string; filename: string }): string {
  return `${AUTO_DEVICE_ID}:${hit.username}:${hit.filename}`;
}

function savedNode(prefix: 'liked' | 'history') {
  return (saved: SavedTrack): AutoTrackNode => {
    const catalog = saved.catalog;
    return {
      id: savedAutoId(prefix, saved.key),
      title: catalog?.title ?? saved.title,
      artist: catalog ? trackArtists(catalog) : saved.artist ?? undefined,
      album: catalog?.album?.title,
      durationSec: saved.hit.durationSec,
      artworkUri: artworkOf(catalog),
    };
  };
}

function hitNode(hitTracks: Record<string, CatalogTrack>) {
  return (hit: SearchHit): AutoTrackNode => {
    const catalog = hitTracks[hitKey(hit)];
    return {
      id: deviceAutoId(hit),
      title: catalog?.title ?? displayTitle(hit.filename),
      artist: catalog ? trackArtists(catalog) : displayArtist(hit) ?? undefined,
      album: catalog?.album?.title,
      durationSec: hit.durationSec,
      artworkUri: artworkOf(catalog),
    };
  };
}

function artworkOf(track: CatalogTrack | undefined): string | undefined {
  const cover = track?.album?.cover;
  return cover?.big ?? cover?.large ?? cover?.medium ?? cover?.small ?? undefined;
}

/** Finds a node by id in a snapshot, depth first. */
export function findAutoNode(root: AutoFolder, id: string): AutoBrowseNode | null {
  const stack: AutoBrowseNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === id) {
      return node;
    }
    if (node.folder) {
      stack.push(...node.children);
    }
  }
  return null;
}
