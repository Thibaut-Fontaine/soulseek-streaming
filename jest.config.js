module.exports = {
  preset: 'react-native',
  // Local agent worktrees live under .claude/; never run their copies.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
};
