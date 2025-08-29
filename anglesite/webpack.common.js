/**
 * @file Common webpack configuration shared between development and production builds
 * @description Contains shared configuration for entry points, TypeScript compilation,
 * static asset handling, and plugin setup for Anglesite's Electron renderer process
 * @author David W. Keith &lt;git@dwk.io&gt;
 * @since 0.1.0
 */

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const ASSET_CONFIG = require('./assets.config');

/**
 * Common webpack configuration object
 * @type {import('webpack').Configuration}
 */
module.exports = {
  /** Target Electron's renderer process for proper module resolution */
  target: 'electron-renderer',

  /** Entry points for the application bundles */
  entry: {
    /** Main React application entry point */
    main: './app/ui/react/index.tsx',
    /** CSS styles bundle including Tailwind and custom styles */
    styles: ['./app/ui/tailwind-base.css', './app/ui/default-theme.css', './app/styles.css'],
  },

  /** Module resolution configuration */
  resolve: {
    /** File extensions to resolve automatically */
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    /** Path aliases for cleaner imports */
    alias: {
      /** Root application directory alias */
      '@': path.resolve(__dirname, 'app'),
      /** React components directory alias */
      '@components': path.resolve(__dirname, 'app/ui/react/components'),
      /** Styles directory alias */
      '@styles': path.resolve(__dirname, 'app/ui'),
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
              configFile: path.resolve(__dirname, 'app/ui/react/tsconfig.json'),
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
     * Copy static assets to output directory
     * Copies icons while ignoring source files
     */
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'icons'),
          to: path.resolve(__dirname, 'dist/app/ui/react/assets/icons'),
          globOptions: {
            ignore: ['**/src/**'], // Ignore source SVG files
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
