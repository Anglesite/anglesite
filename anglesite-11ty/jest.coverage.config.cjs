const baseConfig = require('./jest.config.cjs');

module.exports = {
  ...baseConfig,
  // Enable coverage reporting
  collectCoverage: true,
  // Coverage thresholds to maintain quality (set to current achieved levels)
  coverageThreshold: {
    global: {
      statements: 85.94,
      branches: 77.46,
      functions: 90.54,
      lines: 86.1,
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
