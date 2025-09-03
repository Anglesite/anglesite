const baseConfig = require('./jest.config.cjs');

module.exports = {
  ...baseConfig,
  // Enable coverage reporting
  collectCoverage: true,
  // Coverage thresholds to maintain quality (set to current levels to prevent regression)
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 62,
      functions: 77,
      lines: 70,
    },
  },
  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html'],
  // Coverage directory
  coverageDirectory: 'coverage',
  // Ensure coverage is collected from the right files
  collectCoverageFrom: [
    'plugins/**/*.{ts,tsx}',
    'types/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!dist/**',
    '!coverage/**',
  ],
};
