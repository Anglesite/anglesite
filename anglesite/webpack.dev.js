/**
 * @file Development webpack configuration for Anglesite
 * @description Optimized for fast rebuilds, hot module replacement, and debugging experience.
 * Merges with common configuration and adds development-specific settings like dev server,
 * React Fast Refresh, and unoptimized source maps for better debugging.
 * @author David W. Keith &lt;git@dwk.io&gt;
 * @since 0.1.0
 */

const path = require('path');
const { merge } = require('webpack-merge');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const common = require('./webpack.common.js');
const ASSET_CONFIG = require('./assets.config');

/** Enable bundle analysis for development builds when requested */
const analyzeBundle = process.env.ANALYZE_BUNDLE === 'true';

/** Check if we're running webpack-dev-server or just building */
const isDevServer = process.env.WEBPACK_SERVE === 'true';

/**
 * Development webpack configuration
 * @type {import('webpack').Configuration}
 */
module.exports = merge(common, {
  /** Development mode for faster builds and better debugging */
  mode: 'development',

  /**
   * Development output configuration
   * Uses simple filenames without hashes for faster rebuilds
   */
  output: {
    path: path.resolve(__dirname, 'dist/src/renderer/ui/react'),
    filename: ASSET_CONFIG.output.naming.development.js,
    chunkFilename: '[name].chunk.js',
    publicPath: ASSET_CONFIG.output.publicPath.development,
    clean: ASSET_CONFIG.output.clean,
    assetModuleFilename: 'assets/[name][ext]',
  },

  /** Development-specific module rules */
  module: {
    rules: [
      /**
       * TypeScript/React files with React Fast Refresh support
       * Enables hot reloading of React components without losing state
       */
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              configFile: path.resolve(__dirname, 'src/renderer/ui/react/tsconfig.json'),
              compilerOptions: {
                sourceMap: ASSET_CONFIG.sourceMaps.development.loaders,
              },
              getCustomTransformers: () => ({
                before: [require('react-refresh/babel').transform].filter(Boolean),
              }),
            },
          },
        ],
      },

      /**
       * CSS files with style-loader for hot module replacement
       * Injects CSS directly into the DOM for faster development feedback
       */
      {
        test: /\.css$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              importLoaders: 2,
              sourceMap: ASSET_CONFIG.sourceMaps.development.css,
            },
          },
          {
            loader: 'postcss-loader',
            options: {
              sourceMap: ASSET_CONFIG.sourceMaps.development.css,
            },
          },
        ],
      },

      /**
       * Responsive images with Sharp adapter
       * Generates multiple image sizes for different screen densities
       */
      {
        test: /\.(png|jpg|jpeg)$/i,
        use: [
          {
            loader: 'responsive-loader',
            options: {
              adapter: require('responsive-loader/sharp'),
              sizes: ASSET_CONFIG.images.breakpoints,
              placeholder: true,
              placeholderSize: 40,
              quality: ASSET_CONFIG.images.quality.jpeg,
              format: 'jpg',
            },
          },
        ],
        type: 'javascript/auto',
      },

      /**
       * Static images (SVG, GIF, ICO) with development naming
       * Uses simple filenames for easier debugging
       */
      {
        test: /\.(svg|gif|ico)$/i,
        generator: {
          filename: ASSET_CONFIG.output.naming.development.images,
        },
      },

      /**
       * Font files with development naming
       * Simple names for faster rebuilds and debugging
       */
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        generator: {
          filename: ASSET_CONFIG.output.naming.development.fonts,
        },
      },
    ],
  },

  /** Development-specific plugins */
  plugins: [
    /**
     * HTML template plugin for development
     * Uses HMR-enabled template with unminified output for debugging
     */
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/renderer/ui/templates/website-editor-react-hmr.html'),
      filename: 'index.html',
      inject: 'body',
      minify: false,
    }),

    /**
     * React Fast Refresh plugin for hot reloading
     * Only included when running dev server (not for builds)
     */
    isDevServer &&
      new ReactRefreshWebpackPlugin({
        overlay: {
          sockIntegration: 'whm',
        },
      }),

    /**
     * Bundle analyzer for development builds (optional)
     * Useful for analyzing development bundle sizes and dependencies
     */
    analyzeBundle &&
      new BundleAnalyzerPlugin({
        analyzerMode: ASSET_CONFIG.performance.analyzer.analyzerMode,
        analyzerHost: ASSET_CONFIG.performance.analyzer.analyzerHost,
        analyzerPort: ASSET_CONFIG.performance.analyzer.analyzerPort + 1, // Use different port for dev
        openAnalyzer: ASSET_CONFIG.performance.analyzer.openAnalyzer,
        reportFilename: 'bundle-report-dev.html',
        defaultSizes: 'stat', // Use raw sizes for development analysis
        excludeAssets: ASSET_CONFIG.performance.analyzer.excludeAssets,
        logLevel: ASSET_CONFIG.performance.analyzer.logLevel,
      }),
  ].filter(Boolean), // Filter out false plugins when not using dev server

  /**
   * Webpack Dev Server configuration for development
   * Optimized for Electron development with HMR and proxy support
   */
  devServer: {
    /** Development server port */
    port: 3000,
    /** Bind to localhost for security */
    host: '127.0.0.1',
    /** Enable hot module replacement */
    hot: true,
    /** Enable live reloading as fallback */
    liveReload: true,
    /** Enable gzip compression */
    compress: true,
    /** Don't auto-open browser since this is for Electron */
    open: false,

    /** Static file serving configuration from assets config */
    static: ASSET_CONFIG.devServer.static,

    /** CORS headers for development */
    headers: ASSET_CONFIG.devServer.headers,

    /** Client-side dev server configuration */
    client: {
      /** Console logging level */
      logging: 'info',
      /** Show build progress */
      progress: true,
      /** Error overlay configuration */
      overlay: {
        errors: true,
        warnings: false,
        runtimeErrors: true,
      },
      /** WebSocket URL for HMR connection */
      webSocketURL: {
        hostname: '127.0.0.1',
        pathname: '/ws',
        port: 3000,
        protocol: 'ws',
      },
    },

    /** Development middleware configuration */
    devMiddleware: {
      stats: 'minimal',
      writeToDisk: false,
    },

    /**
     * Proxy configuration for backend services
     * Routes API and Eleventy requests to local backend
     */
    proxy: [
      {
        context: ['/api', '/eleventy'],
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
        logLevel: 'debug',
        onProxyReq: (proxyReq, req) => {
          console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyReq.path}`);
        },
        onError: (err) => {
          console.error('[Proxy Error]', err.message);
        },
      },
    ],

    /**
     * Enhanced file watching configuration for hot reloading
     * Optimized patterns and debouncing for better performance
     */
    watchFiles: {
      paths: [
        'src/renderer/ui/react/**/*.{ts,tsx,js,jsx}',
        'src/main/ui/templates/**/*.html',
        'src/main/ui/**/*.css',
        'src/main/main.ts',
        'src/main/preload.ts',
        'src/renderer/renderer.ts',
      ],
      options: {
        usePolling: false,
        interval: 300, // Faster polling for responsive development
        ignored: [/node_modules/, /\.git/, /dist/, /coverage/, /\.DS_Store/, /\.tmp/, /\.log/],
        // Add stabilization threshold to prevent duplicate events
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      },
    },

    /**
     * History API fallback for SPA routing
     * Serves index.html for client-side routes
     */
    historyApiFallback: {
      index: '/index.html',
      disableDotRule: true,
    },
  },

  /**
   * Source maps for development debugging
   * Uses fast eval-based source maps for quick rebuilds
   */
  devtool: ASSET_CONFIG.sourceMaps.development.devtool,

  /**
   * Performance hints disabled for development
   * Large bundles are acceptable during development
   */
  performance: {
    hints: false,
  },
});
