/**
 * Minimal ID3v2 reader: the cover picture and the title / artist / album
 * text frames at the start of an MP3. Android's media notification already
 * shows the embedded cover; this lets the app show the same one.
 *
 * Pure TypeScript, no native code, so it runs on the first bytes received
 * from a peer as well as on files on the device.
 */

export interface Id3Picture {
  mime: string;
  data: Uint8Array;
}

export interface Id3Tags {
  title?: string;
  artist?: string;
  album?: string;
  picture?: Id3Picture;
}

/** Covers larger than this are ignored (memory, and data URIs in the UI). */
export const MAX_PICTURE_BYTES = 3 * 1024 * 1024;

/**
 * Total size of the ID3v2 tag at the start of `head` (header included), or 0
 * when there is none. Needs the first 10 bytes.
 */
export function id3TagSize(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) {
    return 0;
  }

  const major = head[3];

  if (major < 2 || major > 4) {
    return 0;
  }

  const size = syncsafe(head, 6);

  if (size < 0) {
    return 0;
  }

  const footer = major === 4 && (head[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Parses the tag. `bytes` must hold the whole tag (see `id3TagSize`); a
 * truncated tag yields whatever frames are complete. Never throws.
 */
export function parseId3(bytes: Uint8Array): Id3Tags | null {
  try {
    return parse(bytes);
  } catch {
    return null;
  }
}

function parse(bytes: Uint8Array): Id3Tags | null {
  const total = id3TagSize(bytes);

  if (total === 0) {
    return null;
  }

  const major = bytes[3];
  const flags = bytes[5];
  let body = bytes.subarray(10, Math.min(bytes.length, total));

  // v2.2 / v2.3: unsynchronisation applies to the whole tag.
  if (major < 4 && (flags & 0x80) !== 0) {
    body = resync(body);
  }

  let offset = 0;

  if ((flags & 0x40) !== 0 && major >= 3) {
    // Extended header: v2.3 size excludes its own 4 bytes, v2.4 includes them.
    const extSize = major === 4 ? syncsafe(body, 0) : u32(body, 0) + 4;
    offset = Math.max(0, extSize);
  }

  const tags: Id3Tags = {};
  const idLength = major === 2 ? 3 : 4;
  const headerLength = major === 2 ? 6 : 10;

  while (offset + headerLength <= body.length) {
    const id = ascii(body, offset, idLength);

    if (!/^[A-Z0-9]+$/.test(id)) {
      break; // padding
    }

    const size =
      major === 2
        ? (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5]
        : major === 4
          ? syncsafe(body, offset + 4)
          : u32(body, offset + 4);
    const frameFlags = major === 2 ? 0 : body[offset + 9];
    const start = offset + headerLength;
    const end = start + size;

    if (size <= 0 || end > body.length) {
      break;
    }

    let data = body.subarray(start, end);

    if (major === 4) {
      // Data length indicator, then per-frame unsynchronisation.
      if ((frameFlags & 0x01) !== 0) {
        data = data.subarray(4);
      }
      if ((frameFlags & 0x02) !== 0) {
        data = resync(data);
      }
    }

    // Compressed or encrypted frames are skipped.
    const unreadable = major === 3 ? (frameFlags & 0xc0) !== 0 : major === 4 ? (frameFlags & 0x0c) !== 0 : false;

    if (!unreadable) {
      readFrame(id, data, tags);
    }

    offset = end;
  }

  return tags;
}

function readFrame(id: string, data: Uint8Array, tags: Id3Tags): void {
  switch (id) {
    case 'TIT2':
    case 'TT2':
      tags.title = tags.title ?? textFrame(data);
      return;
    case 'TPE1':
    case 'TP1':
      tags.artist = tags.artist ?? textFrame(data);
      return;
    case 'TALB':
    case 'TAL':
      tags.album = tags.album ?? textFrame(data);
      return;
    case 'APIC':
    case 'PIC': {
      const picture = id === 'APIC' ? apic(data) : pic(data);

      // Prefer the front cover (type 3) over any other picture.
      if (picture && (!tags.picture || picture.front)) {
        tags.picture = { mime: picture.mime, data: picture.data };
      }
      return;
    }
    default:
  }
}

function textFrame(data: Uint8Array): string | undefined {
  if (data.length < 2) {
    return undefined;
  }

  const text = decode(data.subarray(1), data[0])
    .split('\u0000')[0]
    .trim();

  return text.length > 0 ? text : undefined;
}

function apic(data: Uint8Array): (Id3Picture & { front: boolean }) | null {
  const encoding = data[0];
  let offset = 1;
  const mimeEnd = data.indexOf(0, offset);

  if (mimeEnd < 0) {
    return null;
  }

  let mime = ascii(data, offset, mimeEnd - offset).toLowerCase();
  offset = mimeEnd + 1;
  const type = data[offset];
  offset += 1;
  offset = skipString(data, offset, encoding);

  return picture(mime === 'jpg' ? 'image/jpeg' : mime, data.subarray(offset), type === 3);
}

function pic(data: Uint8Array): (Id3Picture & { front: boolean }) | null {
  const encoding = data[0];
  const format = ascii(data, 1, 3).toLowerCase();
  const type = data[4];
  const offset = skipString(data, 5, encoding);

  return picture(format === 'png' ? 'image/png' : 'image/jpeg', data.subarray(offset), type === 3);
}

function picture(mime: string, data: Uint8Array, front: boolean): (Id3Picture & { front: boolean }) | null {
  if (data.length < 16 || data.length > MAX_PICTURE_BYTES) {
    return null;
  }

  // Trust the bytes over the declared type.
  let kind = mime;

  if (data[0] === 0xff && data[1] === 0xd8) {
    kind = 'image/jpeg';
  } else if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    kind = 'image/png';
  } else if (!/^image\/(jpeg|png|webp|gif)$/.test(kind)) {
    return null;
  }

  return { mime: kind, data, front };
}

/** Skips a null-terminated string in the given text encoding. */
function skipString(data: Uint8Array, offset: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = offset; i + 1 < data.length; i += 2) {
      if (data[i] === 0 && data[i + 1] === 0) {
        return i + 2;
      }
    }
    return data.length;
  }

  const end = data.indexOf(0, offset);
  return end < 0 ? data.length : end + 1;
}

function decode(data: Uint8Array, encoding: number): string {
  switch (encoding) {
    case 1:
      return utf16(data, null);
    case 2:
      return utf16(data, false);
    case 3:
      return utf8(data);
    default:
      return latin1(data);
  }
}

function latin1(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    out += String.fromCharCode(data[i]);
  }
  return out;
}

/** UTF-16 with an optional BOM; `littleEndian` null means "read the BOM". */
function utf16(data: Uint8Array, littleEndian: boolean | null): string {
  let le = littleEndian ?? false;
  let start = 0;

  if (data.length >= 2) {
    if (data[0] === 0xff && data[1] === 0xfe) {
      le = true;
      start = 2;
    } else if (data[0] === 0xfe && data[1] === 0xff) {
      le = false;
      start = 2;
    } else if (littleEndian === null) {
      le = true;
    }
  }

  let out = '';
  for (let i = start; i + 1 < data.length; i += 2) {
    out += String.fromCharCode(le ? data[i] | (data[i + 1] << 8) : (data[i] << 8) | data[i + 1]);
  }
  return out;
}

function utf8(data: Uint8Array): string {
  let out = '';
  let i = 0;

  while (i < data.length) {
    const c = data[i++];

    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c >= 0xc0 && c < 0xe0 && i < data.length) {
      out += String.fromCharCode(((c & 0x1f) << 6) | (data[i++] & 0x3f));
    } else if (c >= 0xe0 && c < 0xf0 && i + 1 < data.length) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((data[i++] & 0x3f) << 6) | (data[i++] & 0x3f));
    } else if (c >= 0xf0 && i + 2 < data.length) {
      const cp =
        ((c & 0x07) << 18) | ((data[i++] & 0x3f) << 12) | ((data[i++] & 0x3f) << 6) | (data[i++] & 0x3f);
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      out += '�';
    }
  }

  return out;
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < data.length; i++) {
    out += String.fromCharCode(data[i]);
  }
  return out;
}

function syncsafe(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) {
    return -1;
  }
  return ((data[offset] & 0x7f) << 21) | ((data[offset + 1] & 0x7f) << 14) | ((data[offset + 2] & 0x7f) << 7) | (data[offset + 3] & 0x7f);
}

function u32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) {
    return -1;
  }
  return ((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
}

/** Undoes unsynchronisation: every 0xFF 0x00 becomes 0xFF. */
function resync(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  let n = 0;

  for (let i = 0; i < data.length; i++) {
    out[n++] = data[i];
    if (data[i] === 0xff && data[i + 1] === 0x00) {
      i++;
    }
  }

  return out.subarray(0, n);
}
