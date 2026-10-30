import { buildAutoBrowseTree, findAutoNode } from '../src/core/autoBrowse';
import { hitKey } from '../src/core/types';
import { EMPTY_LIBRARY, savedTrack } from '../src/services/library';
import {
  BOOTLEG_FILE,
  OMT_FILE_A,
  ONE_MORE_TIME,
  soulseekHit,
} from '../test-utils/catalogFixtures';

describe('Android Auto browse tree', () => {
  const liked = savedTrack(OMT_FILE_A, undefined, ONE_MORE_TIME);
  const history = savedTrack(
    soulseekHit('Music\\Daft Punk\\Discovery\\02 - Aerodynamic.mp3'),
    { title: 'Aerodynamic', artist: 'Daft Punk' },
    null,
  );
  const device = [OMT_FILE_A, BOOTLEG_FILE];

  test('exposes the library, device and cache folders', () => {
    const tree = buildAutoBrowseTree({
      library: { ...EMPTY_LIBRARY, liked: [liked], history: [history] },
      device,
      hitTracks: { [hitKey(OMT_FILE_A)]: ONE_MORE_TIME },
    });

    expect(tree.id).toBe('root');
    expect(tree.title).toBe('SoulStream');
    expect(tree.children.map(node => node.title)).toEqual([
      'Bibliothèque',
      'Sur l’appareil',
      'Téléchargés',
    ]);

    const library = findAutoNode(tree, 'library');
    expect(library?.folder).toBe(true);
    if (!library || !library.folder) {
      throw new Error('library folder missing');
    }
    expect(library.children.map(node => node.title)).toEqual(['Titres likés', 'Écoutés récemment']);

    const likedNode = findAutoNode(tree, `liked:${liked.key}`);
    expect(likedNode).toMatchObject({
      title: 'One More Time',
      artist: 'Daft Punk',
      album: 'Discovery',
      durationSec: 320,
    });
    expect(!likedNode?.folder && likedNode?.artworkUri).toContain('500x500');

    const historyNode = findAutoNode(tree, `history:${history.key}`);
    expect(historyNode).toMatchObject({ title: 'Aerodynamic', artist: 'Daft Punk' });

    const deviceNode = findAutoNode(tree, `device:${OMT_FILE_A.username}:${OMT_FILE_A.filename}`);
    expect(deviceNode).toMatchObject({ title: 'One More Time', artist: 'Daft Punk' });

    // A file with no catalog match falls back to its path.
    const bootleg = findAutoNode(tree, `device:${BOOTLEG_FILE.username}:${BOOTLEG_FILE.filename}`);
    expect(bootleg?.title).toContain('bootleg');
    expect(bootleg?.folder).toBeFalsy();
  });

  test('caps each folder for a small binder payload', () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      savedTrack(soulseekHit(`Music\\Artist\\Album\\0${index} - Song.mp3`), undefined, ONE_MORE_TIME),
    );
    const tree = buildAutoBrowseTree({
      library: { ...EMPTY_LIBRARY, liked: many },
      device: [],
      maxItems: 2,
    });
    const likedFolder = findAutoNode(tree, 'liked');
    expect(likedFolder?.folder && likedFolder.children).toHaveLength(2);
  });

  test('empty sections stay browsable', () => {
    const tree = buildAutoBrowseTree({ library: EMPTY_LIBRARY, device: [] });
    expect(tree.children).toHaveLength(3);
    for (const folder of tree.children) {
      expect(folder.folder).toBe(true);
      if (folder.folder) {
        expect(Array.isArray(folder.children)).toBe(true);
      }
    }
    expect(findAutoNode(tree, 'missing')).toBeNull();
  });
});
