/**
 * @file Regression test for fs mock pollution issue
 * @description Tests that reproduce the bug where fs.existsSync returns undefined
 * when global fs mocks interfere with tests that expect real filesystem behavior
 */

import * as fs from 'fs';
import * as path from 'path';

describe('fs Mock Pollution Regression Tests', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const testFilePath = path.join(projectRoot, 'scripts/bundle-summary.js');
  const testDocsPath = path.join(projectRoot, 'docs/bundle-analysis.md');

  // This test should fail before the fix, demonstrating the bug
  it('should reproduce bug: fs.existsSync returns undefined instead of boolean', () => {
    // This will fail with the current setup because fs.existsSync is mocked
    // but not configured, returning undefined instead of true/false
    const result = fs.existsSync(testFilePath);

    // Log what we actually get to verify the bug
    console.log('fs.existsSync result type:', typeof result);
    console.log('fs.existsSync result value:', result);

    // This assertion should fail in the current buggy state
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true); // File actually exists
  });

  it('should reproduce bug: fs.existsSync returns undefined for docs', () => {
    const result = fs.existsSync(testDocsPath);

    console.log('docs fs.existsSync result type:', typeof result);
    console.log('docs fs.existsSync result value:', result);

    expect(typeof result).toBe('boolean');
    expect(result).toBe(true); // File actually exists
  });

  it('should work correctly when fs is not mocked', () => {
    // This test verifies that the real fs module works as expected
    // when we don't have mock interference

    // Use require() to potentially bypass Jest's module mocking
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const realFs = jest.requireActual('fs');

    const result = realFs.existsSync(testFilePath);
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });

  describe('Fix verification', () => {
    it('should demonstrate that the bug is fixed', () => {
      // The main issue was fs.existsSync returning undefined
      // Now it should return proper boolean values
      const result = fs.existsSync(testFilePath);

      // This should pass - no more undefined results
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    it('should work correctly in test suite context', () => {
      // The issue only occurred when tests ran together
      // This verifies fs works correctly even with other test mocks present
      const scriptExists = fs.existsSync(testFilePath);
      const docsExist = fs.existsSync(testDocsPath);

      expect(scriptExists).toBe(true);
      expect(docsExist).toBe(true);

      // Test a non-existent file to ensure false also works
      const nonExistent = fs.existsSync('/definitely/does/not/exist');
      expect(nonExistent).toBe(false);
    });
  });
});
