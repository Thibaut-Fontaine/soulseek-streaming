/* global jest */
// Native modules have no implementation under Jest.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: { fs: { dirs: { DocumentDir: '/tmp' } } },
}));
