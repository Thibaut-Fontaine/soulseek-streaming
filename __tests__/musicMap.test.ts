import type { CatalogProvider } from '../src/core/catalog';
import type { CatalogArtist, CatalogTrack } from '../src/core/catalogTypes';
import { buildMusicMap } from '../src/core/musicMap';

const ART = { small: 's.jpg', medium: 'm.jpg', large: 'l.jpg' };

function artist(id: string, name: string): CatalogArtist {
  return { id, name, picture: ART };
}

export function track(id: string, title: string, artistName = 'X'): CatalogTrack {
  return {
    id,
    title,
    titleShort: title,
    version: '',
    artist: { id: `artist-${artistName}`, name: artistName },
    contributors: [],
    album: null,
    durationSec: 200,
    explicit: false,
  };
}

const DAFT = artist('dz:27', 'Daft Punk');
const JUSTICE = artist('dz:1424', 'Justice');
const CASSIUS = artist('dz:1563', 'Cassius');
const MODERAT = artist('dz:9', 'Moderat');
const SEBASTIAN = artist('dz:10', 'SebastiAn');
const BOYS_NOIZE = artist('dz:11', 'Boys Noize');

function provider(
  graph: Record<string, { artist: CatalogArtist; related: CatalogArtist[] }>,
  calls: string[] = [],
): Pick<CatalogProvider, 'artistWithRelated'> {
  return {
    artistWithRelated: async id => {
      calls.push(id);
      const entry = graph[id];
      if (!entry) {
        throw new Error(`unknown artist ${id}`);
      }
      return entry;
    },
  };
}

const GRAPH = {
  [DAFT.id]: { artist: DAFT, related: [JUSTICE, CASSIUS, MODERAT] },
  [JUSTICE.id]: { artist: JUSTICE, related: [DAFT, SEBASTIAN] },
  [CASSIUS.id]: { artist: CASSIUS, related: [BOYS_NOIZE] },
  [MODERAT.id]: { artist: MODERAT, related: [] },
};

describe('music map graph', () => {
  test('builds root, related artists and a bounded second ring', async () => {
    const calls: string[] = [];
    const map = await buildMusicMap({ id: DAFT.id, name: DAFT.name }, provider(GRAPH, calls), {
      maxArtists: 5,
      expand: 2,
    });

    expect(map.root.name).toBe('Daft Punk');
    expect(map.nodes.map(node => node.artist.name)).toEqual([
      'Daft Punk',
      'Justice',
      'Cassius',
      'Moderat',
      'SebastiAn',
    ]);
    expect(map.nodes.map(node => node.depth)).toEqual([0, 1, 1, 1, 2]);
    expect(map.edges).toEqual(
      expect.arrayContaining([
        { from: DAFT.id, to: JUSTICE.id },
        { from: DAFT.id, to: CASSIUS.id },
        { from: DAFT.id, to: MODERAT.id },
        { from: JUSTICE.id, to: SEBASTIAN.id },
      ]),
    );
    // The root, then only the first expansion that still fits.
    expect(calls).toEqual([DAFT.id, JUSTICE.id]);
    expect(map.truncated).toBe(true);
  });

  test('an artist with no related data is a one-node map', async () => {
    const map = await buildMusicMap({ id: DAFT.id, name: DAFT.name }, provider({
      [DAFT.id]: { artist: DAFT, related: [] },
    }), { maxArtists: 10 });
    expect(map.nodes.map(node => node.artist.id)).toEqual([DAFT.id]);
    expect(map.edges).toEqual([]);
    expect(map.truncated).toBe(false);
  });

  test('drops the root and duplicate names from the rings', async () => {
    const map = await buildMusicMap({ id: DAFT.id, name: DAFT.name }, provider({
      [DAFT.id]: { artist: DAFT, related: [DAFT, JUSTICE, JUSTICE] },
      [JUSTICE.id]: { artist: JUSTICE, related: [DAFT, CASSIUS] },
    }), { maxArtists: 10, expand: 1 });

    expect(map.nodes.map(node => node.artist.id)).toEqual([DAFT.id, JUSTICE.id, CASSIUS.id]);
    expect(map.edges).toEqual([
      { from: DAFT.id, to: JUSTICE.id },
      { from: JUSTICE.id, to: CASSIUS.id },
    ]);
  });

  test('a failing second-ring request keeps the partial map; a failing root rejects', async () => {
    const partialProvider: Pick<CatalogProvider, 'artistWithRelated'> = {
      artistWithRelated: async id => {
        if (id === JUSTICE.id) {
          throw new Error('related unavailable');
        }
        return { artist: DAFT, related: [JUSTICE] };
      },
    };
    const partial = await buildMusicMap({ id: DAFT.id, name: DAFT.name }, partialProvider, {
      maxArtists: 10,
      expand: 1,
    });
    expect(partial.nodes.map(node => node.artist.name)).toEqual(['Daft Punk', 'Justice']);

    const broken: Pick<CatalogProvider, 'artistWithRelated'> = {
      artistWithRelated: async () => {
        throw new Error('offline');
      },
    };
    await expect(buildMusicMap({ id: DAFT.id, name: DAFT.name }, broken)).rejects.toThrow('offline');
  });

  test('maxArtists 1 stops after the root', async () => {
    const calls: string[] = [];
    const map = await buildMusicMap({ id: DAFT.id, name: DAFT.name }, provider(GRAPH, calls), {
      maxArtists: 1,
    });
    expect(map.nodes).toHaveLength(1);
    expect(calls).toEqual([DAFT.id]);
  });
});

// The helper is shared with the autoplay tests.
export { artist, GRAPH };
