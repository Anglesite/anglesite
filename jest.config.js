/**
 * @file Root Jest configuration for @dwk workspace
 * ABOUTME: Provides shared Jest configuration for all workspace packages
 * ABOUTME: Supports both unit tests and coverage reporting across the monorepo
 */

module.exports = {
  // Common Jest settings
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Reduce test output verbosity
  silent: true,
  verbose: false,
  
  // Enhanced caching configuration
  cache: true,
  cacheDirectory: '<rootDir>/.cache/jest',
  
  // Projects configuration for workspaces
  projects: [
    {
      displayName: '@dwk/anglesite',
      rootDir: './anglesite',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      setupFiles: ['<rootDir>/test/setup/jest-setup.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
      testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
      testPathIgnorePatterns: [
        '/node_modules/',
        'test/app/certificates.test.ts',
        '/integration/',
      ],
      moduleNameMapper: {
        '^../../app/eleventy/.eleventy$': '<rootDir>/app/eleventy/config.eleventy.ts',
        '^@11ty/eleventy$': '<rootDir>/test/mocks/__mocks__/eleventy.js',
        '^@11ty/eleventy-dev-server$': '<rootDir>/test/mocks/__mocks__/eleventy-dev-server.js',
        '^bagit-fs$': '<rootDir>/test/mocks/__mocks__/bagit-fs.js',
        '^glob$': '<rootDir>/test/mocks/__mocks__/glob.js',
        '^chokidar$': '<rootDir>/test/mocks/__mocks__/chokidar.js',
      },
      transformIgnorePatterns: ['node_modules/(?!(@11ty/eleventy|@11ty/eleventy-dev-server|bagit-fs)/)'],
      collectCoverageFrom: [
        'app/**/*.ts',
        '!app/**/*.d.ts',
        '!app/**/*.test.ts',
        '!app/**/*.spec.ts',
        '!app/renderer.ts',
        '!app/renderer-wrapper.ts',
        '!app/theme-renderer.ts',
      ],
      maxWorkers: 1,
      testTimeout: 5000,
      clearMocks: true,
      restoreMocks: true,
      resetMocks: true,
    },
    {
      displayName: '@dwk/anglesite-11ty',
      rootDir: './anglesite-11ty',
      testEnvironment: 'node',
      extensionsToTreatAsEsm: ['.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
      transform: {
        '^.+\\.(ts|tsx)$': ['babel-jest', { presets: ['@babel/preset-env', '@babel/preset-typescript'] }],
        '^.+\\.js$': ['babel-jest', { presets: ['@babel/preset-env'] }],
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      collectCoverageFrom: [
        'plugins/**/*.{ts,tsx}',
        'types/**/*.{ts,tsx}',
        'src/**/*.{js,ts}',
        '!**/*.d.ts',
        '!**/node_modules/**',
      ],
      testMatch: ['**/tests/**/*.test.{ts,tsx,js,jsx}'],
    },
    {
      displayName: '@dwk/anglesite-starter', 
      rootDir: './anglesite-starter',
      testEnvironment: 'node',
      testMatch: ['**/*.test.{js,ts}'],
      collectCoverageFrom: [
        '**/*.{js,ts}',
        '!**/*.d.ts',
        '!**/node_modules/**',
        '!**/_site/**',
      ],
    },
    {
      displayName: '@dwk/web-components',
      rootDir: './web-components',
      testEnvironment: 'node',
      testMatch: ['**/*.test.{js,ts}'],
      collectCoverageFrom: [
        'components/**/*.{js,ts}',
        'src/**/*.{js,ts}',
        '!**/*.d.ts',
        '!**/node_modules/**',
        '!**/_site/**',
        '!**/dist/**',
      ],
    },
  ],

  // Global settings
  detectOpenHandles: true,
  forceExit: true,
};