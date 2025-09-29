/**
 * @file Common webpack configuration shared between development and production builds
 * @description Contains shared configuration for entry points, TypeScript compilation,
 * static asset handling, and plugin setup for Anglesite's Electron renderer process
 * @author David W. Keith &lt;git@dwk.io&gt;
 * @since 0.1.0
 */

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const ASSET_CONFIG = require('./assets.config');

/**
 * Common webpack configuration object
 * @type {import('webpack').Configuration}
 */
module.exports = {
  /** Target Electron renderer environment */
  target: 'electron-renderer',

  /** Entry points for the application bundles */
  entry: {
    /** Main React application entry point */
    main: './src/renderer/ui/react/index.tsx',
    /** Diagnostics React application entry point */
    diagnostics: './src/renderer/diagnostics/index.tsx',
    /** CSS styles bundle including Tailwind and custom styles */
    styles: ['./src/renderer/ui/tailwind-base.css', './src/renderer/ui/default-theme.css', './src/renderer/styles.css'],
  },

  /** Module resolution configuration */
  resolve: {
    /** File extensions to resolve automatically */
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    /** Path aliases for cleaner imports */
    alias: {
      /** Root source directory alias */
      '@': path.resolve(__dirname, 'src'),
      /** React components directory alias */
      '@components': path.resolve(__dirname, 'src/renderer/ui/react/components'),
      /** Styles directory alias */
      '@styles': path.resolve(__dirname, 'src/renderer/ui'),
    },
    /** Polyfill fallbacks for Node.js modules in browser environment */
    fallback: {
      buffer: 'buffer',
      process: 'process/browser',
      stream: false,
      path: false,
      fs: false,
      crypto: false,
      os: false,
      util: false,
    },
  },

  /** Module processing rules */
  module: {
    rules: [
      /**
       * TypeScript/React files processing
       * Uses ts-loader for fast transpilation without type checking
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
            },
          },
        ],
      },

      /**
       * Static image assets (SVG, GIF, ICO)
       * Small images are inlined as base64, larger ones are copied
       */
      {
        test: /\.(svg|gif|ico)$/i,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: ASSET_CONFIG.images.inlineLimit,
          },
        },
      },

      /**
       * Font assets processing
       * All fonts are copied as separate files for better caching
       */
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },

  /** Webpack plugins configuration */
  plugins: [
    /**
     * Define global variables for browser compatibility
     * Fixes "global is not defined" errors in Electron renderer
     */
    new webpack.DefinePlugin({
      global: 'globalThis',
    }),

    /**
     * Provide global variables as fallback
     * Additional polyfills for Node.js globals in browser environment
     */
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),

    /**
     * Copy static assets to output directory
     * Copies icons while ignoring source files
     */
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src/assets/icons'),
          to: path.resolve(__dirname, 'dist/src/renderer/ui/react/assets/icons'),
          globOptions: {
            ignore: [
              '**/icon.png', // Ignore large 1024x1024 icon (318 KiB)
              '**/1024x1024.png', // Ignore large 1024x1024 icon
            ],
          },
        },
      ],
    }),
  ],

  /**
   * External dependencies that should not be bundled
   * Electron modules are provided by the runtime
   */
  externals: {
    electron: 'commonjs electron',
  },

  /**
   * Build output statistics configuration
   * Minimizes console output for cleaner builds
   */
  stats: {
    colors: true,
    modules: false,
    children: false,
    chunks: false,
    chunkModules: false,
    entrypoints: false,
  },
};
