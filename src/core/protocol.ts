import { md5 } from 'js-md5';
import { Inflate, deflate } from 'pako';

import { ByteReader, ByteWriter, concatBytes, readU32 } from './bytes';

/** Protocol codes, see https://nicotine-plus.org/doc/SLSKPROTOCOL.html */

export const ServerCode = {
  LOGIN: 1,
  SET_WAIT_PORT: 2,
  GET_PEER_ADDRESS: 3,
  WATCH_USER: 5,
  UNWATCH_USER: 6,
  GET_USER_STATUS: 7,
  CONNECT_TO_PEER: 18,
  FILE_SEARCH: 26,
  SET_STATUS: 28,
  SERVER_PING: 32,
  SHARED_FOLDERS_FILES: 35,
  GET_USER_STATS: 36,
  RELOGGED: 41,
  HAVE_NO_PARENT: 71,
  ACCEPT_CHILDREN: 100,
  CANT_CONNECT_TO_PEER: 1001,
} as const;

export const PeerCode = {
  GET_SHARE_FILE_LIST: 4,
  SHARED_FILE_LIST_RESPONSE: 5,
  FILE_SEARCH_RESPONSE: 9,
  USER_INFO_REQUEST: 15,
  USER_INFO_RESPONSE: 16,
  FOLDER_CONTENTS_REQUEST: 36,
  FOLDER_CONTENTS_RESPONSE: 37,
  TRANSFER_REQUEST: 40,
  TRANSFER_RESPONSE: 41,
  QUEUE_UPLOAD: 43,
  PLACE_IN_QUEUE_RESPONSE: 44,
  UPLOAD_FAILED: 46,
  UPLOAD_DENIED: 50,
  PLACE_IN_QUEUE_REQUEST: 51,
} as const;

export const PeerInitCode = {
  PIERCE_FIREWALL: 0,
  PEER_INIT: 1,
} as const;

export const ConnectionType = {
  PEER: 'P',
  FILE: 'F',
  DISTRIBUTED: 'D',
} as const;

export const UserStatus = {
  OFFLINE: 0,
  AWAY: 1,
  ONLINE: 2,
} as const;

export const TransferDirection = {
  DOWNLOAD: 0,
  UPLOAD: 1,
} as const;

export const LoginRejection = {
  INVALIDUSERNAME: 'INVALIDUSERNAME',
  EMPTYPASSWORD: 'EMPTYPASSWORD',
  INVALIDPASS: 'INVALIDPASS',
  INVALIDVERSION: 'INVALIDVERSION',
  SVRFULL: 'SVRFULL',
  SVRPRIVATE: 'SVRPRIVATE',
} as const;

export interface FileInfo {
  filename: string;
  size: number;
  bitrate?: number;
  durationSec?: number;
  sampleRate?: number;
  bitDepth?: number;
  vbr?: boolean;
}

export interface SearchResponse {
  username: string;
  token: number;
  files: FileInfo[];
  /** Buddy-only files. They are listed but the peer refuses to send them. */
  lockedFiles: FileInfo[];
  slotFree: boolean;
  avgSpeed: number;
  queueLength: number;
}

export interface LoginSuccess {
  ok: true;
  banner: string;
  ipAddress: string;
  passwordChecksum: string;
  isSupporter: boolean;
}

export interface LoginFailure {
  ok: false;
  reason: string;
  detail?: string;
}

export type LoginResponse = LoginSuccess | LoginFailure;

export interface PeerAddress {
  username: string;
  ipAddress: string;
  port: number;
  obfuscationType: number;
  obfuscatedPort: number;
}

export interface ConnectToPeerRequest {
  username: string;
  connectionType: string;
  ipAddress: string;
  port: number;
  token: number;
  privileged: boolean;
  obfuscationType: number;
  obfuscatedPort: number;
}

export interface TransferRequest {
  direction: number;
  token: number;
  filename: string;
  size?: number;
}

export interface PlaceInQueue {
  filename: string;
  place: number;
}

/* -------------------------------------------------------------------------- */
/* Framing                                                                    */
/* -------------------------------------------------------------------------- */

export function encodeServerMessage(code: number, payload: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(payload.length + 4).u32(code).raw(payload);
  return writer.toBytes();
}

export function encodePeerMessage(code: number, payload: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(payload.length + 4).u32(code).raw(payload);
  return writer.toBytes();
}

export function encodePeerInitMessage(code: number, payload: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(payload.length + 1).u8(code).raw(payload);
  return writer.toBytes();
}

/* -------------------------------------------------------------------------- */
/* Server messages                                                            */
/* -------------------------------------------------------------------------- */

export const DEFAULT_CLIENT_VERSION = { major: 177, minor: 1 };

export function encodeLogin(
  username: string,
  password: string,
  version = DEFAULT_CLIENT_VERSION,
): Uint8Array {
  const writer = new ByteWriter();
  writer.string(username);
  writer.string(password);
  writer.u32(version.major);
  // The official client sends an MD5 of username + password so the server can
  // reject a login without having to store the plaintext password.
  writer.string(md5(username + password));
  writer.u32(version.minor);
  return encodeServerMessage(ServerCode.LOGIN, writer.toBytes());
}

export function parseLoginResponse(payload: Uint8Array): LoginResponse {
  const reader = new ByteReader(payload);
  const success = reader.bool();

  if (!success) {
    const reason = reader.string();
    const detail = reader.hasRemaining() ? reader.string() : undefined;
    return { ok: false, reason, detail };
  }

  return {
    ok: true,
    banner: reader.string(),
    ipAddress: reader.ip(),
    passwordChecksum: reader.string(),
    isSupporter: reader.bool(),
  };
}

export function encodeSetWaitPort(port: number): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(port);
  return encodeServerMessage(ServerCode.SET_WAIT_PORT, writer.toBytes());
}

export function encodeSetStatus(status: number): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(status);
  return encodeServerMessage(ServerCode.SET_STATUS, writer.toBytes());
}

export function encodeGetPeerAddress(username: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(username);
  return encodeServerMessage(ServerCode.GET_PEER_ADDRESS, writer.toBytes());
}

export function parsePeerAddress(payload: Uint8Array): PeerAddress {
  const reader = new ByteReader(payload);
  return {
    username: reader.string(),
    ipAddress: reader.ip(),
    port: reader.u32(),
    obfuscationType: reader.u32(),
    obfuscatedPort: reader.u16(),
  };
}

export function encodeConnectToPeer(token: number, username: string, type: string): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(token).string(username).string(type);
  return encodeServerMessage(ServerCode.CONNECT_TO_PEER, writer.toBytes());
}

export function parseConnectToPeer(payload: Uint8Array): ConnectToPeerRequest {
  const reader = new ByteReader(payload);
  return {
    username: reader.string(),
    connectionType: reader.string(),
    ipAddress: reader.ip(),
    port: reader.u32(),
    token: reader.u32(),
    privileged: reader.bool(),
    obfuscationType: reader.u32(),
    obfuscatedPort: reader.u32(),
  };
}

export function parseCantConnectToPeer(payload: Uint8Array): { token: number } {
  const reader = new ByteReader(payload);
  return { token: reader.u32() };
}

export function encodeCantConnectToPeer(token: number, username: string): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(token).string(username);
  return encodeServerMessage(ServerCode.CANT_CONNECT_TO_PEER, writer.toBytes());
}

export function encodeFileSearch(token: number, query: string): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(token).string(query);
  return encodeServerMessage(ServerCode.FILE_SEARCH, writer.toBytes());
}

export function encodeHaveNoParent(noParent: boolean): Uint8Array {
  const writer = new ByteWriter();
  writer.bool(noParent);
  return encodeServerMessage(ServerCode.HAVE_NO_PARENT, writer.toBytes());
}

export function encodeAcceptChildren(enabled: boolean): Uint8Array {
  const writer = new ByteWriter();
  writer.bool(enabled);
  return encodeServerMessage(ServerCode.ACCEPT_CHILDREN, writer.toBytes());
}

export function encodeServerPing(): Uint8Array {
  return encodeServerMessage(ServerCode.SERVER_PING, new Uint8Array(0));
}

export function encodeWatchUser(username: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(username);
  return encodeServerMessage(ServerCode.WATCH_USER, writer.toBytes());
}

export function encodeGetUserStats(username: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(username);
  return encodeServerMessage(ServerCode.GET_USER_STATS, writer.toBytes());
}

/* -------------------------------------------------------------------------- */
/* Peer init messages                                                         */
/* -------------------------------------------------------------------------- */

export function encodePeerInit(username: string, type: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(username).string(type).u32(0);
  return encodePeerInitMessage(PeerInitCode.PEER_INIT, writer.toBytes());
}

export function encodePierceFirewall(token: number): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(token);
  return encodePeerInitMessage(PeerInitCode.PIERCE_FIREWALL, writer.toBytes());
}

export interface PeerInitInfo {
  username: string;
  connectionType: string;
  token: number;
}

export function parsePeerInit(payload: Uint8Array): PeerInitInfo {
  const reader = new ByteReader(payload);
  return {
    username: reader.string(),
    connectionType: reader.string(),
    token: reader.u32(),
  };
}

/* -------------------------------------------------------------------------- */
/* Peer messages                                                              */
/* -------------------------------------------------------------------------- */

export function encodeQueueUpload(filename: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(filename);
  return encodePeerMessage(PeerCode.QUEUE_UPLOAD, writer.toBytes());
}

export function encodePlaceInQueueRequest(filename: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(filename);
  return encodePeerMessage(PeerCode.PLACE_IN_QUEUE_REQUEST, writer.toBytes());
}

export function encodeTransferResponse(
  token: number,
  allowed: boolean,
  reason?: string,
): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(token).bool(allowed);

  if (!allowed) {
    writer.string(reason ?? 'Cancelled');
  }

  return encodePeerMessage(PeerCode.TRANSFER_RESPONSE, writer.toBytes());
}

export function parseTransferRequest(payload: Uint8Array): TransferRequest {
  const reader = new ByteReader(payload);
  const direction = reader.u32();
  const token = reader.u32();
  const filename = reader.string();
  const size = direction === TransferDirection.UPLOAD ? reader.u64() : undefined;
  return { direction, token, filename, size };
}

export function parsePlaceInQueueResponse(payload: Uint8Array): PlaceInQueue {
  const reader = new ByteReader(payload);
  return { filename: reader.string(), place: reader.u32() };
}

export function parseUploadDenied(payload: Uint8Array): { filename: string; reason: string } {
  const reader = new ByteReader(payload);
  return { filename: reader.string(), reason: reader.string() };
}

export function parseUploadFailed(payload: Uint8Array): { filename: string } {
  const reader = new ByteReader(payload);
  return { filename: reader.string() };
}

/** Searches can contain a large number of results; keep the UI bounded. */
export const MAX_SEARCH_FILES = 500;

function parseFileAttributes(reader: ByteReader, info: FileInfo): void {
  const attributeCount = reader.u32();

  if (attributeCount > 64) {
    throw new Error(`Invalid file attribute count: ${attributeCount}`);
  }

  for (let i = 0; i < attributeCount; i++) {
    const code = reader.u32();
    const value = reader.u32();

    switch (code) {
      case 0:
        info.bitrate = value;
        break;
      case 1:
        info.durationSec = value;
        break;
      case 2:
        info.vbr = value !== 0;
        break;
      case 4:
        info.sampleRate = value;
        break;
      case 5:
        info.bitDepth = value;
        break;
      default:
        break;
    }
  }
}

function parseFileList(reader: ByteReader): FileInfo[] {
  const fileCount = reader.u32();

  if (fileCount > MAX_SEARCH_FILES) {
    throw new Error(`Invalid file count: ${fileCount}`);
  }

  const files: FileInfo[] = [];

  for (let i = 0; i < fileCount; i++) {
    reader.u8(); // "code", always 1
    const filename = reader.string().replace(/\//g, '\\');
    const size = reader.u64();
    reader.bytes(); // obsolete extension field
    const info: FileInfo = { filename, size };
    parseFileAttributes(reader, info);
    files.push(info);
  }

  return files;
}

const MAX_DECOMPRESSED_SEARCH_BYTES = 4 * 1024 * 1024;

/**
 * Search responses are zlib-compressed as a whole. Bound the decompressed size
 * so a malicious peer cannot turn a 16 MiB frame into a multi-gigabyte bomb.
 */
function inflateSearchResponse(payload: Uint8Array): Uint8Array {
  const inflator = new Inflate();
  const parts: Uint8Array[] = [];
  let total = 0;

  inflator.onData = (chunk: Uint8Array) => {
    total += chunk.length;

    if (total > MAX_DECOMPRESSED_SEARCH_BYTES) {
      throw new Error('Search response too large');
    }

    parts.push(chunk);
  };

  inflator.push(payload, true);

  if (inflator.err) {
    throw new Error(inflator.msg || 'Invalid compressed search response');
  }

  return concatBytes(parts);
}

export function parseFileSearchResponse(payload: Uint8Array): SearchResponse {
  const decompressed = inflateSearchResponse(payload);
  const reader = new ByteReader(decompressed);

  const username = reader.string();
  const token = reader.u32();
  const files = parseFileList(reader);

  const slotFree = reader.bool();
  const avgSpeed = reader.u32();
  const queueLength = reader.u32();

  // Some clients append an unknown uint32 and a private (buddy-only) result
  // list. Both are optional, so only read them when they are present. Locked
  // files are kept apart: requesting one always ends in UploadDenied.
  let lockedFiles: FileInfo[] = [];

  if (reader.remaining >= 4) {
    reader.u32();

    if (reader.remaining >= 4) {
      try {
        lockedFiles = parseFileList(reader);
      } catch {
        // A malformed private list must not discard the public results.
      }
    }
  }

  return { username, token, files, lockedFiles, slotFree, avgSpeed, queueLength };
}

/**
 * File-transfer data is raw: no code, no length prefix.
 * The downloader sends a uint64 offset, then the uploader streams the file.
 */
export function encodeFileOffset(offset: number): Uint8Array {
  const writer = new ByteWriter();
  writer.u64(offset);
  return writer.toBytes();
}

export function parseFileTransferInit(data: Uint8Array): number {
  if (data.length < 4) {
    throw new RangeError('Incomplete file transfer init');
  }

  return readU32(data, 0);
}

/* -------------------------------------------------------------------------- */
/* Sharing and uploads                                                        */
/* -------------------------------------------------------------------------- */

/** A file we share, as other users see it. */
export interface SharedFileInfo {
  /** Full virtual path, e.g. `SoulStream\\Artist - Title.mp3`. */
  path: string;
  size: number;
  bitrate?: number;
  durationSec?: number;
}

/** Tells the server how many folders and files we share. */
export function encodeSharedFoldersFiles(folders: number, files: number): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(folders).u32(files);
  return encodeServerMessage(ServerCode.SHARED_FOLDERS_FILES, writer.toBytes());
}

function splitPath(path: string): { folder: string; name: string } {
  const index = path.lastIndexOf('\\');
  return index < 0
    ? { folder: '', name: path }
    : { folder: path.slice(0, index), name: path.slice(index + 1) };
}

function writeFileEntry(writer: ByteWriter, file: SharedFileInfo, name: string): void {
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  const attributes: Array<[number, number]> = [];

  if (file.bitrate) {
    attributes.push([0, file.bitrate]);
  }

  if (file.durationSec) {
    attributes.push([1, Math.round(file.durationSec)]);
  }

  writer.u8(1).string(name).u64(file.size).string(extension).u32(attributes.length);

  for (const [code, value] of attributes) {
    writer.u32(code).u32(value);
  }
}

/** Groups files by folder, keeping the folder order stable. */
function groupByFolder(files: SharedFileInfo[]): Map<string, Array<{ file: SharedFileInfo; name: string }>> {
  const folders = new Map<string, Array<{ file: SharedFileInfo; name: string }>>();

  for (const file of files) {
    const { folder, name } = splitPath(file.path);
    const list = folders.get(folder) ?? [];
    list.push({ file, name });
    folders.set(folder, list);
  }

  return folders;
}

function writeFolders(
  writer: ByteWriter,
  folders: Map<string, Array<{ file: SharedFileInfo; name: string }>>,
): void {
  writer.u32(folders.size);

  for (const [folder, entries] of folders) {
    writer.string(folder).u32(entries.length);

    for (const { file, name } of entries) {
      writeFileEntry(writer, file, name);
    }
  }
}

/** Answer to GetShareFileList: our whole share, zlib-compressed. */
export function encodeSharedFileListResponse(files: SharedFileInfo[]): Uint8Array {
  const writer = new ByteWriter();
  writeFolders(writer, groupByFolder(files));
  writer.u32(0); // unknown, always 0
  writer.u32(0); // no private (buddy-only) folders
  return encodePeerMessage(PeerCode.SHARED_FILE_LIST_RESPONSE, deflate(writer.toBytes()));
}

export function parseFolderContentsRequest(payload: Uint8Array): { token: number; folder: string } {
  const reader = new ByteReader(payload);
  return { token: reader.u32(), folder: reader.string() };
}

export function encodeFolderContentsResponse(
  token: number,
  folder: string,
  files: SharedFileInfo[],
): Uint8Array {
  const folders = groupByFolder(files.filter(file => splitPath(file.path).folder === folder));
  const writer = new ByteWriter();
  writer.u32(token).string(folder);
  writeFolders(writer, folders);
  return encodePeerMessage(PeerCode.FOLDER_CONTENTS_RESPONSE, deflate(writer.toBytes()));
}

export function encodeUserInfoResponse(info: {
  description: string;
  uploadSlots: number;
  queueSize: number;
  slotsFree: boolean;
}): Uint8Array {
  const writer = new ByteWriter();
  writer.string(info.description).bool(false); // no picture
  writer.u32(info.uploadSlots).u32(info.queueSize).bool(info.slotsFree);
  writer.u32(1); // uploads permitted to everyone
  return encodePeerMessage(PeerCode.USER_INFO_RESPONSE, writer.toBytes());
}

export function parseQueueUpload(payload: Uint8Array): { filename: string } {
  const reader = new ByteReader(payload);
  return { filename: reader.string() };
}

export function parsePlaceInQueueRequest(payload: Uint8Array): { filename: string } {
  const reader = new ByteReader(payload);
  return { filename: reader.string() };
}

export function encodePlaceInQueueResponse(filename: string, place: number): Uint8Array {
  const writer = new ByteWriter();
  writer.string(filename).u32(place);
  return encodePeerMessage(PeerCode.PLACE_IN_QUEUE_RESPONSE, writer.toBytes());
}

/** We offer to send a file: TransferRequest with the upload direction. */
export function encodeUploadTransferRequest(token: number, filename: string, size: number): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(TransferDirection.UPLOAD).u32(token).string(filename).u64(size);
  return encodePeerMessage(PeerCode.TRANSFER_REQUEST, writer.toBytes());
}

export function parseTransferResponse(payload: Uint8Array): {
  token: number;
  allowed: boolean;
  reason?: string;
} {
  const reader = new ByteReader(payload);
  const token = reader.u32();
  const allowed = reader.bool();
  const reason = !allowed && reader.hasRemaining() ? reader.string() : undefined;
  return { token, allowed, reason };
}

export function encodeUploadDenied(filename: string, reason: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(filename).string(reason);
  return encodePeerMessage(PeerCode.UPLOAD_DENIED, writer.toBytes());
}

export function encodeUploadFailed(filename: string): Uint8Array {
  const writer = new ByteWriter();
  writer.string(filename);
  return encodePeerMessage(PeerCode.UPLOAD_FAILED, writer.toBytes());
}

/** Raw first message of an F connection opened by the uploader. */
export function encodeFileTransferInit(token: number): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(token);
  return writer.toBytes();
}
