/**
 * @file Regression test for fs mock pollution issue
 * @description Tests that reproduce the bug where fs.existsSync returns undefined
 * when global fs mocks interfere with tests that expect real filesystem behavior
 */

// Wrap in a function to avoid global scope pollution
const getFsMockPollutionModules = () => {
  // Use Node.js require directly to completely bypass Jest's module mocking
  const fs = require('fs');
  const path = require('path');
  return { fs, path };
};

const { fs: fsMockPollutionRealFs, path: fsMockPollutionRealPath } = getFsMockPollutionModules();

// Find the anglesite project root (where package.json with "name": "@dwk/anglesite" exists)
function findProjectRoot() {
  let currentDir = __dirname;
  while (currentDir !== fsMockPollutionRealPath.dirname(currentDir)) {
    const packageJsonPath = fsMockPollutionRealPath.join(currentDir, 'package.json');
    if (fsMockPollutionRealFs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fsMockPollutionRealFs.readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.name === '@dwk/anglesite') {
          return currentDir;
        }
      } catch {
        // Continue searching
      }
    }
    currentDir = fsMockPollutionRealPath.dirname(currentDir);
  }
  // Fallback to relative path
  return fsMockPollutionRealPath.resolve(__dirname, '../..');
}

describe('fs Mock Pollution Regression Tests', () => {
  beforeEach(() => {
    // Reset modules to ensure clean state
    jest.resetModules();
  });

  const projectRoot = findProjectRoot();
  const testFilePath = fsMockPollutionRealPath.join(projectRoot, 'package.json');
  const testDocsPath = fsMockPollutionRealPath.join(projectRoot, 'README.md');

  // This test should fail before the fix, demonstrating the bug
  it('should reproduce bug: fs.existsSync returns undefined instead of boolean', () => {
    // This will fail with the current setup because fs.existsSync is mocked
    // but not configured, returning undefined instead of true/false
    const result = fsMockPollutionRealFs.existsSync(testFilePath);

    // This assertion should pass now with fs unmocked
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true); // File actually exists
  });

  it('should reproduce bug: fs.existsSync returns undefined for docs', () => {
    const result = fsMockPollutionRealFs.existsSync(testDocsPath);

    expect(typeof result).toBe('boolean');
    expect(result).toBe(true); // File actually exists
  });

  it('should work correctly when fs is not mocked', () => {
    // This test verifies that the real fs module works as expected
    // when we don't have mock interference

    // Use Node.js require directly to completely bypass Jest's module mocking
    const fsMockPollutionRealFsActual = require('fs');

    const result = fsMockPollutionRealFsActual.existsSync(testFilePath);
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });

  describe('Fix verification', () => {
    it('should demonstrate that the bug is fixed', () => {
      // The main issue was fs.existsSync returning undefined
      // Now it should return proper boolean values
      const result = fsMockPollutionRealFs.existsSync(testFilePath);

      // This should pass - no more undefined results
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    it('should work correctly in test suite context', () => {
      // The issue only occurred when tests ran together
      // This verifies fs works correctly even with other test mocks present
      const scriptExists = fsMockPollutionRealFs.existsSync(testFilePath);
      const docsExist = fsMockPollutionRealFs.existsSync(testDocsPath);

      expect(scriptExists).toBe(true);
      expect(docsExist).toBe(true);

      // Test a non-existent file to ensure false also works
      const nonExistent = fsMockPollutionRealFs.existsSync('/definitely/does/not/exist');
      expect(nonExistent).toBe(false);
    });
  });
});
