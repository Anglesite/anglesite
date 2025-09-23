/**
 * @file Regression test for console usage in production code
 * @description Tests that verify console.* statements are replaced with logger utilities
 */

// import { execSync } from 'child_process'; // Not used in current implementation
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

describe('Console Usage Regression Tests', () => {
  // The test is in anglesite/test/regression/, so go up two levels to reach the src directory
  const srcDir = path.resolve(__dirname, '../../../src');
  const tempDir = path.join(__dirname, '../temp');
  const tempFile = path.join(tempDir, 'test-console-usage.tsx');

  beforeAll(() => {
    // Create temp directory for test files
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up temp files
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });

  describe('Production Code Console Usage', () => {
    it('should not contain direct console.log statements in production React components', async () => {
      const componentFiles = await glob('**/*.tsx', {
        cwd: srcDir,
        ignore: ['**/*.test.tsx', '**/*.spec.tsx'],
      });

      const violations: Array<{ file: string; lines: string[] }> = [];

      for (const file of componentFiles) {
        const filePath = path.join(srcDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        const consoleLogLines = lines
          .map((line, index) => ({ line: line.trim(), number: index + 1 }))
          .filter(({ line }) => line.includes('console.log(') && !line.includes('//'))
          .map(({ line, number }) => `Line ${number}: ${line}`);

        if (consoleLogLines.length > 0) {
          violations.push({ file, lines: consoleLogLines });
        }
      }

      if (violations.length > 0) {
        const violationMessage = violations.map(({ file, lines }) => `${file}:\n  ${lines.join('\n  ')}`).join('\n\n');

        throw new Error(
          `Found console.log statements in production React components. Use logger.debug() instead:\n\n${violationMessage}`
        );
      }
    });

    it('should not contain direct console.error statements in production code (except logging.ts)', async () => {
      const sourceFiles = await glob('**/*.{ts,tsx}', {
        cwd: srcDir,
        ignore: [
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.ts',
          '**/logging.ts', // Logger implementation itself can use console
        ],
      });

      const violations: Array<{ file: string; lines: string[] }> = [];

      for (const file of sourceFiles) {
        const filePath = path.join(srcDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        const consoleErrorLines = lines
          .map((line, index) => ({ line: line.trim(), number: index + 1 }))
          .filter(({ line }) => line.includes('console.error(') && !line.includes('//'))
          .map(({ line, number }) => `Line ${number}: ${line}`);

        if (consoleErrorLines.length > 0) {
          violations.push({ file, lines: consoleErrorLines });
        }
      }

      if (violations.length > 0) {
        const violationMessage = violations.map(({ file, lines }) => `${file}:\n  ${lines.join('\n  ')}`).join('\n\n');

        throw new Error(
          `Found console.error statements in production code. Use logger.error() instead:\n\n${violationMessage}`
        );
      }
    });

    it('should not contain direct console.warn statements in production code (except logging.ts)', async () => {
      const sourceFiles = await glob('**/*.{ts,tsx}', {
        cwd: srcDir,
        ignore: [
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.ts',
          '**/logging.ts', // Logger implementation itself can use console
        ],
      });

      const violations: Array<{ file: string; lines: string[] }> = [];

      for (const file of sourceFiles) {
        const filePath = path.join(srcDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        const consoleWarnLines = lines
          .map((line, index) => ({ line: line.trim(), number: index + 1 }))
          .filter(({ line }) => line.includes('console.warn(') && !line.includes('//'))
          .map(({ line, number }) => `Line ${number}: ${line}`);

        if (consoleWarnLines.length > 0) {
          violations.push({ file, lines: consoleWarnLines });
        }
      }

      if (violations.length > 0) {
        const violationMessage = violations.map(({ file, lines }) => `${file}:\n  ${lines.join('\n  ')}`).join('\n\n');

        throw new Error(
          `Found console.warn statements in production code. Use logger.warn() instead:\n\n${violationMessage}`
        );
      }
    });
  });

  describe('Logger Usage Validation', () => {
    it('should detect violation when console.log is used instead of logger', () => {
      const testContent = `import React from 'react';

export const TestComponent: React.FC = () => {
  const handleClick = () => {
    console.log('This should trigger a violation');
  };

  return <button onClick={handleClick}>Test</button>;
};`;

      fs.writeFileSync(tempFile, testContent);

      // This test verifies our regex detection works correctly
      const content = fs.readFileSync(tempFile, 'utf8');
      const lines = content.split('\n');
      const consoleLogLines = lines.filter((line) => line.includes('console.log(') && !line.trim().startsWith('//'));

      expect(consoleLogLines.length).toBeGreaterThan(0);
    });

    it('should allow logger usage as the proper alternative', () => {
      const testContent = `import React from 'react';
import { logger } from '../utils/logger';

export const TestComponent: React.FC = () => {
  const handleClick = () => {
    logger.debug('TestComponent', 'Button clicked');  // This is correct
  };

  const handleError = (error: Error) => {
    logger.error('TestComponent', 'Failed to handle click', error);  // This is correct
  };

  return <button onClick={handleClick}>Test</button>;
};`;

      fs.writeFileSync(tempFile, testContent);

      // This test verifies logger usage is the expected pattern
      const content = fs.readFileSync(tempFile, 'utf8');
      const hasLogger = content.includes('logger.');
      const hasConsole = content.includes('console.');

      expect(hasLogger).toBe(true);
      expect(hasConsole).toBe(false);
    });
  });

  describe('Special Cases', () => {
    it('should allow console statements in comments', () => {
      const testContent = `import React from 'react';
import { logger } from '../utils/logger';

export const TestComponent: React.FC = () => {
  // TODO: Replace this console.log with logger.debug
  // Example: console.log('debug info') -> logger.debug('Component', 'debug info')
  const handleClick = () => {
    logger.debug('TestComponent', 'Button clicked');
  };

  return <button onClick={handleClick}>Test</button>;
};`;

      fs.writeFileSync(tempFile, testContent);

      // Commented console statements should not be detected as violations
      const content = fs.readFileSync(tempFile, 'utf8');
      const lines = content.split('\n');
      const violatingLines = lines.filter((line) => line.includes('console.') && !line.trim().startsWith('//'));

      expect(violatingLines.length).toBe(0);
    });
  });
});
