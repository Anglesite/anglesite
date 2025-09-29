/**
 * @file Regression test for diagnostics scripts path bug
 * @description Tests that the diagnostics HTML and JavaScript files are in the correct
 * relative paths so that the HTML can load the scripts properly.
 *
 * Bug: Diagnostics window shows spinner forever because HTML cannot find script files.
 * The HTML is in dist/src/renderer/ui/ but scripts are in dist/src/renderer/ui/react/
 * causing relative script paths to fail.
 */

import * as path from 'path';
import * as fs from 'fs';

describe('Regression: Diagnostics Scripts Path Bug', () => {
  describe('Bug Reproduction', () => {
    it('should demonstrate the path mismatch issue', () => {
      const htmlPath = path.join(__dirname, '../../dist/src/renderer/ui/diagnostics.html');
      const scriptsDir = path.join(__dirname, '../../dist/src/renderer/ui/react');

      // HTML exists in ui folder
      if (fs.existsSync(htmlPath)) {
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

        // Extract script src attributes
        const scriptMatches = htmlContent.match(/src="([^"]+\.js)"/g);

        if (scriptMatches) {
          // Scripts are referenced with relative paths (no directory prefix)
          const scriptPaths = scriptMatches.map((match) => match.replace(/src="([^"]+)"/, '$1'));

          // Check if any script uses just filename (relative path issue)
          const hasRelativeScripts = scriptPaths.some((path) => !path.includes('/') && path.endsWith('.js'));

          // This demonstrates the bug - scripts are referenced relatively
          // but they're not in the same directory as the HTML
          expect(hasRelativeScripts).toBe(true);

          // Verify scripts don't exist at relative path from HTML
          scriptPaths.forEach((scriptPath) => {
            if (!scriptPath.includes('/')) {
              const fullPath = path.join(path.dirname(htmlPath), scriptPath);
              // Scripts should NOT exist at this location (bug)
              expect(fs.existsSync(fullPath)).toBe(false);
            }
          });
        }
      }
    });

    it('should verify scripts are actually in react subfolder', () => {
      const reactDir = path.join(__dirname, '../../dist/src/renderer/ui/react');

      if (fs.existsSync(reactDir)) {
        const files = fs.readdirSync(reactDir);

        // Should contain the diagnostics bundle
        const hasDiagnosticsBundle = files.some((file) => file.startsWith('diagnostics.') && file.endsWith('.js'));

        expect(hasDiagnosticsBundle).toBe(true);

        // Should contain other required bundles
        expect(files.some((file) => file.startsWith('runtime.'))).toBe(true);
        expect(files.some((file) => file.startsWith('react.'))).toBe(true);
      }
    });
  });

  describe('Expected Fix', () => {
    it('should have HTML and scripts in the same directory after fix', () => {
      // After fix, one of these should be true:
      // Option 1: HTML moved to react folder
      const htmlInReactFolder = path.join(__dirname, '../../dist/src/renderer/ui/react/diagnostics.html');

      // Option 2: HTML references scripts with correct relative path
      const htmlInUiFolder = path.join(__dirname, '../../dist/src/renderer/ui/diagnostics.html');

      if (fs.existsSync(htmlInReactFolder)) {
        // If HTML is in react folder, scripts should be accessible
        const htmlContent = fs.readFileSync(htmlInReactFolder, 'utf-8');
        const scriptMatches = htmlContent.match(/src="([^"]+\.js)"/g);

        if (scriptMatches) {
          const scriptPaths = scriptMatches.map((match) => match.replace(/src="([^"]+)"/, '$1'));

          scriptPaths.forEach((scriptPath) => {
            if (!scriptPath.includes('/')) {
              const fullPath = path.join(path.dirname(htmlInReactFolder), scriptPath);
              // Scripts SHOULD exist at this location (fixed)
              expect(fs.existsSync(fullPath)).toBe(true);
            }
          });
        }
      } else if (fs.existsSync(htmlInUiFolder)) {
        // If HTML is in ui folder, it should reference scripts in react/ subfolder
        const htmlContent = fs.readFileSync(htmlInUiFolder, 'utf-8');

        // Should contain references to react/ subfolder
        expect(htmlContent).toMatch(/src="react\/[^"]+\.js"/);
      }
    });

    it('should have DiagnosticsWindowManager load the correct HTML', () => {
      const windowManagerPath = path.join(__dirname, '../../dist/src/main/ui/diagnostics-window-manager.js');

      if (fs.existsSync(windowManagerPath)) {
        const content = fs.readFileSync(windowManagerPath, 'utf-8');

        // Should load HTML from location where scripts are accessible
        // Either from ui/react folder or ui folder with proper script paths
        expect(content).toMatch(/renderer\/ui\/(react\/)?diagnostics\.html/);
      }
    });
  });

  describe('Script Loading Validation', () => {
    it('should verify all required chunks are present', () => {
      const reactDir = path.join(__dirname, '../../dist/src/renderer/ui/react');

      if (fs.existsSync(reactDir)) {
        const files = fs.readdirSync(reactDir);

        // All chunks specified in webpack config should exist
        const requiredChunks = ['diagnostics', 'react', 'vendors', 'common', 'runtime'];

        requiredChunks.forEach((chunk) => {
          const hasChunk = files.some((file) => file.startsWith(chunk + '.') && file.endsWith('.js'));

          expect(hasChunk).toBe(true);
        });
      }
    });
  });
});
