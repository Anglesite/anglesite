const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const ImageminWebpWebpackPlugin = require('imagemin-webp-webpack-plugin');
const ImageminAvifWebpackPlugin = require('imagemin-avif-webpack-plugin');
const webpack = require('webpack');
const ASSET_CONFIG = require('./assets.config');

const isDevelopment = process.env.NODE_ENV !== 'production';
const analyzeBundle = process.env.ANALYZE_BUNDLE === 'true';

module.exports = {
  mode: isDevelopment ? 'development' : 'production',
  target: 'electron-renderer',
  entry: {
    main: './app/ui/react/index.tsx',
    styles: ['./app/ui/tailwind-base.css', './app/ui/default-theme.css', './app/styles.css'],
  },

  output: {
    path: path.resolve(__dirname, 'dist/app/ui/react'),
    filename: ASSET_CONFIG.output.naming[isDevelopment ? 'development' : 'production'].js,
    chunkFilename: isDevelopment ? '[name].chunk.js' : '[name].[contenthash:8].chunk.js',
    publicPath: ASSET_CONFIG.output.publicPath[isDevelopment ? 'development' : 'production'],
    clean: ASSET_CONFIG.output.clean,
    assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
    sourceMapFilename: !isDevelopment ? ASSET_CONFIG.sourceMaps.production.filename : undefined,
  },

  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@': path.resolve(__dirname, 'app'),
      '@components': path.resolve(__dirname, 'app/ui/react/components'),
      '@styles': path.resolve(__dirname, 'app/ui'),
    },
  },

  module: {
    rules: [
      // TypeScript/React files
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
                sourceMap: ASSET_CONFIG.sourceMaps[isDevelopment ? 'development' : 'production'].loaders,
              },
              getCustomTransformers: () => ({
                before: [isDevelopment && require('react-refresh/babel').transform].filter(Boolean),
              }),
            },
          },
        ],
      },

      // CSS files
      {
        test: /\.css$/,
        use: [
          isDevelopment ? 'style-loader' : MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              importLoaders: 2,
              sourceMap: ASSET_CONFIG.sourceMaps[isDevelopment ? 'development' : 'production'].css,
            },
          },
          {
            loader: 'postcss-loader',
            options: {
              sourceMap: ASSET_CONFIG.sourceMaps[isDevelopment ? 'development' : 'production'].css,
            },
          },
        ],
      },

      // Images with responsive-loader for responsive images
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

      // SVG and other images
      {
        test: /\.(svg|gif|ico)$/i,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: ASSET_CONFIG.images.inlineLimit,
          },
        },
        generator: {
          filename: ASSET_CONFIG.output.naming[isDevelopment ? 'development' : 'production'].images,
        },
      },

      // Fonts
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: ASSET_CONFIG.output.naming[isDevelopment ? 'development' : 'production'].fonts,
        },
      },

    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: isDevelopment
        ? path.resolve(__dirname, 'app/ui/templates/website-editor-react-hmr.html')
        : path.resolve(__dirname, 'app/ui/templates/website-editor-react-production.html'),
      filename: 'index.html',
      inject: 'body',
      minify: !isDevelopment
        ? {
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
          }
        : false,
    }),

    // Extract CSS in production
    !isDevelopment &&
      new MiniCssExtractPlugin({
        filename: ASSET_CONFIG.output.naming.production.css,
        chunkFilename: '[name].[contenthash:8].chunk.css',
      }),

    // Copy static assets
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

    // React Fast Refresh for development
    isDevelopment &&
      new ReactRefreshWebpackPlugin({
        overlay: {
          sockIntegration: 'whm',
        },
      }),

    // Image optimization plugins for production
    !isDevelopment &&
      new ImageminWebpWebpackPlugin({
        config: [
          {
            test: /\.(jpe?g|png)$/,
            options: {
              quality: ASSET_CONFIG.images.quality.webp,
            },
          },
        ],
        overrideExtension: false,
      }),

    !isDevelopment &&
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

    // Bundle analyzer for build analysis
    analyzeBundle &&
      new BundleAnalyzerPlugin({
        analyzerMode: 'server',
        openAnalyzer: ASSET_CONFIG.performance.analyzer.openAnalyzer,
      }),

  ].filter(Boolean),

  optimization: {
    minimize: !isDevelopment,
    minimizer: [
      // Minify JavaScript
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: !isDevelopment,
          },
        },
      }),
      // Minify CSS
      new CssMinimizerPlugin(),
    ],

    // Split chunks for better caching
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
          reuseExistingChunk: true,
        },
        common: {
          name: 'common',
          minChunks: 2,
          priority: 5,
          reuseExistingChunk: true,
        },
      },
    },

    // Runtime chunk for better long-term caching
    runtimeChunk: {
      name: 'runtime',
    },
  },

  // Development server configuration
  devServer: isDevelopment
    ? {
        port: 3000,
        host: '127.0.0.1',
        hot: true,
        liveReload: true,
        compress: true,
        open: false, // Don't auto-open browser since this is for Electron

        static: [
          {
            directory: path.join(__dirname, 'dist/app/ui/react'),
            publicPath: '/',
          },
          {
            directory: path.join(__dirname, 'app/ui'),
            publicPath: '/ui',
          },
        ],

        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
        },

        client: {
          logging: 'info',
          progress: true,
          overlay: {
            errors: true,
            warnings: false,
            runtimeErrors: true,
          },
          webSocketURL: {
            hostname: '127.0.0.1',
            pathname: '/ws',
            port: 3000,
            protocol: 'ws',
          },
        },

        devMiddleware: {
          stats: 'minimal',
          writeToDisk: false,
        },

        // Proxy configuration for API calls or backend services
        proxy: [
          {
            context: ['/api', '/eleventy'],
            target: 'http://127.0.0.1:8080', // Adjust to your backend server port
            changeOrigin: true,
            secure: false,
            logLevel: 'debug',
            onProxyReq: (proxyReq, req, res) => {
              console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyReq.path}`);
            },
            onError: (err, req, res) => {
              console.error('[Proxy Error]', err.message);
            },
          },
        ],

        // Watch options for better file watching
        watchFiles: {
          paths: ['app/**/*', 'app/ui/templates/**/*.html', 'app/ui/react/**/*'],
          options: {
            usePolling: false,
            interval: 1000,
            ignored: /node_modules/,
          },
        },

        // History API fallback for SPA routing
        historyApiFallback: {
          index: '/index.html',
          disableDotRule: true,
        },
      }
    : undefined,

  // Source maps configuration
  devtool: isDevelopment 
    ? ASSET_CONFIG.sourceMaps.development.devtool 
    : ASSET_CONFIG.sourceMaps.production.devtool, // Dynamic source map type for production

  // Performance hints
  performance: {
    hints: isDevelopment ? false : ASSET_CONFIG.performance.hints,
    maxEntrypointSize: ASSET_CONFIG.performance.maxEntrypointSize,
    maxAssetSize: ASSET_CONFIG.performance.maxAssetSize,
  },

  // External dependencies (don't bundle these)
  externals: {
    electron: 'commonjs electron',
  },

  // Stats configuration
  stats: {
    colors: true,
    modules: false,
    children: false,
    chunks: false,
    chunkModules: false,
    entrypoints: false,
  },
};
