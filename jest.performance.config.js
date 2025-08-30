// ABOUTME: Jest configuration for performance testing and benchmarking across packages
// ABOUTME: Enables performance regression detection with automated baseline comparisons

const baseConfig = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  
  // Performance test specific settings
  displayName: 'Performance Tests',
  testMatch: [
    '<rootDir>/tests/performance/**/*.perf.{js,ts}',
    '<rootDir>/*/tests/performance/**/*.perf.{js,ts}',
    '<rootDir>/**/*.performance.test.{js,ts}'
  ],
  
  // Extended timeout for performance tests
  testTimeout: 60000, // 60 seconds
  
  // Test environment setup
  setupFilesAfterEnv: [
    '<rootDir>/tests/performance/setup.js'
  ],
  
  // Performance test globals
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: 'tsconfig.json'
    },
    PERFORMANCE_TEST: true,
    BENCHMARK_ITERATIONS: parseInt(process.env.BENCHMARK_ITERATIONS || '10'),
    PERFORMANCE_THRESHOLD_MS: parseInt(process.env.PERFORMANCE_THRESHOLD_MS || '1000')
  },
  
  // No coverage collection for performance tests (affects timing)
  collectCoverage: false,
  
  // Enhanced caching for performance tests
  cache: true,
  cacheDirectory: '<rootDir>/.cache/jest-performance',
  
  // Test environment configuration
  testEnvironment: 'node',
  testEnvironmentOptions: {
    NODE_ENV: 'test-performance'
  },
  
  // Specialized reporters for performance
  reporters: ['default'],
  
  // Transform configuration
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      isolatedModules: true
    }],
    '^.+\\.(js|jsx)$': ['babel-jest', {
      presets: ['@babel/preset-env']
    }]
  },
  
  // Module configuration for performance tests
  moduleNameMapper: {
    '^@dwk/anglesite-11ty/(.*)$': '<rootDir>/anglesite-11ty/$1',
    '^@dwk/anglesite-starter/(.*)$': '<rootDir>/anglesite-starter/$1',
    '^@dwk/web-components/(.*)$': '<rootDir>/web-components/$1'
  },
  
  // Performance test specific settings
  maxConcurrency: 1, // Run performance tests sequentially
  maxWorkers: 1,     // Single worker for consistent results
  
  // Clear mocks and timers
  clearMocks: true,
  restoreMocks: true,
  
  // Verbose output for performance metrics
  verbose: true,
  
  // Force exit to prevent hanging
  forceExit: true,
  
  // Detect handles that prevent exit
  detectOpenHandles: true,
  
  // Note: setupFilesAfterEnv is defined above at line 23
};