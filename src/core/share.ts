/**
 * Links to send a track to someone who has SoulStream.
 *
 * A catalog track is shared by its catalog id, with a search query as a
 * fallback (the receiver may have the catalog off); a file no catalog track
 * matched is shared as a search. The message also carries the Deezer page of
 * the track: messengers make it tappable, which they don't do for
 * `soulstream://` links, and the app reads it too.
 *
 * Android hands a link to the app in two ways: tapping it (`soulstream://`,
 * or a Deezer link when the user allowed SoulStream to open them), or sharing
 * the message to SoulStream, which MainActivity turns into
 * `soulstream://shared?text=…`.
 */

export const SHARE_SCHEME = 'soulstream';

export type ShareTarget =
  | { kind: 'track'; id: string; query?: string }
  | { kind: 'search'; query: string };

const DEEZER_PREFIX = 'dz:';

function deezerRawId(catalogId: string): string | null {
  return catalogId.startsWith(DEEZER_PREFIX) && /^\d+$/.test(catalogId.slice(DEEZER_PREFIX.length))
    ? catalogId.slice(DEEZER_PREFIX.length)
    : null;
}

/** The text sent through the system share sheet. */
export function shareMessage(share: {
  title: string;
  artist: string | null;
  catalogId?: string | null;
}): string {
  const query = [share.artist, share.title].filter(Boolean).join(' ');
  const heading = share.artist ? `« ${share.title} » — ${share.artist}` : `« ${share.title} »`;
  const q = encodeURIComponent(query);

  if (!share.catalogId) {
    return `${heading}\nÉcouter dans SoulStream : ${SHARE_SCHEME}://search?q=${q}`;
  }

  const raw = deezerRawId(share.catalogId);
  return [
    heading,
    `Écouter dans SoulStream : ${SHARE_SCHEME}://track/${share.catalogId}?q=${q}`,
    ...(raw ? [`https://www.deezer.com/track/${raw}`] : []),
  ].join('\n');
}

function queryParam(url: string): string | undefined {
  const match = /[?&]q=([^&\s#]*)/.exec(url);
  if (!match) {
    return undefined;
  }
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a received link or message points to: the first SoulStream link in
 * it, else the first Deezer track link. Null when there is none.
 */
export function parseShareLink(text: string, depth = 0): ShareTarget | null {
  const shared = /soulstream:\/\/shared\?text=([^\s]*)/i.exec(text);
  if (shared && depth === 0) {
    try {
      return parseShareLink(decodeURIComponent(shared[1]), depth + 1);
    } catch {
      return null;
    }
  }

  // "track/dz:123"; a bare number is a Deezer id.
  const track = /soulstream:\/\/track\/([a-z]+:\d+|\d+)[^\s]*/i.exec(text);
  if (track) {
    const query = queryParam(track[0]);
    const id = /^\d+$/.test(track[1]) ? `${DEEZER_PREFIX}${track[1]}` : track[1].toLowerCase();
    return { kind: 'track', id, ...(query ? { query } : {}) };
  }

  const search = /soulstream:\/\/search\?[^\s]*/i.exec(text);
  if (search) {
    const query = queryParam(search[0]);
    return query ? { kind: 'search', query } : null;
  }

  const deezer = /https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i.exec(text);
  if (deezer) {
    return { kind: 'track', id: `${DEEZER_PREFIX}${deezer[1]}` };
  }

  return null;
}
