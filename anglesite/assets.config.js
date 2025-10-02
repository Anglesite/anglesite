// Asset pipeline configuration for Anglesite
const path = require('path');

const ASSET_CONFIG = {
  // Image optimization settings
  images: {
    // Responsive image breakpoints
    breakpoints: [320, 640, 768, 1024, 1280, 1536],

    // Image formats to generate
    formats: ['webp', 'avif', 'jpeg', 'png'],

    // Quality settings per format
    quality: {
      jpeg: 85,
      png: 90,
      webp: 80,
      avif: 75,
    },

    // Size limits for inline images (base64)
    inlineLimit: 8 * 1024, // 8KB
  },

  // Font optimization settings
  fonts: {
    // Font formats to support
    formats: ['woff2', 'woff'],

    // Font preload settings
    preload: {
      enabled: true,
      crossorigin: 'anonymous',
    },

    // Font display strategy
    display: 'swap',

    // Subset configuration
    subset: {
      enabled: true,
      unicodeRanges: {
        latin:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
        'latin-ext': 'U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    },
  },

  // CSS optimization settings
  css: {
    // PostCSS configuration
    postcss: {
      autoprefixer: {
        grid: true,
        flexbox: 'no-2009',
      },

      // CSS custom properties
      customProperties: {
        preserve: true,
        exportTo: 'src/main/ui/css-custom-properties.json',
      },

      // CSS nesting
      nesting: true,

      // CSS color functions
      colorFunction: true,
    },

    // CSS purging for production
    purge: {
      enabled: true,
      content: [
        'src/**/*.{js,ts,jsx,tsx,html}',
        'src/main/ui/**/*.{js,ts,jsx,tsx,html}',
        'src/main/ui/templates/**/*.html',
        'src/renderer/ui/react/**/*.{js,ts,jsx,tsx}',
      ],
      safelist: [
        // Always keep these classes
        /^hljs-/, // Syntax highlighting
        /^ace_/, // Code editor
        /^btn-/, // Custom button variants
        /^card-/, // Custom card variants
      ],
    },
  },

  // Build output settings
  output: {
    // Asset naming patterns
    naming: {
      development: {
        js: '[name].js',
        css: '[name].css',
        images: '[name][ext]',
        fonts: 'fonts/[name][ext]',
      },
      production: {
        js: '[name].[contenthash:8].js',
        css: '[name].[contenthash:8].css',
        images: 'images/[name].[contenthash:8][ext]',
        fonts: 'fonts/[name].[contenthash:8][ext]',
      },
    },

    // Public path settings
    publicPath: {
      development: '/',
      production: '',
    },

    // Clean output directory disabled - using pre-build script instead
    // to avoid webpack race condition (ENOTEMPTY errors)
    clean: false,
  },

  // Performance settings - adjusted for Electron desktop app
  performance: {
    // Asset size warnings - more lenient for desktop apps with local loading
    hints: 'warning',
    maxEntrypointSize: 1200000, // 1.2MB - reasonable for desktop app initial load
    maxAssetSize: 800000, // 800KB - allows for vendor chunks in desktop environment

    // Bundle analysis configuration
    analyzer: {
      // Enable analyzer based on environment variable
      enabled: process.env.ANALYZE_BUNDLE === 'true',

      // Analysis mode: 'server', 'static', 'json', or 'disabled'
      analyzerMode: process.env.ANALYZER_MODE || 'server',

      // Automatically open analyzer in browser (server mode only)
      openAnalyzer: process.env.ANALYZER_OPEN !== 'false',

      // Host and port for analyzer server
      analyzerHost: process.env.ANALYZER_HOST || '127.0.0.1',
      analyzerPort: parseInt(process.env.ANALYZER_PORT || '8888'),

      // Report file path for static mode
      reportFilename: process.env.ANALYZER_REPORT || 'bundle-report.html',

      // Default sizes to show: 'stat', 'parsed', or 'gzip'
      defaultSizes: process.env.ANALYZER_SIZES || 'parsed',

      // Exclude source maps from analysis
      excludeAssets: /\.map$/,

      // Log level: 'info', 'warn', 'error', or 'silent'
      logLevel: process.env.ANALYZER_LOG_LEVEL || 'info',

      // Generate JSON report for CI/automated analysis
      generateStatsFile: process.env.ANALYZER_GENERATE_STATS === 'true',
      statsFilename: 'bundle-stats.json',

      // Advanced options for detailed analysis
      statsOptions: {
        source: false,
        modules: true,
        chunks: true,
        chunkModules: true,
        chunkOrigins: true,
        assets: true,
        assetsSort: 'size',
        reasons: true,
        usedExports: true,
        providedExports: true,
        optimizationBailout: true,
        errorDetails: true,
        publicPath: true,
      },
    },
  },

  // Source map configuration - optimized for development speed and production debugging
  sourceMaps: {
    development: {
      // eval-cheap-module-source-map: Fastest rebuild times with good debugging support
      // - Uses eval() for fast rebuilds
      // - No column mappings (cheaper)
      // - Preserves original source structure (module)
      // - Perfect for TypeScript/JSX debugging during development
      devtool: 'eval-cheap-module-source-map',

      // CSS source maps for development debugging
      css: true,

      // Enable source maps for all loaders (ts-loader, css-loader, etc.)
      loaders: true,
    },
    production: {
      // source-map vs hidden-source-map: Choose based on deployment security needs
      // - source-map: Full debugging capability with references in bundle
      // - hidden-source-map: No bundle references, more secure for public distribution
      devtool: process.env.ELECTRON_IS_PACKAGED ? 'hidden-source-map' : 'source-map',

      // CSS source maps for production debugging (separate files)
      css: true,

      // Selective node_modules inclusion - exclude most but allow critical debugging deps
      exclude: [/node_modules\/(?!(react|react-dom|@dwk\/anglesite-))/],

      // Source map file naming pattern - now handled by SourceMapDevToolPlugin
      filename: '[file].map[query]',

      // Security headers for source map files
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=0',
      },

      // Source map validation during build
      validation: {
        enabled: process.env.VALIDATE_SOURCE_MAPS === 'true',
        checkIntegrity: true,
        reportMissing: true,
      },

      // Enhanced error tracking service integration
      upload: {
        enabled: process.env.UPLOAD_SOURCE_MAPS === 'true',
        service: process.env.ERROR_TRACKING_SERVICE || 'sentry',
        apiKey: process.env.SOURCEMAP_API_KEY,
        release: process.env.APP_VERSION || require('../package.json').version,
        urlPrefix: '~/src/', // Proper stack trace mapping prefix
        deleteAfterUpload: process.env.DELETE_SOURCEMAPS_AFTER_UPLOAD === 'true',
      },
    },
  },

  // Development server settings
  devServer: {
    // Asset serving
    static: [
      {
        directory: path.join(__dirname, 'dist/src/renderer/ui/react'),
        publicPath: '/',
      },
      {
        directory: path.join(__dirname, 'src/main/ui'),
        publicPath: '/ui',
      },
      {
        directory: path.join(__dirname, 'src/assets/icons'),
        publicPath: '/icons',
      },
    ],

    // Hot reload settings
    hot: true,
    liveReload: true,

    // Asset compression
    compress: true,

    // CORS headers
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
    },
  },
};

module.exports = ASSET_CONFIG;
