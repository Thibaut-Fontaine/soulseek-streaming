import { parseShareLink, shareMessage } from '../src/core/share';

describe('shared track links', () => {
  test('a catalog track round-trips through the message', () => {
    const message = shareMessage({ title: 'One More Time', artist: 'Daft Punk', catalogId: 'dz:3135553' });
    expect(message).toContain('« One More Time » — Daft Punk');
    expect(message).toContain('soulstream://track/dz:3135553?q=Daft%20Punk%20One%20More%20Time');
    expect(message).toContain('https://www.deezer.com/track/3135553');
    expect(parseShareLink(message)).toEqual({ kind: 'track', id: 'dz:3135553', query: 'Daft Punk One More Time' });
  });

  test('a file no catalog track matched is shared as a search', () => {
    const message = shareMessage({ title: 'Live 1997 (bootleg)', artist: null });
    expect(message).not.toContain('deezer');
    expect(parseShareLink(message)).toEqual({ kind: 'search', query: 'Live 1997 (bootleg)' });
  });

  test('a message shared to the app arrives wrapped by MainActivity', () => {
    const message = shareMessage({ title: 'Get Lucky', artist: 'Daft Punk', catalogId: 'dz:67238735' });
    const wrapped = `soulstream://shared?text=${encodeURIComponent(message)}`;
    expect(parseShareLink(wrapped)).toEqual({ kind: 'track', id: 'dz:67238735', query: 'Daft Punk Get Lucky' });
  });

  test('Deezer links work too, with or without a language', () => {
    expect(parseShareLink('https://www.deezer.com/fr/track/3135553?utm=x')).toEqual({ kind: 'track', id: 'dz:3135553' });
    expect(parseShareLink('écoute ça https://deezer.com/track/42')).toEqual({ kind: 'track', id: 'dz:42' });
    expect(parseShareLink('soulstream://track/42')).toEqual({ kind: 'track', id: 'dz:42' });
  });

  test('anything else is not a track', () => {
    expect(parseShareLink('https://www.deezer.com/album/302127')).toBeNull();
    expect(parseShareLink('soulstream://search?q=')).toBeNull();
    expect(parseShareLink('soulstream://shared?text=%E0%A4%A')).toBeNull();
    expect(parseShareLink('hello')).toBeNull();
  });
});
