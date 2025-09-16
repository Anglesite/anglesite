/**
 * @file Integration tests for code splitting build output
 * @description Validates that webpack produces expected chunks and bundle sizes
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

describe('Code Splitting Build Integration', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const distPath = path.join(projectRoot, 'dist/src/renderer/ui/react');

  // Only run in CI or when explicitly requested
  const shouldRunBuildTests = process.env.CI === 'true' || process.env.RUN_BUILD_TESTS === 'true';
  const describeOrSkip = shouldRunBuildTests ? describe : describe.skip;

  describeOrSkip('Production Build Output', () => {
    beforeAll(() => {
      // Run production build
      execSync('NODE_ENV=production npm run build:react', {
        cwd: projectRoot,
        stdio: 'pipe',
      });
    }, 60000); // 60 second timeout for build

    it('should generate separate chunk files', () => {
      const files = fs.readdirSync(distPath);
      const jsFiles = files.filter((f) => f.endsWith('.js') && !f.endsWith('.map'));

      // Should have multiple chunk files
      expect(jsFiles.length).toBeGreaterThan(4);

      // Check for expected chunks (names may vary due to contenthash)
      const hasReactChunk = jsFiles.some((f) => f.startsWith('react.'));
      const hasFormsChunk = jsFiles.some((f) => f.startsWith('forms.'));
      const hasUtilsChunk = jsFiles.some((f) => f.startsWith('utils.'));
      const hasVendorsChunk = jsFiles.some((f) => f.startsWith('vendors.'));
      const hasMainChunk = jsFiles.some((f) => f.startsWith('main.'));
      const hasRuntimeChunk = jsFiles.some((f) => f.startsWith('runtime.'));

      expect(hasReactChunk).toBe(true);
      expect(hasFormsChunk).toBe(true);
      expect(hasUtilsChunk).toBe(true);
      expect(hasVendorsChunk).toBe(true);
      expect(hasMainChunk).toBe(true);
      expect(hasRuntimeChunk).toBe(true);
    });

    it('should generate appropriately sized chunks', () => {
      const files = fs.readdirSync(distPath);

      // Check React chunk size (should be ~175KB minified)
      const reactChunk = files.find((f) => f.startsWith('react.') && f.endsWith('.js'));
      if (reactChunk) {
        const stats = fs.statSync(path.join(distPath, reactChunk));
        expect(stats.size).toBeGreaterThan(150000); // > 150KB
        expect(stats.size).toBeLessThan(250000); // < 250KB
      }

      // Check Forms chunk size (should be ~297KB minified)
      const formsChunk = files.find((f) => f.startsWith('forms.') && f.endsWith('.js'));
      if (formsChunk) {
        const stats = fs.statSync(path.join(distPath, formsChunk));
        expect(stats.size).toBeGreaterThan(250000); // > 250KB
        expect(stats.size).toBeLessThan(400000); // < 400KB
      }

      // Check Main chunk size (should be small, ~20KB)
      const mainChunk = files.find((f) => f.startsWith('main.') && f.endsWith('.js'));
      if (mainChunk) {
        const stats = fs.statSync(path.join(distPath, mainChunk));
        expect(stats.size).toBeLessThan(50000); // < 50KB
      }

      // Check Runtime chunk size (should be tiny, ~2KB)
      const runtimeChunk = files.find((f) => f.startsWith('runtime.') && f.endsWith('.js'));
      if (runtimeChunk) {
        const stats = fs.statSync(path.join(distPath, runtimeChunk));
        expect(stats.size).toBeLessThan(5000); // < 5KB
      }
    });

    it('should generate source maps for all chunks', () => {
      const files = fs.readdirSync(distPath);
      const jsFiles = files.filter((f) => f.endsWith('.js') && !f.endsWith('.map'));
      const mapFiles = files.filter((f) => f.endsWith('.js.map'));

      // Each JS file should have a corresponding map file
      jsFiles.forEach((jsFile) => {
        const expectedMapFile = `${jsFile}.map`;
        expect(mapFiles).toContain(expectedMapFile);
      });
    });

    it('should have content-based hashing in filenames', () => {
      const files = fs.readdirSync(distPath);
      const jsFiles = files.filter((f) => f.endsWith('.js') && !f.endsWith('.map'));

      // Check that files have 8-character content hash
      const hashPattern = /\.[a-f0-9]{8}\./;
      jsFiles.forEach((file) => {
        if (!file.startsWith('runtime.')) {
          // Runtime might not have hash
          expect(file).toMatch(hashPattern);
        }
      });
    });

    it('should update index.html with correct chunk references', () => {
      const indexPath = path.join(distPath, 'index.html');
      expect(fs.existsSync(indexPath)).toBe(true);

      const indexContent = fs.readFileSync(indexPath, 'utf8');

      // Should reference the runtime chunk
      expect(indexContent).toMatch(/<script[^>]*runtime\.[a-f0-9]{8}\.js/);

      // Should reference the main chunk
      expect(indexContent).toMatch(/<script[^>]*main\.[a-f0-9]{8}\.js/);

      // Should have proper script defer/async attributes
      expect(indexContent).toMatch(/<script[^>]*(defer|async)/);
    });
  });

  describeOrSkip('Bundle Analysis Output', () => {
    beforeAll(() => {
      // Run bundle analysis in JSON mode
      execSync('ANALYZE_BUNDLE=true ANALYZER_MODE=json npm run build:react', {
        cwd: projectRoot,
        stdio: 'pipe',
      });
    }, 60000);

    it('should generate bundle stats file', () => {
      const statsPath = path.join(distPath, 'bundle-stats.json');
      expect(fs.existsSync(statsPath)).toBe(true);

      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      expect(stats).toHaveProperty('assets');
      expect(stats).toHaveProperty('chunks');
      expect(stats).toHaveProperty('modules');
    });

    it('should show correct chunk dependencies in stats', () => {
      const statsPath = path.join(distPath, 'bundle-stats.json');
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));

      // Find forms chunk
      const formsChunk = stats.chunks?.find(
        (c: Record<string, unknown>) => (c.names as string[])?.includes('forms') || c.id === 'forms'
      );

      if (formsChunk) {
        // Forms chunk should contain @rjsf modules
        const formsModules = stats.modules?.filter(
          (m: Record<string, unknown>) =>
            (formsChunk.modules as string[])?.includes(m.id as string) ||
            (formsChunk.containedModules as string[])?.includes(m.id as string)
        );

        const hasRjsfModules = formsModules?.some(
          (m: Record<string, unknown>) =>
            (m.name as string)?.includes('@rjsf') || (m.identifier as string)?.includes('@rjsf')
        );

        expect(hasRjsfModules).toBe(true);
      }
    });
  });

  describe('Development Build Configuration', () => {
    it('should not split chunks in development mode', () => {
      const devConfig = require('../../webpack.dev.js');

      // Development should not have aggressive splitting
      expect(devConfig.optimization?.splitChunks).toBeUndefined();
      expect(devConfig.optimization?.runtimeChunk).toBeUndefined();
    });
  });

  describe('Error Boundary Component', () => {
    it('should export ErrorBoundary class', () => {
      const errorBoundaryPath = path.join(projectRoot, 'src/renderer/ui/react/components/ErrorBoundary.tsx');
      const errorBoundaryContent = fs.readFileSync(errorBoundaryPath, 'utf8');

      // Check for Error Boundary class definition
      expect(errorBoundaryContent).toMatch(/export\s+class\s+ErrorBoundary\s+extends\s+Component/);

      // Check for getDerivedStateFromError method
      expect(errorBoundaryContent).toMatch(/static\s+getDerivedStateFromError/);

      // Check for componentDidCatch method
      expect(errorBoundaryContent).toMatch(/componentDidCatch/);

      // Check for error state handling
      expect(errorBoundaryContent).toMatch(/hasError:\s*boolean/);
    });

    it('should be imported and used in Main.tsx', () => {
      const mainPath = path.join(projectRoot, 'src/renderer/ui/react/components/Main.tsx');
      const mainContent = fs.readFileSync(mainPath, 'utf8');

      // Check that ErrorBoundary is imported
      expect(mainContent).toMatch(/import\s+.*ErrorBoundary.*from\s+['"]\.\/ErrorBoundary['"]/);

      // Check that ErrorBoundary is used as a component
      expect(mainContent).toMatch(/<ErrorBoundary/);
    });
  });

  describe('Webpack Magic Comments', () => {
    it('should use webpackChunkName for lazy imports', () => {
      const mainPath = path.join(projectRoot, 'src/renderer/ui/react/components/Main.tsx');
      const mainContent = fs.readFileSync(mainPath, 'utf8');

      // Check for webpack magic comment
      expect(mainContent).toMatch(/import\s*\(\s*\/\*\s*webpackChunkName:\s*["']website-config-editor["']\s*\*\//);
    });
  });
});
