import type { CatalogProvider } from '../src/core/catalog';
import type { CatalogArtist, CatalogTrack } from '../src/core/catalogTypes';
import { recommendTracks, recommendationKey } from '../src/core/autoplay';

const ART = { small: 's.jpg', medium: 'm.jpg', large: 'l.jpg' };

function artist(id: string, name: string): CatalogArtist {
  return { id, name, picture: ART };
}

const DAFT = artist('dz:27', 'Daft Punk');
const JUSTICE = artist('dz:1424', 'Justice');
const CASSIUS = artist('dz:1563', 'Cassius');

const ARTIST_IDS: Record<string, string> = {
  'Daft Punk': DAFT.id,
  Justice: JUSTICE.id,
  Cassius: CASSIUS.id,
};

function track(id: string, title: string, artistName = 'Daft Punk'): CatalogTrack {
  return {
    id,
    title,
    titleShort: title,
    version: '',
    artist: { id: ARTIST_IDS[artistName] ?? `dz:artist-${artistName}`, name: artistName },
    contributors: [],
    album: null,
    durationSec: 200,
    explicit: false,
  };
}

const SEED = track('dz:1', 'One More Time');
const RADIO_A = track('dz:2', 'Digital Love');
const RADIO_B = track('dz:3', 'Aerodynamic');
const RELATED_A = track('dz:4', 'D.A.N.C.E.', 'Justice');
const RELATED_B = track('dz:5', 'Genesis', 'Justice');
const RELATED_C = track('dz:6', 'Toop Toop', 'Cassius');

function provider(options: {
  radio?: Record<string, CatalogTrack[] | Error>;
  related?: Record<string, CatalogArtist[] | Error>;
} = {}): Pick<CatalogProvider, 'artistRadio' | 'artistWithRelated'> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    artistRadio: async id => {
      calls.push(`radio:${id}`);
      const answer = options.radio?.[id];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer ?? [];
    },
    artistWithRelated: async id => {
      calls.push(`related:${id}`);
      const answer = options.related?.[id];
      if (answer instanceof Error) {
        throw answer;
      }
      return { artist: artist(id, id), related: answer ?? [] };
    },
  };
}

describe('autoplay recommendations', () => {
  test('uses the artist radio first and never repeats the seed or excluded tracks', async () => {
    const fake = provider({
      radio: { [DAFT.id]: [SEED, RADIO_A, RADIO_A, RADIO_B] },
    });
    const result = await recommendTracks(fake, SEED, new Set([recommendationKey(SEED)]), { limit: 2 });

    expect(result.reason).toBe('ok');
    expect(result.tracks.map(item => item.id)).toEqual([RADIO_A.id, RADIO_B.id]);
    expect(fake.calls).toEqual([`radio:${SEED.artist.id}`]);
  });

  test('falls back to similar artists when the radio is empty, stopping at the limit', async () => {
    const fake = provider({
      radio: {
        [DAFT.id]: [],
        [JUSTICE.id]: [RELATED_A, RELATED_B],
        [CASSIUS.id]: [RELATED_C],
      },
      related: { [DAFT.id]: [JUSTICE, CASSIUS] },
    });
    const result = await recommendTracks(fake, SEED, new Set(), { limit: 2, maxRelatedArtists: 5 });

    expect(result.tracks.map(item => item.id)).toEqual([RELATED_A.id, RELATED_B.id]);
    // Once the limit is reached, no more related artists are queried.
    expect(fake.calls).toEqual([
      `radio:${SEED.artist.id}`,
      `related:${SEED.artist.id}`,
      `radio:${JUSTICE.id}`,
    ]);
  });

  test('returns empty when everything is a repeat', async () => {
    const fake = provider({
      radio: { [DAFT.id]: [SEED, RADIO_A] },
      related: { [DAFT.id]: [JUSTICE] },
    });
    const excluded = new Set([recommendationKey(SEED), recommendationKey(RADIO_A)]);
    const result = await recommendTracks(fake, SEED, excluded);
    expect(result).toEqual({ tracks: [], reason: 'empty' });
  });

  test('a radio failure falls back, total failure stops cleanly', async () => {
    const fallback = provider({
      radio: { [DAFT.id]: new Error('http 503'), [JUSTICE.id]: [RELATED_A] },
      related: { [DAFT.id]: [JUSTICE] },
    });
    const result = await recommendTracks(fallback, SEED, new Set());
    expect(result.tracks.map(item => item.id)).toEqual([RELATED_A.id]);
    expect(result.reason).toBe('ok');

    const broken = provider({
      radio: { [DAFT.id]: new Error('offline') },
      related: { [DAFT.id]: new Error('offline') },
    });
    expect(await recommendTracks(broken, SEED, new Set())).toEqual({ tracks: [], reason: 'error' });
  });

  test('deduplicates the same recording from two related artists', async () => {
    const same = track('dz:7', 'One More Time', 'Justice');
    const fake = provider({
      radio: { [DAFT.id]: [], [JUSTICE.id]: [same, { ...same, id: 'dz:8' }] },
      related: { [DAFT.id]: [JUSTICE] },
    });
    const result = await recommendTracks(fake, SEED, new Set());
    expect(result.tracks).toHaveLength(1);
  });

  test('honours maxRelatedArtists when everything is empty', async () => {
    const fake = provider({
      radio: { [DAFT.id]: [] },
      related: { [DAFT.id]: [JUSTICE, CASSIUS, artist('dz:9', 'Moderat')] },
    });
    expect(await recommendTracks(fake, SEED, new Set(), { maxRelatedArtists: 2 })).toEqual({
      tracks: [],
      reason: 'empty',
    });
    expect(fake.calls.filter(call => call.startsWith('related:'))).toHaveLength(1);
    expect(fake.calls.filter(call => call.startsWith('radio:'))).toHaveLength(3);
  });
});
