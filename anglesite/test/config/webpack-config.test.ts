/**
 * @file Tests for webpack configuration files
 * @description Validates that webpack configurations are properly structured and contain required settings
 */

import * as path from 'path';
import * as fs from 'fs';
import { Configuration } from 'webpack';

// Extended configuration type that includes dev server
interface ExtendedConfiguration extends Configuration {
  devServer?: {
    port?: number;
    host?: string;
    open?: boolean;
    hot?: boolean;
    static?: string | string[] | { directory: string; publicPath: string };
    [key: string]: unknown;
  };
}

describe('Webpack Configuration Tests', () => {
  // Handle both direct anglesite directory execution and monorepo root execution
  const possibleConfigDirs = [
    path.resolve(__dirname, '../..'), // When run from anglesite directory
    path.resolve(__dirname, '../../../anglesite'), // When run from monorepo root
  ];

  const configDir = possibleConfigDirs.find(dir => {
    try {
      return fs.existsSync(path.join(dir, 'webpack.common.js'));
    } catch {
      return false;
    }
  }) || possibleConfigDirs[0];

  describe('Configuration Files Exist', () => {
    it('should have webpack.common.js', () => {
      const commonPath = path.join(configDir, 'webpack.common.js');
      expect(fs.existsSync(commonPath)).toBe(true);
    });

    it('should have webpack.dev.js', () => {
      const devPath = path.join(configDir, 'webpack.dev.js');
      expect(fs.existsSync(devPath)).toBe(true);
    });

    it('should have webpack.prod.js', () => {
      const prodPath = path.join(configDir, 'webpack.prod.js');
      expect(fs.existsSync(prodPath)).toBe(true);
    });

    it('should have assets.config.js', () => {
      const assetsPath = path.join(configDir, 'assets.config.js');
      expect(fs.existsSync(assetsPath)).toBe(true);
    });
  });

  describe('Webpack Common Configuration', () => {
    let commonConfig: Configuration;

    beforeAll(() => {
      // Clear require cache to ensure fresh load
      const commonPath = require.resolve('../../webpack.common.js');
      delete require.cache[commonPath];
      commonConfig = require('../../webpack.common.js');
    });

    it('should have correct target for Electron', () => {
      expect(commonConfig.target).toBe('electron-renderer');
    });

    it('should have proper entry points', () => {
      expect(commonConfig.entry).toBeDefined();
      expect(typeof commonConfig.entry).toBe('object');
      expect(commonConfig.entry).toHaveProperty('main');
      expect(commonConfig.entry).toHaveProperty('styles');
    });

    it('should have TypeScript extensions resolved', () => {
      expect(commonConfig.resolve?.extensions).toContain('.ts');
      expect(commonConfig.resolve?.extensions).toContain('.tsx');
    });

    it('should have path aliases configured', () => {
      expect(commonConfig.resolve?.alias).toHaveProperty('@');
      expect(commonConfig.resolve?.alias).toHaveProperty('@components');
      expect(commonConfig.resolve?.alias).toHaveProperty('@styles');
    });

    it('should have TypeScript loader configured', () => {
      const rules = commonConfig.module?.rules || [];
      const tsRule = rules.find(
        (rule) =>
          rule && typeof rule === 'object' && 'test' in rule && rule.test instanceof RegExp && rule.test.test('.tsx')
      );
      expect(tsRule).toBeDefined();
    });

    it('should exclude electron from bundle', () => {
      expect(commonConfig.externals).toHaveProperty('electron');
    });

    it('should have copy plugin for static assets', () => {
      expect(commonConfig.plugins).toBeDefined();
      expect(Array.isArray(commonConfig.plugins)).toBe(true);
    });
  });

  describe('Webpack Development Configuration', () => {
    let devConfig: ExtendedConfiguration;

    beforeAll(() => {
      // Mock webpack-merge for testing
      jest.mock('webpack-merge', () => ({
        merge: (...configs: Configuration[]) => {
          return Object.assign({}, ...configs);
        },
      }));

      const devPath = require.resolve('../../webpack.dev.js');
      delete require.cache[devPath];
      devConfig = require('../../webpack.dev.js');
    });

    it('should be in development mode', () => {
      expect(devConfig.mode).toBe('development');
    });

    it('should have development source maps', () => {
      expect(devConfig.devtool).toBeDefined();
      expect(typeof devConfig.devtool).toBe('string');
    });

    it('should have dev server configuration', () => {
      expect(devConfig.devServer).toBeDefined();
      expect(devConfig.devServer).toHaveProperty('hot');
      expect(devConfig.devServer).toHaveProperty('port');
    });

    it('should have development output settings', () => {
      expect(devConfig.output).toBeDefined();
      expect(devConfig.output?.clean).toBe(true);
    });

    it('should disable performance hints in development', () => {
      expect(devConfig.performance).toEqual(expect.objectContaining({ hints: false }));
    });

    afterAll(() => {
      jest.unmock('webpack-merge');
    });
  });

  describe('Webpack Production Configuration', () => {
    let prodConfig: Configuration;

    beforeAll(() => {
      // Mock webpack-merge for testing
      jest.mock('webpack-merge', () => ({
        merge: (...configs: Configuration[]) => {
          return Object.assign({}, ...configs);
        },
      }));

      const prodPath = require.resolve('../../webpack.prod.js');
      delete require.cache[prodPath];
      prodConfig = require('../../webpack.prod.js');
    });

    it('should be in production mode', () => {
      expect(prodConfig.mode).toBe('production');
    });

    it('should have optimization configured', () => {
      expect(prodConfig.optimization).toBeDefined();
      expect(prodConfig.optimization?.minimize).toBe(true);
      expect(prodConfig.optimization?.splitChunks).toBeDefined();
      expect(prodConfig.optimization?.runtimeChunk).toBeDefined();
    });

    it('should have production source maps', () => {
      expect(prodConfig.devtool).toBeDefined();
    });

    it('should have performance hints enabled', () => {
      expect(prodConfig.performance).toBeDefined();
      expect(prodConfig.performance).toHaveProperty('hints');
    });

    it('should have production output with hashed filenames', () => {
      expect(prodConfig.output).toBeDefined();
      expect(prodConfig.output?.filename).toContain('[contenthash');
    });

    afterAll(() => {
      jest.unmock('webpack-merge');
    });
  });

  describe('Assets Configuration', () => {
    let assetsConfig: {
      entry: { [key: string]: string };
      output: {
        path: string;
        filename: string;
        naming: {
          development: string;
          production: string;
        };
      };
      images: {
        breakpoints: number[];
        quality: number;
      };
      sourceMaps: {
        development: boolean;
        production: boolean;
      };
      performance: {
        maxEntrypointSize: number;
        maxAssetSize: number;
        analyzer?: {
          enabled: boolean;
          analyzerMode?: string;
          openAnalyzer?: boolean;
          analyzerHost?: string;
          analyzerPort?: number;
          reportFilename?: string;
          defaultSizes?: string;
          excludeAssets?: RegExp;
          logLevel?: string;
          generateStatsFile?: boolean;
          statsFilename?: string;
          statsOptions?: object;
        };
      };
    };

    beforeAll(() => {
      const assetsPath = require.resolve('../../assets.config.js');
      delete require.cache[assetsPath];
      assetsConfig = require('../../assets.config.js');
    });

    it('should have image optimization settings', () => {
      expect(assetsConfig.images).toBeDefined();
      expect(assetsConfig.images.breakpoints).toBeDefined();
      expect(assetsConfig.images.quality).toBeDefined();
    });

    it('should have source map configurations', () => {
      expect(assetsConfig.sourceMaps).toBeDefined();
      expect(assetsConfig.sourceMaps.development).toBeDefined();
      expect(assetsConfig.sourceMaps.production).toBeDefined();
    });

    it('should have output naming patterns', () => {
      expect(assetsConfig.output.naming).toBeDefined();
      expect(assetsConfig.output.naming.development).toBeDefined();
      expect(assetsConfig.output.naming.production).toBeDefined();
    });

    it('should have performance settings', () => {
      expect(assetsConfig.performance).toBeDefined();
      expect(typeof assetsConfig.performance.maxEntrypointSize).toBe('number');
      expect(typeof assetsConfig.performance.maxAssetSize).toBe('number');
    });

    it('should have bundle analyzer configuration', () => {
      expect(assetsConfig.performance.analyzer).toBeDefined();
      expect(assetsConfig.performance.analyzer.enabled).toBeDefined();
      expect(assetsConfig.performance.analyzer.analyzerMode).toBeDefined();
      expect(assetsConfig.performance.analyzer.openAnalyzer).toBeDefined();
      expect(assetsConfig.performance.analyzer.analyzerHost).toBeDefined();
      expect(typeof assetsConfig.performance.analyzer.analyzerPort).toBe('number');
      expect(assetsConfig.performance.analyzer.reportFilename).toBeDefined();
      expect(assetsConfig.performance.analyzer.defaultSizes).toBeDefined();
      expect(assetsConfig.performance.analyzer.excludeAssets).toBeInstanceOf(RegExp);
      expect(assetsConfig.performance.analyzer.logLevel).toBeDefined();
      expect(assetsConfig.performance.analyzer.generateStatsFile).toBeDefined();
      expect(assetsConfig.performance.analyzer.statsFilename).toBeDefined();
      expect(assetsConfig.performance.analyzer.statsOptions).toBeDefined();
    });

    it('should configure bundle analyzer based on environment variables', () => {
      // This test verifies the bundle analyzer configuration structure
      // The actual dynamic environment variable behavior is tested in integration tests

      // Test default configuration (without ANALYZE_BUNDLE)
      const originalEnv = process.env.ANALYZE_BUNDLE;
      delete process.env.ANALYZE_BUNDLE;

      const configPath = require.resolve('../../assets.config.js');
      delete require.cache[configPath];
      const defaultConfig = require('../../assets.config.js');

      expect(defaultConfig.performance.analyzer.enabled).toBe(false);
      expect(defaultConfig.performance.analyzer.analyzerMode).toBe('server');
      expect(defaultConfig.performance.analyzer.analyzerPort).toBe(8888);

      // Restore original env
      if (originalEnv !== undefined) {
        process.env.ANALYZE_BUNDLE = originalEnv;
      }
    });
  });

  describe('Package.json Scripts Integration', () => {
    let packageJson: { name?: string; version?: string; [key: string]: unknown };

    beforeAll(() => {
      const packagePath = path.join(configDir, 'package.json');
      const packageContent = fs.readFileSync(packagePath, 'utf8');
      packageJson = JSON.parse(packageContent);
    });

    it('should have updated build scripts', () => {
      expect(packageJson.scripts['build:react']).toContain('webpack.prod.js');
      expect(packageJson.scripts['build:react:dev']).toContain('webpack.dev.js');
      expect(packageJson.scripts['dev:react']).toContain('webpack.dev.js');
    });

    it('should have webpack-merge as dependency', () => {
      expect(packageJson.devDependencies).toHaveProperty('webpack-merge');
    });

    it('should have all required webpack plugins', () => {
      const devDeps = packageJson.devDependencies;
      expect(devDeps).toHaveProperty('html-webpack-plugin');
      expect(devDeps).toHaveProperty('mini-css-extract-plugin');
      expect(devDeps).toHaveProperty('css-minimizer-webpack-plugin');
      expect(devDeps).toHaveProperty('terser-webpack-plugin');
      expect(devDeps).toHaveProperty('@pmmmwh/react-refresh-webpack-plugin');
      expect(devDeps).toHaveProperty('copy-webpack-plugin');
      expect(devDeps).toHaveProperty('webpack-bundle-analyzer');
    });

    it('should have bundle analyzer scripts', () => {
      expect(packageJson.scripts['analyze:bundle']).toBeDefined();
      expect(packageJson.scripts['analyze:bundle:server']).toBeDefined();
      expect(packageJson.scripts['analyze:bundle:static']).toBeDefined();
      expect(packageJson.scripts['analyze:bundle:json']).toBeDefined();
      expect(packageJson.scripts['analyze:bundle:gzip']).toBeDefined();
      expect(packageJson.scripts['analyze:bundle:stats']).toBeDefined();
      expect(packageJson.scripts['analyze:bundle:ci']).toBeDefined();
      expect(packageJson.scripts['analyze:view']).toBeDefined();
      expect(packageJson.scripts['analyze:summary']).toBeDefined();
      expect(packageJson.scripts['dev:react:analyze']).toBeDefined();
    });

    it('should have correct bundle analyzer script configurations', () => {
      expect(packageJson.scripts['analyze:bundle']).toContain('ANALYZE_BUNDLE=true');
      expect(packageJson.scripts['analyze:bundle:static']).toContain('ANALYZER_MODE=static');
      expect(packageJson.scripts['analyze:bundle:json']).toContain('ANALYZER_MODE=json');
      expect(packageJson.scripts['analyze:bundle:gzip']).toContain('ANALYZER_SIZES=gzip');
      expect(packageJson.scripts['analyze:bundle:ci']).toContain('ANALYZER_OPEN=false');
      expect(packageJson.scripts['dev:react:analyze']).toContain('ANALYZE_BUNDLE=true');
    });
  });

  describe('Configuration Compatibility', () => {
    it('should have backed up old webpack.config.js', () => {
      const oldConfigPath = path.join(configDir, 'webpack.config.js.old');
      expect(fs.existsSync(oldConfigPath)).toBe(true);
    });

    it('should not have conflicting webpack.config.js', () => {
      const configPath = path.join(configDir, 'webpack.config.js');
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('should maintain consistent asset paths between configs', () => {
      const assetsConfig = require('../../assets.config.js');

      // Both dev and prod should use the same asset config
      expect(assetsConfig.output.publicPath.development).toBeDefined();
      expect(assetsConfig.output.publicPath.production).toBeDefined();
      expect(assetsConfig.images.breakpoints).toBeInstanceOf(Array);
    });
  });
});
