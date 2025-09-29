/**
 * @file Production webpack configuration for Anglesite
 * @description Optimized for performance, bundle size, and caching. Features minification,
 * CSS extraction, image optimization, code splitting, and production-ready source maps.
 * Merges with common configuration and adds production-specific optimizations.
 * @author David W. Keith &lt;git@dwk.io&gt;
 * @since 0.1.0
 */

const path = require('path');
const { merge } = require('webpack-merge');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
// Removed imagemin-webp-webpack-plugin due to security vulnerabilities
// const ImageminAvifWebpackPlugin = require('imagemin-avif-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const common = require('./webpack.common.js');
const ASSET_CONFIG = require('./assets.config');

/** Enable bundle analysis when ANALYZE_BUNDLE environment variable is set */
const analyzeBundle = process.env.ANALYZE_BUNDLE === 'true';

/**
 * Production webpack configuration
 * @type {import('webpack').Configuration}
 */
module.exports = merge(common, {
  /** Production mode enables optimizations and minification */
  mode: 'production',

  /**
   * Production output configuration
   * Uses content hashes for optimal browser caching
   */
  output: {
    path: path.resolve(__dirname, 'dist/src/renderer/ui/react'),
    filename: ASSET_CONFIG.output.naming.production.js,
    chunkFilename: '[name].[contenthash:8].chunk.js',
    publicPath: ASSET_CONFIG.output.publicPath.production,
    clean: ASSET_CONFIG.output.clean,
    assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
    sourceMapFilename: ASSET_CONFIG.sourceMaps.production.filename,
    globalObject: 'globalThis',
  },

  /** Production-specific module rules */
  module: {
    rules: [
      /**
       * TypeScript/React files for production
       * Optimized for smaller bundle size with production source maps
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
                sourceMap: ASSET_CONFIG.sourceMaps.production.loaders,
              },
            },
          },
        ],
      },

      /**
       * CSS files extracted to separate files for production
       * Enables better caching and parallel loading
       */
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              importLoaders: 2,
              sourceMap: ASSET_CONFIG.sourceMaps.production.css,
            },
          },
          {
            loader: 'postcss-loader',
            options: {
              sourceMap: ASSET_CONFIG.sourceMaps.production.css,
            },
          },
        ],
      },

      /**
       * Responsive images optimized for production
       * Generates multiple formats and sizes for optimal loading
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
       * Static images with production hashed filenames
       * Enables optimal caching strategies
       */
      {
        test: /\.(svg|gif|ico)$/i,
        generator: {
          filename: ASSET_CONFIG.output.naming.production.images,
        },
      },

      /**
       * Font files with production hashed filenames
       * Long-term caching with content-based hashes
       */
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        generator: {
          filename: ASSET_CONFIG.output.naming.production.fonts,
        },
      },
    ],
  },

  /** Production-specific plugins */
  plugins: [
    /**
     * HTML template plugin for main website editor
     * Minifies HTML and injects optimized assets
     */
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/renderer/ui/templates/website-editor.html'),
      filename: 'index.html',
      chunks: ['main', 'react', 'vendors', 'common', 'utils'],
      inject: 'body',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        removeStyleLinkTypeAttributes: true,
        keepClosingSlash: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true,
      },
    }),

    /**
     * HTML template plugin for diagnostics window
     * Generates optimized diagnostics.html with correct script injection
     * HTML must be in same directory as scripts for relative paths to work
     */
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/renderer/diagnostics.html'),
      filename: 'diagnostics.html', // Same directory as scripts (react folder)
      chunks: ['diagnostics', 'react', 'vendors', 'common', 'utils'],
      inject: 'body',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        removeStyleLinkTypeAttributes: true,
        keepClosingSlash: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true,
      },
    }),

    /**
     * DefinePlugin for production environment variables
     * Explicitly disables React DevTools in production
     */
    new (require('webpack').DefinePlugin)({
      'process.env.NODE_ENV': JSON.stringify('production'),
      __REACT_DEVTOOLS_GLOBAL_HOOK__: 'false',
      __DEV__: 'false',
    }),

    /**
     * CSS extraction plugin for production
     * Separates CSS into cacheable files with content hashes
     */
    new MiniCssExtractPlugin({
      filename: ASSET_CONFIG.output.naming.production.css,
      chunkFilename: '[name].[contenthash:8].chunk.css',
    }),

    // WebP image optimization removed due to security vulnerabilities
    // in imagemin-webp-webpack-plugin dependency tree

    // AVIF image optimization removed to resolve Sharp library conflicts
    // Multiple versions of @img/sharp-libvips-darwin-arm64 were causing runtime errors

    /**
     * Bundle analyzer for production builds (optional)
     * Comprehensive analysis with configurable options
     */
    analyzeBundle &&
      new BundleAnalyzerPlugin({
        analyzerMode: ASSET_CONFIG.performance.analyzer.analyzerMode,
        analyzerHost: ASSET_CONFIG.performance.analyzer.analyzerHost,
        analyzerPort: ASSET_CONFIG.performance.analyzer.analyzerPort,
        openAnalyzer: ASSET_CONFIG.performance.analyzer.openAnalyzer,
        reportFilename: ASSET_CONFIG.performance.analyzer.reportFilename,
        defaultSizes: ASSET_CONFIG.performance.analyzer.defaultSizes,
        excludeAssets: ASSET_CONFIG.performance.analyzer.excludeAssets,
        logLevel: ASSET_CONFIG.performance.analyzer.logLevel,
        generateStatsFile: ASSET_CONFIG.performance.analyzer.generateStatsFile,
        statsFilename: ASSET_CONFIG.performance.analyzer.statsFilename,
        statsOptions: ASSET_CONFIG.performance.analyzer.statsOptions,
      }),
  ].filter(Boolean),

  /**
   * Production optimization configuration
   * Enables aggressive minification and optimal code splitting
   */
  optimization: {
    /** Enable all optimization plugins */
    minimize: true,
    /** Custom minimizers for JS and CSS */
    minimizer: [
      /**
       * JavaScript minification with Terser
       * Removes console.log statements and comments
       */
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
          },
        },
      }),

      /**
       * CSS minification and optimization
       * Removes whitespace and optimizes selectors
       */
      new CssMinimizerPlugin(),
    ],

    /**
     * Enhanced code splitting configuration for optimal caching
     * Separates vendor libraries into logical chunks for better performance
     */
    splitChunks: {
      chunks: 'all',
      maxAsyncRequests: 20,
      maxInitialRequests: 10,
      cacheGroups: {
        /**
         * React ecosystem chunk (react, react-dom)
         * Critical libraries loaded immediately
         */
        react: {
          test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
          name: 'react',
          priority: 40,
          reuseExistingChunk: true,
          enforce: true,
        },

        /**
         * React JSON Schema Form chunk - async only for lazy loading
         * Form generation and validation libraries (~400KB)
         */
        rjsf: {
          test: /[\\/]node_modules[\\/]@rjsf[\\/]/,
          name: 'rjsf',
          priority: 38,
          reuseExistingChunk: true,
          chunks: 'async', // Only split async chunks (lazy imports)
          enforce: true,
          minSize: 10000,
        },

        /**
         * JSON Schema validation chunk - async only for lazy loading
         * AJV validation engine and formats (~300KB)
         */
        ajv: {
          test: /[\\/]node_modules[\\/](ajv|ajv-formats)[\\/]/,
          name: 'ajv',
          priority: 37,
          reuseExistingChunk: true,
          chunks: 'async', // Only split async chunks (lazy imports)
          enforce: true,
          minSize: 10000,
        },

        /**
         * Material-UI chunk - async only for lazy loading
         * UI components and theming (~350KB)
         */
        mui: {
          test: /[\\/]node_modules[\\/]@mui[\\/]/,
          name: 'mui',
          priority: 36,
          reuseExistingChunk: true,
          chunks: 'async', // Only split async chunks (lazy imports)
          enforce: true,
          minSize: 10000,
        },

        /**
         * Emotion styling chunk - async only for lazy loading
         * CSS-in-JS styling engine (~200KB)
         */
        emotion: {
          test: /[\\/]node_modules[\\/]@emotion[\\/]/,
          name: 'emotion',
          priority: 35,
          reuseExistingChunk: true,
          chunks: 'async', // Only split async chunks (lazy imports)
          enforce: true,
          minSize: 10000,
        },

        /**
         * JSON processing libraries chunk
         * Separate JSON-heavy dependencies for better caching
         */
        json: {
          test: /[\\/]node_modules[\\/](js-yaml|@json-editor)[\\/]/,
          name: 'json',
          priority: 28,
          reuseExistingChunk: true,
          chunks: 'all',
        },

        /**
         * Node.js utilities chunk (archiver, chokidar, glob)
         * File system and archive utilities
         */
        nodeUtils: {
          test: /[\\/]node_modules[\\/](archiver|chokidar|glob|bagit-fs)[\\/]/,
          name: 'node-utils',
          priority: 26,
          reuseExistingChunk: true,
        },

        /**
         * Fluent UI Web Components chunk - async only for lazy loading
         * Framework-agnostic design system components
         */
        fluentui: {
          test: /[\\/]node_modules[\\/]@fluentui[\\/]web-components[\\/]/,
          name: 'fluentui',
          priority: 25,
          reuseExistingChunk: true,
          chunks: 'async', // Only split async chunks (lazy imports)
          enforce: true,
        },

        /**
         * Utility libraries chunk (lodash)
         * Common utilities separated for better caching
         */
        utils: {
          test: /[\\/]node_modules[\\/](lodash|lodash-es)[\\/]/,
          name: 'utils',
          priority: 25,
          reuseExistingChunk: true,
        },

        /**
         * Remaining vendor chunk for other third-party libraries
         * Lower priority catches everything else
         */
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
          reuseExistingChunk: true,
        },

        /**
         * Common chunk for shared application code
         * Lowest priority for application code
         */
        common: {
          name: 'common',
          minChunks: 2,
          priority: 5,
          reuseExistingChunk: true,
        },
      },
    },

    /**
     * Runtime chunk extraction for better caching
     * Webpack runtime code in separate file
     */
    runtimeChunk: {
      name: 'runtime',
    },
  },

  /**
   * Production source maps for debugging
   * Separate files to avoid impacting bundle size
   */
  devtool: ASSET_CONFIG.sourceMaps.production.devtool,

  /**
   * Performance budgets and warnings
   * Helps identify bundle size issues early
   */
  performance: {
    hints: ASSET_CONFIG.performance.hints,
    maxEntrypointSize: ASSET_CONFIG.performance.maxEntrypointSize,
    maxAssetSize: ASSET_CONFIG.performance.maxAssetSize,
    // Exclude non-web assets from performance checks:
    // - .icns/.ico: Platform-specific icons for app packaging
    // - .map: Source map files for debugging (not loaded by users)
    assetFilter: function (assetFilename) {
      return !/\.(icns|ico|map)$/.test(assetFilename);
    },
  },
});
