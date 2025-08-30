// ABOUTME: Central caching configuration for build tools, compilers, and test frameworks
// ABOUTME: Defines cache strategies, locations, and optimization settings for the monorepo

const path = require('path');
const os = require('os');

// Base cache directory
const cacheDir = path.join(__dirname, '.cache');

module.exports = {
  // Global cache settings
  global: {
    enabled: true,
    baseDirectory: cacheDir,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    maxSize: '2GB', // Maximum total cache size
    cleanupThreshold: 0.8 // Clean when 80% full
  },

  // TypeScript compilation cache
  typescript: {
    enabled: true,
    cacheDirectory: path.join(cacheDir, 'typescript'),
    incremental: true,
    options: {
      // TypeScript compiler options for caching
      incremental: true,
      tsBuildInfoFile: path.join(cacheDir, 'typescript', '.tsbuildinfo'),
      composite: false,
      declaration: true,
      declarationMap: true
    }
  },

  // Jest test cache
  jest: {
    enabled: true,
    cacheDirectory: path.join(cacheDir, 'jest'),
    options: {
      cache: true,
      cacheDirectory: path.join(cacheDir, 'jest'),
      clearCache: false,
      // Transform cache settings
      transformIgnorePatterns: [
        'node_modules/(?!(.*\\.mjs$))'
      ]
    }
  },

  // Webpack build cache (for Electron app)
  webpack: {
    enabled: true,
    cacheDirectory: path.join(cacheDir, 'webpack'),
    options: {
      type: 'filesystem',
      cacheDirectory: path.join(cacheDir, 'webpack'),
      buildDependencies: {
        config: [
          path.join(__dirname, 'webpack.config.js'),
          path.join(__dirname, 'webpack.dev.config.js'),
          path.join(__dirname, 'webpack.prod.config.js')
        ]
      },
      compression: 'gzip',
      hashAlgorithm: 'xxhash64'
    }
  },

  // Eleventy build cache
  eleventy: {
    enabled: true,
    cacheDirectory: path.join(cacheDir, 'eleventy'),
    options: {
      // Custom cache settings for Eleventy builds
      templateCache: true,
      dataCache: true,
      markdownCache: true
    }
  },

  // Babel compilation cache
  babel: {
    enabled: true,
    cacheDirectory: path.join(cacheDir, 'babel'),
    options: {
      cacheDirectory: path.join(cacheDir, 'babel'),
      cacheCompression: true,
      cacheIdentifier: process.env.NODE_ENV || 'development'
    }
  },

  // ESLint cache
  eslint: {
    enabled: true,
    cacheLocation: path.join(cacheDir, 'eslint', '.eslintcache'),
    options: {
      cache: true,
      cacheLocation: path.join(cacheDir, 'eslint', '.eslintcache'),
      cacheStrategy: 'content' // or 'metadata'
    }
  },

  // Prettier cache
  prettier: {
    enabled: true,
    cacheLocation: path.join(cacheDir, 'prettier', '.prettiercache'),
    options: {
      cache: true,
      cacheLocation: path.join(cacheDir, 'prettier', '.prettiercache')
    }
  },

  // NPM/Node modules cache
  npm: {
    enabled: true,
    cacheDirectory: process.env.NPM_CONFIG_CACHE || path.join(os.homedir(), '.npm'),
    options: {
      preferOffline: true,
      cacheMax: 7 * 24 * 60 * 60 * 1000, // 7 days
      fetchRetries: 3,
      fetchRetryFactor: 2
    }
  },

  // Workspace-specific cache settings
  workspaces: {
    'anglesite': {
      typescript: {
        tsBuildInfoFile: path.join(cacheDir, 'typescript', 'anglesite.tsbuildinfo')
      },
      webpack: {
        cacheDirectory: path.join(cacheDir, 'webpack', 'anglesite')
      }
    },
    'anglesite-11ty': {
      typescript: {
        tsBuildInfoFile: path.join(cacheDir, 'typescript', 'anglesite-11ty.tsbuildinfo')
      },
      eleventy: {
        cacheDirectory: path.join(cacheDir, 'eleventy', 'anglesite-11ty')
      }
    },
    'anglesite-starter': {
      eleventy: {
        cacheDirectory: path.join(cacheDir, 'eleventy', 'anglesite-starter')
      }
    },
    'web-components': {
      typescript: {
        tsBuildInfoFile: path.join(cacheDir, 'typescript', 'web-components.tsbuildinfo')
      }
    }
  },

  // Development vs Production cache strategies
  strategies: {
    development: {
      // Aggressive caching for faster development
      typescript: { incremental: true, skipLibCheck: true },
      jest: { cache: true, watchman: true },
      webpack: { cache: true },
      eslint: { cache: true }
    },
    production: {
      // Conservative caching for reliability
      typescript: { incremental: true, skipLibCheck: false },
      jest: { cache: false, watchman: false },
      webpack: { cache: false },
      eslint: { cache: false }
    },
    ci: {
      // CI-optimized caching
      typescript: { incremental: true, skipLibCheck: true },
      jest: { cache: true, maxWorkers: '50%' },
      webpack: { cache: true },
      eslint: { cache: true }
    }
  },

  // Cache warming configuration
  warming: {
    enabled: true,
    strategies: [
      'npm-install',
      'typescript-typecheck',
      'jest-dry-run',
      'webpack-analyze'
    ],
    parallel: true,
    timeout: 300000 // 5 minutes
  },

  // Cache cleanup configuration
  cleanup: {
    enabled: true,
    schedule: 'daily', // 'hourly', 'daily', 'weekly'
    strategies: [
      {
        name: 'age-based',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        directories: [
          path.join(cacheDir, 'typescript'),
          path.join(cacheDir, 'jest'),
          path.join(cacheDir, 'webpack')
        ]
      },
      {
        name: 'size-based',
        maxSize: '1GB',
        directories: [
          path.join(cacheDir, 'webpack'),
          path.join(cacheDir, 'eleventy')
        ]
      }
    ]
  },

  // Cache validation and integrity
  validation: {
    enabled: true,
    checksums: true,
    timestamps: true,
    dependencies: true
  },

  // Monitoring and analytics
  monitoring: {
    enabled: process.env.NODE_ENV !== 'test',
    metrics: [
      'cache-hits',
      'cache-misses',
      'cache-size',
      'build-time-improvement'
    ],
    reportInterval: 'daily'
  }
};