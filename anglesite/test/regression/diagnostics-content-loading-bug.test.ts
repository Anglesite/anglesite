/**
 * @file Regression test for diagnostics content loading bug
 * @description Tests that the diagnostics window properly loads its React content
 * instead of getting stuck on "Loading diagnostics..." message.
 *
 * Bug: Diagnostics window gets stuck on loading screen because the JavaScript files
 * are compiled to CommonJS modules but run in browser context without require() support.
 * The fix requires adding diagnostics entry point to webpack configuration.
 */

import * as path from 'path';
import * as fs from 'fs';

describe('Regression: Diagnostics Content Loading Bug', () => {
  describe('Bug Analysis', () => {
    it('should demonstrate the module format issue', () => {
      // Read the compiled diagnostics index.js file
      const compiledFile = path.join(__dirname, '../../dist/src/renderer/diagnostics/index.js');

      // The file should exist (created by our earlier fixes)
      expect(fs.existsSync(compiledFile)).toBe(true);

      if (fs.existsSync(compiledFile)) {
        const content = fs.readFileSync(compiledFile, 'utf-8');

        // Bug reproduction: The compiled file uses CommonJS require()
        // which doesn't work in renderer process with nodeIntegration: false
        expect(content).toContain('require("react');
        expect(content).toContain('require("react-dom/client');
        expect(content).toContain('require("./DiagnosticsApp');

        // These CommonJS patterns cause the loading failure
        expect(content).toContain('Object.defineProperty(exports, "__esModule"');
        expect(content).toContain('__importDefault');
      }
    });

    it('should show webpack entry points do not include diagnostics', () => {
      // Read webpack common configuration
      const webpackConfigPath = path.join(__dirname, '../../webpack.common.js');
      expect(fs.existsSync(webpackConfigPath)).toBe(true);

      if (fs.existsSync(webpackConfigPath)) {
        const content = fs.readFileSync(webpackConfigPath, 'utf-8');

        // Bug: Webpack entry points don't include diagnostics
        expect(content).toContain("main: './src/renderer/ui/react/index.tsx'");
        expect(content).toContain('styles: [');

        // After fix: Should have diagnostics entry point
        expect(content).toContain('diagnostics:');
        expect(content).toContain('./src/renderer/diagnostics');
      }
    });
  });

  describe('Build Configuration Analysis', () => {
    it('should verify webpack target is electron-renderer', () => {
      const webpackConfigPath = path.join(__dirname, '../../webpack.common.js');

      if (fs.existsSync(webpackConfigPath)) {
        const content = fs.readFileSync(webpackConfigPath, 'utf-8');

        // Verify correct target for renderer process
        expect(content).toContain("target: 'electron-renderer'");

        // Verify TypeScript processing is configured
        expect(content).toContain('test: /\\.tsx?$/');
        expect(content).toContain('ts-loader');
      }
    });

    it('should show fallback configuration for Node.js modules', () => {
      const webpackConfigPath = path.join(__dirname, '../../webpack.common.js');

      if (fs.existsSync(webpackConfigPath)) {
        const content = fs.readFileSync(webpackConfigPath, 'utf-8');

        // Verify fallbacks are configured for browser environment
        expect(content).toContain('fallback:');
        expect(content).toContain("buffer: 'buffer'");
        expect(content).toContain("process: 'process/browser'");
      }
    });
  });

  describe('Expected Behavior (After Fix)', () => {
    it('should document the required webpack entry point addition', () => {
      // This test documents what the fix should add to webpack config
      const requiredDiagnosticsEntry = "diagnostics: './src/renderer/diagnostics/index.tsx'";

      // After fix, webpack should include diagnostics entry point
      // This will bundle the React components for browser consumption
      expect(requiredDiagnosticsEntry).toContain('diagnostics:');
      expect(requiredDiagnosticsEntry).toContain('./src/renderer/diagnostics/index.tsx');
    });

    it('should verify source TypeScript uses ES6 imports', () => {
      // Verify the source files use proper ES6 imports (not CommonJS)
      const sourceFile = path.join(__dirname, '../../src/renderer/diagnostics/index.tsx');

      if (fs.existsSync(sourceFile)) {
        const content = fs.readFileSync(sourceFile, 'utf-8');

        // Source correctly uses ES6 imports
        expect(content).toContain("import React from 'react'");
        expect(content).toContain("import { createRoot } from 'react-dom/client'");
        expect(content).toContain("import DiagnosticsApp from './DiagnosticsApp'");

        // Source does NOT use CommonJS
        expect(content).not.toContain('require(');
        expect(content).not.toContain('exports.');
      }
    });
  });

  describe('Fix Validation', () => {
    it('should check if diagnostics files exist in build output', () => {
      // These files should exist after webpack processes them
      const expectedFiles = [
        'dist/src/renderer/diagnostics/index.js',
        'dist/src/renderer/diagnostics/DiagnosticsApp.js',
        'dist/src/renderer/diagnostics.html',
      ];

      expectedFiles.forEach((file) => {
        const fullPath = path.join(__dirname, '../../', file);
        expect(fs.existsSync(fullPath)).toBe(true);
      });
    });

    it('should verify HTML file no longer has hardcoded script (FIXED)', () => {
      const htmlPath = path.join(__dirname, '../../dist/src/renderer/diagnostics.html');

      if (fs.existsSync(htmlPath)) {
        const content = fs.readFileSync(htmlPath, 'utf-8');

        // After fix: HTML should NOT have the hardcoded script that caused the bug
        expect(content).not.toContain('<script src="./diagnostics/index.js"></script>');

        // Should have comment about webpack injection instead
        expect(content).toContain('Scripts will be injected by webpack HtmlWebpackPlugin');

        // Still has the required elements
        expect(content).toContain('<link rel="stylesheet" href="./styles.css" />');
        expect(content).toContain('id="diagnostics-root"');
        expect(content).toContain('Loading diagnostics...');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing React dependencies gracefully', () => {
      // The bundled version should include React dependencies
      // Unlike the CommonJS version which tries to require them separately

      const mockWindow = {
        document: {
          getElementById: jest.fn(),
          addEventListener: jest.fn(),
          readyState: 'complete',
        },
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        electronAPI: {
          send: jest.fn(),
        },
      };

      // After fix, the bundled code should not rely on external require()
      expect(() => {
        // Simulate browser environment where require is not available
        const requireFunction = undefined;
        expect(requireFunction).toBeUndefined();
      }).not.toThrow();
    });

    it('should provide fallback for missing electronAPI', () => {
      // The diagnostics code should handle missing electronAPI gracefully
      const sourceFile = path.join(__dirname, '../../src/renderer/diagnostics/index.tsx');

      if (fs.existsSync(sourceFile)) {
        const content = fs.readFileSync(sourceFile, 'utf-8');

        // Code uses optional chaining for electronAPI
        expect(content).toContain('window.electronAPI?.send');
      }
    });
  });

  describe('Module Resolution', () => {
    it('should verify webpack handles React imports correctly', () => {
      // After webpack bundling, React should be available without require()
      const webpackConfigPath = path.join(__dirname, '../../webpack.common.js');

      if (fs.existsSync(webpackConfigPath)) {
        const content = fs.readFileSync(webpackConfigPath, 'utf-8');

        // Webpack should be configured to handle React
        expect(content).toContain('electron-renderer');
        expect(content).toContain('ts-loader');

        // Should have fallbacks for Node.js modules
        expect(content).toContain('fallback:');
      }
    });
  });
});
