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
    readBase64: path => fs.readFile(path, 'base64'),
    writeText: (path, data) => fs.writeFile(path, data, 'utf8'),
    readText: path => fs.readFile(path, 'utf8'),
    unlink: path => fs.unlink(path),
    move: (from, to) => fs.mv(from, to).then(() => undefined),
  };
}
