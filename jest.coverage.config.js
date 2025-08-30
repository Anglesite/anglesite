/**
 * @file Root Jest coverage configuration for @dwk workspace
 * ABOUTME: Provides comprehensive coverage reporting across all workspace packages
 * ABOUTME: Consolidates coverage thresholds and reporting for the entire monorepo
 */

const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  
  // Enable coverage collection
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  
  // Enhanced caching for coverage runs
  cache: true,
  cacheDirectory: '<rootDir>/.cache/jest-coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],

  // Global coverage thresholds - set to current realistic levels
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 55, 
      lines: 60,
      statements: 60,
    },
    // Per-package thresholds (only for packages with tests)
    './anglesite/': {
      branches: 35,
      functions: 37,
      lines: 41,
      statements: 41,
    },
    './anglesite-11ty/': {
      branches: 65,
      functions: 80,
      lines: 75,
      statements: 75,
    },
    // Note: anglesite-starter and web-components don't have tests yet
  },

  // Coverage-specific test settings with per-project coverage patterns
  projects: baseConfig.projects.map(project => ({
    ...project,
    // Enable coverage only for projects with tests
    collectCoverage: ['@dwk/anglesite', '@dwk/anglesite-11ty'].includes(project.displayName),
    // Workspace-specific coverage patterns
    ...(project.displayName === '@dwk/anglesite' && {
      collectCoverageFrom: [
        'app/**/*.ts',
        '!app/**/*.d.ts',
        '!app/**/*.test.ts',
        '!app/**/*.spec.ts',
        '!app/renderer.ts',
        '!app/renderer-wrapper.ts', 
        '!app/theme-renderer.ts',
      ],
    }),
    ...(project.displayName === '@dwk/anglesite-11ty' && {
      collectCoverageFrom: [
        'plugins/**/*.{ts,tsx}',
        'types/**/*.{ts,tsx}',
        'src/**/*.{js,ts}',
        '!**/*.d.ts',
        '!**/node_modules/**',
        '!**/dist/**',
        '!**/coverage/**',
      ],
    }),
    ...(project.displayName === '@dwk/anglesite-starter' && {
      collectCoverageFrom: [
        '**/*.{js,ts}',
        '!**/*.d.ts',
        '!**/node_modules/**',
        '!**/_site/**',
        '!**/dist/**',
      ],
    }),
    ...(project.displayName === '@dwk/web-components' && {
      collectCoverageFrom: [
        'components/**/*.{js,ts}',
        'src/**/*.{js,ts}',
        '!**/*.d.ts',
        '!**/node_modules/**',
        '!**/_site/**',
        '!**/dist/**',
      ],
    }),
    // Exclude slow/problematic tests from coverage runs
    testPathIgnorePatterns: [
      ...(project.testPathIgnorePatterns || []),
      '/integration/',
      'test/app/certificates.test.ts',
    ],
    // Optimize for coverage collection
    maxWorkers: '50%',
    testTimeout: project.displayName === '@dwk/anglesite' ? 30000 : 15000,
  })),
};