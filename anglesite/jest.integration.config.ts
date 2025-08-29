/**
 * @file Jest configuration for integration tests only
 * Runs slow integration tests separately from coverage tests
 */

export default {
  preset: 'ts-jest',
  transform: {
    '^.+.ts$': 'ts-jest',
    '^.+.js$': 'ts-jest',
  },
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/test/setup/jest-setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: [
    // Only run integration tests
    '**/integration/**/*.test.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    '^../../app/eleventy/.eleventy$': '<rootDir>/app/eleventy/config.eleventy.ts',
    '^@11ty/eleventy$': '<rootDir>/test/mocks/__mocks__/eleventy.js',
    '^@11ty/eleventy-dev-server$': '<rootDir>/test/mocks/__mocks__/eleventy-dev-server.js',
    '^bagit-fs$': '<rootDir>/test/mocks/__mocks__/bagit-fs.js',
    '^glob$': '<rootDir>/test/mocks/__mocks__/glob.js',
    '^chokidar$': '<rootDir>/test/mocks/__mocks__/chokidar.js',
  },
  transformIgnorePatterns: ['node_modules/(?!(@11ty/eleventy|@11ty/eleventy-dev-server|bagit-fs)/)'],

  // Integration test settings - no coverage needed
  collectCoverage: false,

  // Use more workers for integration tests
  maxWorkers: '75%',
  testTimeout: 120000, // 2 minutes for slow builds

  // Less strict cleanup for integration tests
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,

  // Cache for speed
  cache: true,
  cacheDirectory: '<rootDir>/.jest-integration-cache',
};
