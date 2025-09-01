/**
 * @file Jest configuration for 90% coverage on new code
 * Targets specific files that contain new functionality
 */

export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage-newcode',
  coverageReporters: ['text', 'lcov', 'html'],

  // 90% coverage target for new code
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },

  // Files to collect coverage from (new code only)
  collectCoverageFrom: [
    'src/common/store.ts',
    'src/main/ipc/handlers.ts',
    'src/main/ui/menu.ts',
    // Include website editor handlers specifically
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
  ],

  // Test match patterns
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],

  // Prevent worker hanging
  maxWorkers: 1,
  detectOpenHandles: true,
  forceExit: true,
  testTimeout: 10000,
};
