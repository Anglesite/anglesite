/**
 * @file Jest configuration file.
 * @see {@link https://jestjs.io/docs/configuration}
 */
export default {
  preset: 'ts-jest',
  transform: {
    '^.+.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    '^.+.js$': 'ts-jest',
  },
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/test/setup/jest-setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    process.env.SKIP_PERFORMANCE_TESTS === 'true' ? 'test/performance/' : null,
  ].filter(Boolean),
  moduleNameMapper: {
    '^../../src/main/eleventy/.eleventy$': '<rootDir>/src/main/eleventy/config.eleventy.ts',
    '^@11ty/eleventy$': '<rootDir>/test/mocks/__mocks__/eleventy.js',
    '^@11ty/eleventy-dev-server$': '<rootDir>/test/mocks/__mocks__/eleventy-dev-server.js',
    '^bagit-fs$': '<rootDir>/test/mocks/__mocks__/bagit-fs.js',
    '^glob$': '<rootDir>/test/mocks/__mocks__/glob.js',
    '^chokidar$': '<rootDir>/test/mocks/__mocks__/chokidar.js',
    // Mock FluentUI to prevent ESM loading issues
    '^@fluentui/web-components$': '<rootDir>/test/mocks/__mocks__/fluentui.js',
  },
  transformIgnorePatterns: ['node_modules/(?!(@11ty/eleventy|@11ty/eleventy-dev-server|bagit-fs|@fluentui)/)'],
  // Performance optimizations
  maxWorkers: '50%', // Use half of available CPU cores for better parallelization
  detectOpenHandles: false, // Disable to prevent hanging on open handles
  forceExit: false, // Allow Jest to exit gracefully
  testTimeout: 15000, // Increased for complex tests but with shorter timeout for hanging tests
  // Stricter cleanup and silence console output
  clearMocks: true,
  restoreMocks: false,
  resetMocks: false,
  silent: true, // Suppress console output during tests
  verbose: false, // Reduce verbose output
  // Optimize module resolution
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  // Prevent Jest from automatically mocking Node.js built-in modules
  unmockedModulePathPatterns: ['fs', 'path', 'os', 'crypto', 'util'],
};
