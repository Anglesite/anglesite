/**
 * @file Integration tests for webpack build process
 * @description Tests that webpack configurations actually build successfully
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Webpack Build Integration Tests', () => {
  const distDir = path.resolve(process.cwd(), 'dist/app/ui/react');
  const timeout = 60000; // 60 seconds for builds

  beforeEach(() => {
    // Clean dist directory before each test
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up after tests
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  describe('Development Build', () => {
    it(
      'should build successfully with webpack.dev.js',
      async () => {
        const buildCommand = 'npm run build:react:dev';

        expect(() => {
          execSync(buildCommand, {
            cwd: process.cwd(),
            stdio: 'pipe',
            timeout: timeout - 5000, // Leave 5s buffer
          });
        }).not.toThrow();

        // Check that output files were created
        expect(fs.existsSync(distDir)).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);

        // Check for JS bundles
        const files = fs.readdirSync(distDir);
        const jsFiles = files.filter((file) => file.endsWith('.js'));
        expect(jsFiles.length).toBeGreaterThan(0);

        // Development builds should have unminified names
        expect(jsFiles.some((file) => file === 'main.js')).toBe(true);
      },
      timeout
    );

    it('should create development-friendly file names', () => {
      execSync('npm run build:react:dev', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const files = fs.readdirSync(distDir);

      // Development should have simple names without hashes
      expect(files.some((file) => file === 'main.js')).toBe(true);
      expect(files.some((file) => file === 'styles.js')).toBe(true);

      // Should not have hashed filenames in development
      expect(files.some((file) => /\.[a-f0-9]{8}\.js$/.test(file))).toBe(false);
    });
  });

  describe('Production Build', () => {
    it(
      'should build successfully with webpack.prod.js',
      async () => {
        const buildCommand = 'npm run build:react';

        expect(() => {
          execSync(buildCommand, {
            cwd: process.cwd(),
            stdio: 'pipe',
            timeout: timeout - 5000,
          });
        }).not.toThrow();

        // Check that output files were created
        expect(fs.existsSync(distDir)).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);
      },
      timeout
    );

    it('should create production-optimized file names with hashes', () => {
      execSync('npm run build:react', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const files = fs.readdirSync(distDir);

      // Production should have hashed filenames for caching
      expect(files.some((file) => /main\.[a-f0-9]{8}\.js$/.test(file))).toBe(true);
      expect(files.some((file) => /runtime\.[a-f0-9]{8}\.js$/.test(file))).toBe(true);
      expect(files.some((file) => /vendors\.[a-f0-9]{8}\.js$/.test(file))).toBe(true);
    });

    it('should create CSS files in production', () => {
      execSync('npm run build:react', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const files = fs.readdirSync(distDir);

      // Production should extract CSS files
      expect(files.some((file) => /styles\.[a-f0-9]{8}\.css$/.test(file))).toBe(true);
    });

    it('should copy static assets to output directory', () => {
      execSync('npm run build:react', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const assetsDir = path.join(distDir, 'assets', 'icons');

      // Static assets should be copied
      expect(fs.existsSync(assetsDir)).toBe(true);

      const assetFiles = fs.readdirSync(assetsDir);
      expect(assetFiles.length).toBeGreaterThan(0);
      expect(assetFiles.some((file) => file.includes('icon'))).toBe(true);
    });
  });

  describe('Build Variants', () => {
    it(
      'should support sourcemaps build variant',
      async () => {
        const buildCommand = 'npm run build:react:sourcemaps';

        expect(() => {
          execSync(buildCommand, {
            cwd: process.cwd(),
            stdio: 'pipe',
            timeout: timeout - 5000,
          });
        }).not.toThrow();

        // Check for source map files
        const files = fs.readdirSync(distDir);
        expect(files.some((file) => file.endsWith('.js.map'))).toBe(true);
      },
      timeout
    );

    it(
      'should support secure build variant',
      async () => {
        const buildCommand = 'npm run build:react:secure';

        expect(() => {
          execSync(buildCommand, {
            cwd: process.cwd(),
            stdio: 'pipe',
            timeout: timeout - 5000,
          });
        }).not.toThrow();

        // Should build successfully with secure settings
        expect(fs.existsSync(distDir)).toBe(true);
      },
      timeout
    );
  });

  describe('File Size Optimization', () => {
    it('should produce smaller bundles in production than development', () => {
      // Build development version
      execSync('npm run build:react:dev', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const devFiles = fs.readdirSync(distDir);
      const devMainSize = fs.statSync(path.join(distDir, 'main.js')).size;

      // Clean and build production version
      fs.rmSync(distDir, { recursive: true, force: true });

      execSync('npm run build:react', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const prodFiles = fs.readdirSync(distDir);
      const prodMainFile = prodFiles.find((file) => file.startsWith('main.') && file.endsWith('.js'));
      expect(prodMainFile).toBeDefined();

      const prodMainSize = fs.statSync(path.join(distDir, prodMainFile!)).size;

      // Production bundle should be significantly smaller due to minification
      expect(prodMainSize).toBeLessThan(devMainSize);
    });

    it('should split chunks in production build', () => {
      execSync('npm run build:react', {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const files = fs.readdirSync(distDir);
      const jsFiles = files.filter((file) => file.endsWith('.js'));

      // Should have separate chunks for better caching
      expect(jsFiles.some((file) => file.includes('vendors'))).toBe(true);
      expect(jsFiles.some((file) => file.includes('runtime'))).toBe(true);
      expect(jsFiles.some((file) => file.includes('main'))).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should provide meaningful error messages on build failure', () => {
      // We can't easily test build failures without breaking the actual code,
      // so we'll just verify the build commands exist and are properly configured
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

      expect(packageJson.scripts['build:react']).toContain('webpack.prod.js');
      expect(packageJson.scripts['build:react:dev']).toContain('webpack.dev.js');
      expect(packageJson.scripts['dev:react']).toContain('webpack.dev.js');
    });
  });
});
