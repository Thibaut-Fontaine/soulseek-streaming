/* global jest */
// Keep debug logs silent in tests; a late transfer log otherwise runs after
// Jest teardown and makes the process exit with code 1. The journal also logs
// in release builds now (for `adb logcat`), so __DEV__ alone is not enough.
global.__DEV__ = false;
jest.spyOn(console, 'log').mockImplementation(() => {});
// Native modules have no implementation under Jest.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
jest.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async key => (data.has(key) ? data.get(key) : null)),
      setItem: jest.fn(async (key, value) => {
        data.set(key, value);
      }),
      removeItem: jest.fn(async key => {
        data.delete(key);
      }),
      clear: jest.fn(async () => data.clear()),
    },
  };
});
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: { fs: { dirs: { DocumentDir: '/tmp' } } },
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => []),
  keepLocalCopy: jest.fn(async () => []),
  types: { audio: 'audio/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: () => false,
}));
