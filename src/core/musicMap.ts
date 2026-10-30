import type { CatalogProvider } from './catalog';
import type { CatalogArtist } from './catalogTypes';

/**
 * Music Map: a small graph of an artist and the artists the catalog relates
 * to them. It is built on demand (one request per expanded artist), bounded
 * so a tap cannot fan out into dozens of Deezer calls.
 */
export interface MusicMapNode {
  artist: CatalogArtist;
  parentId: string | null;
  /** 0 for the root, 1 for its related artists, 2 for the next ring. */
  depth: number;
}

export interface MusicMapEdge {
  from: string;
  to: string;
}

export interface MusicMap {
  root: CatalogArtist;
  nodes: MusicMapNode[];
  edges: MusicMapEdge[];
  /** Some related artists were left out to keep the map small. */
  truncated: boolean;
}

export interface MusicMapOptions {
  /** Root included. Default 12. */
  maxArtists?: number;
  /** First-ring artists whose own relations are fetched. Default 4. */
  expand?: number;
}

type RelatedSource = Pick<CatalogProvider, 'artistWithRelated'>;

export async function buildMusicMap(
  seed: { id: string; name?: string },
  provider: RelatedSource,
  options: MusicMapOptions = {},
): Promise<MusicMap> {
  const maxArtists = Math.max(1, options.maxArtists ?? 12);
  const expand = Math.max(0, options.expand ?? 4);

  // The root failure is the screen's error state; partial rings are optional.
  const rootSummary = await provider.artistWithRelated(seed.id);
  const root = rootSummary.artist.id ? rootSummary.artist : { ...rootSummary.artist, id: seed.id };
  const nodes: MusicMapNode[] = [{ artist: root, parentId: null, depth: 0 }];
  const edges: MusicMapEdge[] = [];
  const seen = new Set([root.id]);
  let truncated = false;

  const firstRing: MusicMapNode[] = [];
  for (const related of uniqueArtists(rootSummary.related, seen)) {
    if (nodes.length >= maxArtists) {
      truncated = true;
      break;
    }
    seen.add(related.id);
    const node: MusicMapNode = { artist: related, parentId: root.id, depth: 1 };
    nodes.push(node);
    firstRing.push(node);
    edges.push({ from: root.id, to: related.id });
  }

  for (let index = 0; index < firstRing.length && index < expand; index++) {
    if (nodes.length >= maxArtists) {
      // Another ring or more related artists exist but do not fit.
      truncated = true;
      break;
    }

    const parent = firstRing[index];
    let summary: Awaited<ReturnType<RelatedSource['artistWithRelated']>>;
    try {
      summary = await provider.artistWithRelated(parent.artist.id);
    } catch {
      // One missing relation must not empty the whole map.
      continue;
    }

    for (const related of uniqueArtists(summary.related, seen)) {
      if (nodes.length >= maxArtists) {
        truncated = true;
        break;
      }
      seen.add(related.id);
      nodes.push({ artist: related, parentId: parent.artist.id, depth: 2 });
      edges.push({ from: parent.artist.id, to: related.id });
    }
  }

  return { root, nodes, edges, truncated };
}

function uniqueArtists(artists: CatalogArtist[], seen: Set<string>): CatalogArtist[] {
  const kept: CatalogArtist[] = [];
  for (const artist of artists) {
    if (artist.id && !seen.has(artist.id)) {
      seen.add(artist.id);
      kept.push(artist);
    }
  }
  return kept;
}
