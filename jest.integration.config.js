// ABOUTME: Jest configuration for comprehensive integration testing across packages
// ABOUTME: Tests cross-package interactions, API integrations, and end-to-end workflows

const baseConfig = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  
  // Integration test specific settings
  displayName: 'Integration Tests',
  testMatch: [
    '<rootDir>/tests/integration/**/*.test.{js,ts}',
    '<rootDir>/*/tests/integration/**/*.test.{js,ts}',
    '<rootDir>/**/*.integration.test.{js,ts}'
  ],
  
  // Longer timeout for integration tests
  testTimeout: 30000,
  
  // Test environment setup
  setupFilesAfterEnv: [
    '<rootDir>/tests/integration/setup.js'
  ],
  
  // Global variables for integration tests
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: 'tsconfig.json'
    },
    INTEGRATION_TEST: true
  },
  
  // Coverage settings for integration tests
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage/integration',
  
  // Enhanced caching for integration tests
  cache: true,
  cacheDirectory: '<rootDir>/.cache/jest-integration',
  collectCoverageFrom: [
    'anglesite/app/**/*.{js,ts}',
    'anglesite-11ty/**/*.{js,ts}',
    '!**/*.d.ts',
    '!**/*.test.{js,ts}',
    '!**/*.spec.{js,ts}',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**'
  ],
  
  // Integration-specific coverage thresholds (lower than unit tests)
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 35,
      lines: 40,
      statements: 40
    }
  },
  
  // Module name mapping for cross-package imports
  moduleNameMapper: {
    '^@dwk/anglesite-11ty/(.*)$': '<rootDir>/anglesite-11ty/$1',
    '^@dwk/anglesite-starter/(.*)$': '<rootDir>/anglesite-starter/$1',
    '^@dwk/web-components/(.*)$': '<rootDir>/web-components/$1'
  },
  
  // Test environment configuration
  testEnvironment: 'node',
  testEnvironmentOptions: {
    // Allow file system access for integration tests
    NODE_ENV: 'test-integration'
  },
  
  // Reporter configuration for integration test results
  reporters: ['default'],
  
  // Transform configuration for TypeScript and ES modules
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      isolatedModules: true
    }],
    '^.+\\.(js|jsx)$': ['babel-jest', {
      presets: ['@babel/preset-env']
    }]
  },
  
  // Handle ES modules
  extensionsToTreatAsEsm: ['.ts'],
  
  // Mock configuration for external dependencies
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Verbose output for better debugging
  verbose: true,
  
  // Force exit to prevent hanging tests
  forceExit: true,
  
  // Detect open handles that might prevent Jest from exiting
  detectOpenHandles: true,
  
  // Maximum number of concurrent test suites
  maxConcurrency: 3,
  
  // Maximum number of workers for parallel execution
  maxWorkers: '50%'
};