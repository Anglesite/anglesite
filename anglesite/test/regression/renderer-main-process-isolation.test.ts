/**
 * @file Regression test for renderer/main process isolation
 *
 * Verifies that renderer process code doesn't import from main process,
 * which would cause lazy-loading failures and webpack bundling issues.
 *
 * Bug: WebsiteConfigEditor failed to load because InlineError imported
 * from main/core/errors/base.ts, causing the lazy-loaded chunk to fail.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Renderer/Main Process Isolation', () => {
  const rendererPath = path.join(__dirname, '../../src/renderer');
  const mainPath = path.join(__dirname, '../../src/main');

  /**
   * Recursively find all TypeScript files in a directory
   */
  function findTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and test directories
        if (entry.name !== 'node_modules' && entry.name !== 'test' && entry.name !== 'dist') {
          files.push(...findTypeScriptFiles(fullPath));
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if a file contains imports from main process
   */
  function hasMainProcessImports(filePath: string): { hasImports: boolean; imports: string[] } {
    const content = fs.readFileSync(filePath, 'utf-8');
    const mainImportPattern = /import\s+.*from\s+['"]\.\.\/\.\.\/main\//g;
    const mainImportPattern2 = /import\s+.*from\s+['"].*\/main\//g;

    const matches1 = content.match(mainImportPattern) || [];
    const matches2 = content.match(mainImportPattern2) || [];
    const allMatches = [...matches1, ...matches2];

    return {
      hasImports: allMatches.length > 0,
      imports: allMatches,
    };
  }

  test('renderer process files should not import from main process', () => {
    const rendererFiles = findTypeScriptFiles(rendererPath);
    const violatingFiles: Array<{ file: string; imports: string[] }> = [];

    for (const file of rendererFiles) {
      const result = hasMainProcessImports(file);
      if (result.hasImports) {
        violatingFiles.push({
          file: path.relative(process.cwd(), file),
          imports: result.imports,
        });
      }
    }

    if (violatingFiles.length > 0) {
      const errorMessage = violatingFiles.map((v) => `\n${v.file}:\n  ${v.imports.join('\n  ')}`).join('\n');

      throw new Error(
        `Found ${violatingFiles.length} renderer files importing from main process:${errorMessage}\n\n` +
          'Renderer process should not import from main process. ' +
          'This causes lazy-loading failures and webpack bundling issues. ' +
          'Create shared types or duplicate necessary enums in renderer.'
      );
    }

    expect(violatingFiles).toHaveLength(0);
  });

  test('InlineError component should not depend on main process', () => {
    const inlineErrorPath = path.join(rendererPath, 'ui/react/components/InlineError.tsx');

    if (fs.existsSync(inlineErrorPath)) {
      const result = hasMainProcessImports(inlineErrorPath);

      if (result.hasImports) {
        throw new Error(
          `InlineError component imports from main process:\n${result.imports.join('\n')}\n\n` +
            'This caused the WebsiteConfigEditor lazy-loading bug.'
        );
      }
      expect(result.hasImports).toBe(false);
    }
  });

  test('error-translator should not depend on main process', () => {
    const translatorPath = path.join(rendererPath, 'utils/error-translator.ts');

    if (fs.existsSync(translatorPath)) {
      const result = hasMainProcessImports(translatorPath);

      if (result.hasImports) {
        throw new Error(
          `error-translator imports from main process:\n${result.imports.join('\n')}\n\n` +
            'This causes issues when lazy-loading components that use error translation.'
        );
      }
      expect(result.hasImports).toBe(false);
    }
  });

  test('friendly-error-messages should not depend on main process', () => {
    const messagesPath = path.join(rendererPath, 'utils/friendly-error-messages.ts');

    if (fs.existsSync(messagesPath)) {
      const result = hasMainProcessImports(messagesPath);

      if (result.hasImports) {
        throw new Error(`friendly-error-messages imports from main process:\n${result.imports.join('\n')}`);
      }
      expect(result.hasImports).toBe(false);
    }
  });
});
