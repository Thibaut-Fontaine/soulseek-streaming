import ReactNativeBlobUtil from 'react-native-blob-util';

import type { CacheFs } from './trackCache';

/** CacheFs on top of react-native-blob-util, in the app's document folder. */
export function createBlobUtilFs(): CacheFs {
  const fs = ReactNativeBlobUtil.fs;

  return {
    // Documents, not Caches: the OS may purge Caches, and these files are the
    // user's shared folder.
    dir: `${fs.dirs.DocumentDir}/soulstream-tracks`,
    exists: path => fs.exists(path),
    mkdir: path => fs.mkdir(path),
    writeBase64: (path, data) => fs.writeFile(path, data, 'base64'),
    appendBase64: (path, data) => fs.appendFile(path, data, 'base64').then(() => undefined),
    readBase64: path => fs.readFile(path, 'base64'),
    writeText: (path, data) => fs.writeFile(path, data, 'utf8'),
    readText: path => fs.readFile(path, 'utf8'),
    unlink: path => fs.unlink(path),
    move: (from, to) => fs.mv(from, to).then(() => undefined),
    // Reading a few KB of a 10 MB file: copy the slice to a temporary file
    // and read that, instead of sending the whole file over the bridge.
    readSliceBase64: async (path, start, end) => {
      const temp = `${fs.dirs.CacheDir}/soulstream-slice-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      try {
        await fs.slice(path, temp, start, end);
        return await fs.readFile(temp, 'base64');
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
    },
  };
}
