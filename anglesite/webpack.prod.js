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
const ImageminAvifWebpackPlugin = require('imagemin-avif-webpack-plugin');
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
    path: path.resolve(__dirname, 'dist/app/ui/react'),
    filename: ASSET_CONFIG.output.naming.production.js,
    chunkFilename: '[name].[contenthash:8].chunk.js',
    publicPath: ASSET_CONFIG.output.publicPath.production,
    clean: ASSET_CONFIG.output.clean,
    assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
    sourceMapFilename: ASSET_CONFIG.sourceMaps.production.filename,
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
              configFile: path.resolve(__dirname, 'app/ui/react/tsconfig.json'),
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
     * HTML template plugin for production
     * Minifies HTML and injects optimized assets
     */
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'app/ui/templates/website-editor-react-production.html'),
      filename: 'index.html',
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
     * CSS extraction plugin for production
     * Separates CSS into cacheable files with content hashes
     */
    new MiniCssExtractPlugin({
      filename: ASSET_CONFIG.output.naming.production.css,
      chunkFilename: '[name].[contenthash:8].chunk.css',
    }),

    // WebP image optimization removed due to security vulnerabilities
    // in imagemin-webp-webpack-plugin dependency tree

    /**
     * AVIF image optimization for latest browsers
     * Next-generation format with superior compression
     */
    new ImageminAvifWebpackPlugin({
      config: [
        {
          test: /\.(jpe?g|png)$/,
          options: {
            quality: ASSET_CONFIG.images.quality.avif,
          },
        },
      ],
      overrideExtension: false,
    }),

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
     * Code splitting configuration for optimal caching
     * Separates vendor code from application code
     */
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        /**
         * Vendor chunk for third-party libraries
         * High priority to ensure consistent splitting
         */
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
          reuseExistingChunk: true,
        },

        /**
         * Common chunk for shared application code
         * Lower priority than vendor chunks
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
  },
});
