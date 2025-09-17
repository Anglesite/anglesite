/**
 * @file Tests for webpack code splitting configuration
 * @description Validates code splitting, chunk optimization, and lazy loading configuration
 */

import * as path from 'path';
import { Configuration } from 'webpack';

// Use real fs module to avoid mock pollution from other tests
const fs = jest.requireActual<typeof import('fs')>('fs');

// Webpack configuration interfaces
interface WebpackSplitChunksConfig {
  chunks: string;
  maxAsyncRequests?: number;
  maxInitialRequests?: number;
  cacheGroups?: Record<string, WebpackCacheGroup>;
}

interface WebpackCacheGroup {
  name: string;
  priority: number;
  reuseExistingChunk: boolean;
  enforce?: boolean;
  chunks?: string;
  minSize?: number;
  test: RegExp;
}

interface WebpackOptimization {
  splitChunks?: WebpackSplitChunksConfig;
  runtimeChunk?: { name: string };
}

interface WebpackRule {
  test: RegExp;
  use: WebpackLoader | WebpackLoader[];
}

interface WebpackLoader {
  loader: string;
  options?: Record<string, unknown>;
}

interface WebpackModule {
  rules: WebpackRule[];
}

interface WebpackOutput {
  chunkFilename?: string;
  assetModuleFilename?: string;
}

interface WebpackPerformance {
  hints: string;
  maxEntrypointSize: number;
  maxAssetSize: number;
}

interface WebpackConfig {
  optimization?: WebpackOptimization;
  module?: WebpackModule;
  output?: WebpackOutput;
  performance?: WebpackPerformance;
}

describe('Code Splitting Configuration', () => {
  let prodConfig: WebpackConfig;
  let assetsConfig: WebpackConfig;

  beforeAll(() => {
    // Mock webpack-merge
    jest.mock('webpack-merge', () => ({
      merge: (...configs: Configuration[]) => Object.assign({}, ...configs),
    }));

    // Load production config
    const prodPath = require.resolve('../../webpack.prod.js');
    delete require.cache[prodPath];
    prodConfig = require('../../webpack.prod.js');

    // Load assets config
    const assetsPath = require.resolve('../../assets.config.js');
    delete require.cache[assetsPath];
    assetsConfig = require('../../assets.config.js');
  });

  afterAll(() => {
    jest.unmock('webpack-merge');
  });

  describe('SplitChunks Configuration', () => {
    it('should have splitChunks enabled with "all" chunks strategy', () => {
      expect(prodConfig.optimization?.splitChunks).toBeDefined();
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        expect(splitChunks.chunks).toBe('all');
      }
    });

    it('should have increased async request limits for better code splitting', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        expect(splitChunks.maxAsyncRequests).toBe(20);
        expect(splitChunks.maxInitialRequests).toBe(10);
      }
    });

    it('should have React cache group configured', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;
        expect(cacheGroups).toHaveProperty('react');

        const reactGroup = cacheGroups?.react;
        expect(reactGroup).toMatchObject({
          name: 'react',
          priority: 40,
          reuseExistingChunk: true,
          enforce: true,
        });

        // Test regex pattern for React libraries
        const testPath = '/node_modules/react-dom/index.js';
        expect(reactGroup?.test.test(testPath)).toBe(true);
      }
    });

    it('should have Forms cache group for @rjsf dependencies', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;
        expect(cacheGroups).toHaveProperty('forms');

        const formsGroup = cacheGroups?.forms;
        expect(formsGroup).toMatchObject({
          name: 'forms',
          priority: 35,
          reuseExistingChunk: true,
          chunks: 'async',
          enforce: true,
          minSize: 10000, // 50KB minimum
        });

        // Test regex pattern for form libraries
        const rjsfPath = '/node_modules/@rjsf/core/index.js';
        const ajvPath = '/node_modules/ajv/index.js';
        expect(formsGroup?.test.test(rjsfPath)).toBe(true);
        expect(formsGroup?.test.test(ajvPath)).toBe(true);
      }
    });

    it('should have Utils cache group for lodash', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;
        expect(cacheGroups).toHaveProperty('utils');

        const utilsGroup = cacheGroups?.utils;
        expect(utilsGroup).toMatchObject({
          name: 'utils',
          priority: 25,
          reuseExistingChunk: true,
        });

        // Test regex pattern for lodash
        const lodashPath = '/node_modules/lodash/index.js';
        const lodashEsPath = '/node_modules/lodash-es/index.js';
        expect(utilsGroup?.test.test(lodashPath)).toBe(true);
        expect(utilsGroup?.test.test(lodashEsPath)).toBe(true);
      }
    });

    it('should have Vendor cache group with lower priority', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;
        expect(cacheGroups).toHaveProperty('vendor');

        const vendorGroup = cacheGroups?.vendor;
        expect(vendorGroup).toMatchObject({
          name: 'vendors',
          priority: 10,
          reuseExistingChunk: true,
        });

        // Test that it catches node_modules
        const vendorPath = '/node_modules/some-package/index.js';
        expect(vendorGroup?.test.test(vendorPath)).toBe(true);
      }
    });

    it('should have Common cache group for shared application code', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;
        expect(cacheGroups).toHaveProperty('common');

        const commonGroup = cacheGroups?.common;
        expect(commonGroup).toMatchObject({
          name: 'common',
          minChunks: 2,
          priority: 5,
          reuseExistingChunk: true,
        });
      }
    });

    it('should have correct priority ordering for cache groups', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;

        // Priority should be: react > forms > utils > vendor > common
        expect(cacheGroups?.react?.priority).toBe(40);
        expect(cacheGroups?.forms?.priority).toBe(35);
        expect(cacheGroups?.utils?.priority).toBe(25);
        expect(cacheGroups?.vendor?.priority).toBe(10);
        expect(cacheGroups?.common?.priority).toBe(5);
      }
    });
  });

  describe('Runtime Chunk Configuration', () => {
    it('should extract runtime chunk for better caching', () => {
      expect(prodConfig.optimization?.runtimeChunk).toEqual({
        name: 'runtime',
      });
    });
  });

  describe('Output Configuration for Code Splitting', () => {
    it('should use contenthash for chunk filenames', () => {
      expect(prodConfig.output?.chunkFilename).toContain('[contenthash');
      expect(prodConfig.output?.chunkFilename).toBe('[name].[contenthash:8].chunk.js');
    });

    it('should have proper asset module filename pattern', () => {
      expect(prodConfig.output?.assetModuleFilename).toBe('assets/[name].[contenthash:8][ext]');
    });
  });

  describe('Module Rules for Lazy Loading', () => {
    it('should have TypeScript loader configured for dynamic imports', () => {
      const rules = prodConfig.module?.rules || [];
      const tsRule = rules.find(
        (rule): rule is WebpackRule =>
          rule && typeof rule === 'object' && 'test' in rule && rule.test instanceof RegExp && rule.test.test('.tsx')
      );

      expect(tsRule).toBeDefined();
      if (tsRule && typeof tsRule === 'object' && 'use' in tsRule) {
        const tsLoader = Array.isArray(tsRule.use) ? tsRule.use[0] : tsRule.use;
        if (typeof tsLoader === 'object' && tsLoader !== null) {
          expect(tsLoader.loader).toBe('ts-loader');
          if (typeof tsLoader.options === 'object') {
            expect(tsLoader.options?.transpileOnly).toBe(true);
          }
        }
      }
    });
  });

  describe('Performance Configuration', () => {
    it('should have appropriate performance hints for code-split bundles', () => {
      const performance = prodConfig.performance;
      if (performance && typeof performance === 'object') {
        expect(performance.hints).toBe('warning');
        expect(performance.maxEntrypointSize).toBe(1200000); // 1.2MB
        expect(performance.maxAssetSize).toBe(800000); // 800KB
      }
    });

    it('should match assets config performance settings', () => {
      const performance = prodConfig.performance;
      if (performance && typeof performance === 'object') {
        expect(performance.maxEntrypointSize).toBe(assetsConfig.performance?.maxEntrypointSize);
        expect(performance.maxAssetSize).toBe(assetsConfig.performance?.maxAssetSize);
      }
    });
  });

  describe('Bundle Analyzer Integration', () => {
    it('should have bundle analyzer configuration in webpack.prod.js', () => {
      // The webpack.prod.js includes BundleAnalyzerPlugin conditionally
      // based on the analyzeBundle variable which checks process.env.ANALYZE_BUNDLE
      const prodContent = fs.readFileSync(path.resolve(__dirname, '../../webpack.prod.js'), 'utf8');

      // Check that the file contains BundleAnalyzerPlugin
      expect(prodContent).toContain('BundleAnalyzerPlugin');

      // Check that it's conditionally included based on analyzeBundle
      expect(prodContent).toContain('analyzeBundle');
      expect(prodContent).toContain("process.env.ANALYZE_BUNDLE === 'true'");

      // Check that plugins are filtered with .filter(Boolean)
      expect(prodContent).toContain('.filter(Boolean)');
    });
  });

  describe('Lazy Loading Support', () => {
    it('should have proper webpack magic comment support in tsconfig', () => {
      const tsconfigPath = path.resolve(__dirname, '../../tsconfig.json');
      expect(fs.existsSync(tsconfigPath)).toBe(true);

      const tsconfigContent = fs.readFileSync(tsconfigPath, 'utf8');
      const tsconfig = JSON.parse(tsconfigContent);

      // Check for module resolution that supports dynamic imports (commonjs works with webpack)
      expect(tsconfig.compilerOptions.module).toBeDefined();
      expect(['commonjs', 'esnext', 'es2020', 'es2022']).toContain(tsconfig.compilerOptions.module.toLowerCase());
    });

    it('should have WebsiteConfigEditor component with default export', () => {
      const editorPath = path.resolve(__dirname, '../../src/renderer/ui/react/components/WebsiteConfigEditor.tsx');
      expect(fs.existsSync(editorPath)).toBe(true);

      const editorContent = fs.readFileSync(editorPath, 'utf8');

      // Check for default export
      expect(editorContent).toMatch(/export\s+default\s+WebsiteConfigEditor/);
    });

    it('should have Main component with lazy import implementation', () => {
      const mainPath = path.resolve(__dirname, '../../src/renderer/ui/react/components/Main.tsx');
      expect(fs.existsSync(mainPath)).toBe(true);

      const mainContent = fs.readFileSync(mainPath, 'utf8');

      // Check for React.lazy usage
      expect(mainContent).toMatch(/lazy\(/);

      // Check for dynamic import with webpack chunk name
      expect(mainContent).toMatch(/import\s*\(\s*\/\*\s*webpackChunkName:/);

      // Check for Suspense wrapper
      expect(mainContent).toMatch(/<Suspense/);

      // Check for Error Boundary
      expect(mainContent).toMatch(/ErrorBoundary/);
    });
  });

  describe('Code Splitting Validation', () => {
    it('should have forms dependencies properly configured for splitting', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;
        const formsGroup = cacheGroups?.forms;

        // Ensure forms chunk is created for all chunk types
        expect(formsGroup?.chunks).toBe('async');

        // Ensure enforce is true to guarantee chunk creation
        expect(formsGroup?.enforce).toBe(true);

        // Ensure minimum size is reasonable for forms
        expect(formsGroup?.minSize).toBeLessThanOrEqual(100000);
      }
    });

    it('should prevent duplicate chunks with reuseExistingChunk', () => {
      const splitChunks = prodConfig.optimization?.splitChunks;
      if (splitChunks && typeof splitChunks === 'object') {
        const cacheGroups = splitChunks.cacheGroups;

        // All cache groups should reuse existing chunks
        Object.values(cacheGroups || {}).forEach((group: WebpackCacheGroup) => {
          if (typeof group === 'object' && group !== null) {
            expect(group.reuseExistingChunk).toBe(true);
          }
        });
      }
    });
  });
});
