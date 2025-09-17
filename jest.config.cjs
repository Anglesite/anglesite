// NOTE: This configuration runs all workspace tests in a single Jest instance
// to avoid subprocess spawning issues. Each workspace still has its own
// test script for individual testing.
module.exports = {
  projects: [
    {
      displayName: 'anglesite',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
      rootDir: '<rootDir>/anglesite',
      setupFiles: ['<rootDir>/test/setup/jest-setup.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.jsx?$': 'ts-jest'
      },
      moduleNameMapper: {
        '^../../src/main/eleventy/.eleventy$': '<rootDir>/src/main/eleventy/config.eleventy.ts',
        '^@11ty/eleventy$': '<rootDir>/test/mocks/__mocks__/eleventy.js',
        '^@11ty/eleventy-dev-server$': '<rootDir>/test/mocks/__mocks__/eleventy-dev-server.js',
        '^bagit-fs$': '<rootDir>/test/mocks/__mocks__/bagit-fs.js',
        '^glob$': '<rootDir>/test/mocks/__mocks__/glob.js',
        '^chokidar$': '<rootDir>/test/mocks/__mocks__/chokidar.js',
        '^@fluentui/web-components$': '<rootDir>/test/mocks/__mocks__/fluentui.js',
      },
      transformIgnorePatterns: ['node_modules/(?!(@11ty/eleventy|@11ty/eleventy-dev-server|bagit-fs|@fluentui)/)'],
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      // Limit parallel workers to prevent CPU overload
      maxWorkers: 2
    },
    {
      displayName: 'anglesite-11ty',
      testEnvironment: 'node',
      testMatch: ['**/tests/**/*.test.{ts,tsx,js,jsx}'],
      rootDir: '<rootDir>/anglesite-11ty',
      setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {
        '^.+\\.(ts|tsx)$': ['babel-jest', { presets: ['@babel/preset-env', '@babel/preset-typescript'] }],
        '^.+\\.js$': ['babel-jest', { presets: ['@babel/preset-env'] }],
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      maxWorkers: 2
    },
    {
      displayName: 'web-components',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['**/*.test.ts'],
      rootDir: '<rootDir>/web-components',
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.jsx?$': 'babel-jest'
      },
      maxWorkers: 2
    }
  ],
  // Global settings to prevent excessive parallelization
  maxWorkers: '50%',
  collectCoverageFrom: [
    '**/*.{ts,tsx,js,jsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/_site/**'
  ]
};