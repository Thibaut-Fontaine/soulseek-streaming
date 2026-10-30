module.exports = {
  root: true,
  extends: '@react-native',
  // Compiled server output is a build artifact, not app source.
  ignorePatterns: ['server/logs/dist/'],
};
