const baseConfig = require('./jest.config.cjs');

module.exports = {
  ...baseConfig,
  // Enable coverage reporting
  collectCoverage: true,
  // Coverage thresholds to maintain quality (set to realistic achievable levels)
  coverageThreshold: {
    global: {
      statements: 75.0, // Current: 77.55% - set below for buffer
      branches: 68.0, // Current: 70.29% - set below for buffer
      functions: 76.0, // Current: 78.41% - set below for buffer
      lines: 76.0, // Current: 78.16% - set below for buffer
    },
  },
  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html'],
  // Coverage directory
  coverageDirectory: 'coverage',
  // Ensure coverage is collected from the right files
  collectCoverageFrom: [
    'plugins/**/*.{ts,tsx}',
    // Exclude types directory - contains only type definitions without executable code
    // 'types/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!dist/**',
    '!coverage/**',
  ],
};
