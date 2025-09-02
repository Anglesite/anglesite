/**
 * @file Integration tests for bundle analyzer build process
 * @description Tests that bundle analyzer modes work correctly during builds
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Bundle Analyzer Build Integration Tests', () => {
  const distDir = path.resolve(process.cwd(), 'dist/src/renderer/ui/react');
  const timeout = 90000; // 90 seconds for analyzer builds

  beforeAll(() => {
    // Ensure dist directory exists
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }
  });

  describe('Static Mode Build', () => {
    const reportFile = path.join(distDir, 'bundle-report.html');

    beforeEach(() => {
      // Clean up report file before test
      if (fs.existsSync(reportFile)) {
        fs.unlinkSync(reportFile);
      }
    });

    it(
      'should generate HTML report in static mode',
      () => {
        try {
          execSync('ANALYZE_BUNDLE=true ANALYZER_MODE=static ANALYZER_OPEN=false npm run analyze:bundle', {
            cwd: process.cwd(),
            stdio: 'pipe',
            timeout: timeout,
            env: { ...process.env, ANALYZE_BUNDLE: 'true', ANALYZER_MODE: 'static', ANALYZER_OPEN: 'false' },
          });
        } catch (error: unknown) {
          // Build might fail but we still check if report was generated
          console.warn('Build command had issues:', error instanceof Error ? error.message : String(error));
        }

        // Check that HTML report was created
        expect(fs.existsSync(reportFile)).toBe(true);

        // Verify it's a valid HTML file
        const content = fs.readFileSync(reportFile, 'utf8');
        expect(content).toContain('<!DOCTYPE html>');
        expect(content.length).toBeGreaterThan(10000); // Should be substantial HTML content
      },
      timeout
    );
  });

  describe('JSON Mode Build', () => {
    it(
      'should complete build in JSON mode without opening browser',
      () => {
        let output = '';

        try {
          output = execSync(
            'ANALYZE_BUNDLE=true ANALYZER_MODE=json ANALYZER_OPEN=false webpack --config webpack.prod.js 2>&1',
            {
              cwd: process.cwd(),
              encoding: 'utf8',
              timeout: timeout,
              env: { ...process.env, ANALYZE_BUNDLE: 'true', ANALYZER_MODE: 'json', ANALYZER_OPEN: 'false' },
            }
          ).toString();
        } catch (error: unknown) {
          if (error && typeof error === 'object' && 'stdout' in error) {
            output = String((error as any).stdout || '') || String(error);
          } else {
            output = error instanceof Error ? error.message : String(error);
          }
        }

        // Should complete without trying to open browser
        expect(output).not.toContain('Opening browser');
        expect(output).toContain('webpack');

        // Should have created output files
        expect(fs.existsSync(distDir)).toBe(true);
        const files = fs.readdirSync(distDir);
        expect(files.length).toBeGreaterThan(0);
      },
      timeout
    );
  });

  describe('Stats Generation', () => {
    const statsFile = path.join(distDir, 'bundle-stats.json');

    beforeEach(() => {
      // Clean up stats file before test
      if (fs.existsSync(statsFile)) {
        fs.unlinkSync(statsFile);
      }
    });

    it(
      'should generate stats.json file when requested',
      () => {
        try {
          execSync(
            'ANALYZE_BUNDLE=true ANALYZER_GENERATE_STATS=true ANALYZER_MODE=json ANALYZER_OPEN=false webpack --config webpack.prod.js',
            {
              cwd: process.cwd(),
              stdio: 'pipe',
              timeout: timeout,
              env: {
                ...process.env,
                ANALYZE_BUNDLE: 'true',
                ANALYZER_GENERATE_STATS: 'true',
                ANALYZER_MODE: 'json',
                ANALYZER_OPEN: 'false',
              },
            }
          );
        } catch (error: unknown) {
          console.warn('Build command had issues:', error instanceof Error ? error.message : String(error));
        }

        // Check that stats file was created
        expect(fs.existsSync(statsFile)).toBe(true);

        // Verify it's valid JSON with expected structure
        const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        expect(stats).toHaveProperty('assets');
        expect(stats).toHaveProperty('chunks');
        expect(stats).toHaveProperty('modules');
        expect(Array.isArray(stats.assets)).toBe(true);
      },
      timeout
    );
  });

  describe('CI Mode Build', () => {
    it(
      'should work correctly in CI mode',
      () => {
        const statsFile = path.join(distDir, 'bundle-stats.json');

        // Clean up before test
        if (fs.existsSync(statsFile)) {
          fs.unlinkSync(statsFile);
        }

        let output = '';

        try {
          output = execSync('npm run analyze:bundle:ci', {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: timeout,
          }).toString();
        } catch (error: unknown) {
          if (error && typeof error === 'object' && 'stdout' in error) {
            output = String((error as any).stdout || '');
          } else {
            output = '';
          }
        }

        // Should not try to open browser
        expect(output).not.toContain('Opening browser');

        // Should generate stats file
        expect(fs.existsSync(statsFile)).toBe(true);

        // Stats file should be valid
        const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        expect(stats).toBeTruthy();
        expect(stats.assets).toBeDefined();
      },
      timeout
    );
  });

  describe('Development Mode Analysis', () => {
    it('should support bundle analysis in development mode', async () => {
      // This test would normally start the dev server with analysis
      // For testing, we just verify the configuration is correct

      process.env.ANALYZE_BUNDLE = 'true';
      delete require.cache[require.resolve('../../webpack.dev.js')];
      const devConfig = require('../../webpack.dev.js');

      // Check that analyzer plugin is included
      const hasAnalyzer = devConfig.plugins?.some(
        (plugin: any) => plugin && plugin.constructor?.name === 'BundleAnalyzerPlugin'
      );

      expect(hasAnalyzer).toBe(true);

      delete process.env.ANALYZE_BUNDLE;
    }, 30000);
  });

  describe('Environment Variable Handling', () => {
    it('should have default port configuration', () => {
      const config = require('../../assets.config.js');
      expect(config.performance.analyzer.analyzerPort).toBe(8888);
    });

    it('should have default host configuration', () => {
      const config = require('../../assets.config.js');
      expect(config.performance.analyzer.analyzerHost).toBe('127.0.0.1');
    });

    it('should have default report filename', () => {
      const config = require('../../assets.config.js');
      expect(config.performance.analyzer.reportFilename).toBe('bundle-report.html');
    });
  });

  describe('Summary Script Integration', () => {
    it('should run summary script after stats generation', () => {
      const statsFile = path.join(distDir, 'bundle-stats.json');

      // Ensure stats file exists (create minimal one if needed)
      if (!fs.existsSync(statsFile)) {
        const minimalStats = {
          assets: [{ name: 'test.js', size: 1000 }],
          chunks: [],
          modules: [],
        };
        fs.writeFileSync(statsFile, JSON.stringify(minimalStats));
      }

      let output = '';
      try {
        output = execSync('npm run analyze:summary', {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10000,
        }).toString();
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'stdout' in error) {
          output = String((error as any).stdout || '');
        } else {
          output = '';
        }
      }

      // Should produce summary output
      expect(output).toContain('Bundle Analysis Summary');
      expect(output).toContain('Bundle Overview');
      expect(output).toContain('Asset Breakdown');
    }, 15000);
  });

  describe('Error Handling', () => {
    it('should handle missing webpack config gracefully', () => {
      // Test with invalid config path
      let error: any;

      try {
        execSync('ANALYZE_BUNDLE=true webpack --config webpack.nonexistent.js', {
          cwd: process.cwd(),
          stdio: 'pipe',
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.message).toContain('webpack');
    });

    it('should have reasonable default port configuration', () => {
      // Test that the default port is configured correctly
      const config = require('../../assets.config.js');
      expect(typeof config.performance.analyzer.analyzerPort).toBe('number');
      expect(config.performance.analyzer.analyzerPort).toBeGreaterThan(0);
    });
  });
});
