import { Buffer } from 'buffer';

/**
 * Base64 for big binary data (tracks, covers). On the phone it uses the native
 * (JSI) codec of react-native-quick-base64: the JS Buffer polyfill took
 * seconds of JS-thread time per 10 MB on modest phones. Falls back to Buffer
 * where the native codec is not installed (tests, Node).
 */

interface QuickBase64 {
  toByteArray(b64: string): Uint8Array;
  fromByteArray(bytes: Uint8Array): string;
}

declare const global: {
  base64ToArrayBuffer?: unknown;
  base64FromArrayBuffer?: unknown;
};

let quick: QuickBase64 | null = null;
try {
  // Installs the native functions on load when the native module exists.
  quick = require('react-native-quick-base64') as QuickBase64;
} catch {
  quick = null;
}

function nativeReady(): boolean {
  return (
    quick !== null &&
    typeof global.base64ToArrayBuffer === 'function' &&
    typeof global.base64FromArrayBuffer === 'function'
  );
}

export function encodeBase64(bytes: Uint8Array): string {
  if (nativeReady()) {
    return quick!.fromByteArray(bytes);
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function decodeBase64(data: string): Uint8Array {
  if (nativeReady()) {
    return quick!.toByteArray(data);
  }
  const buffer = Buffer.from(data, 'base64');
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
