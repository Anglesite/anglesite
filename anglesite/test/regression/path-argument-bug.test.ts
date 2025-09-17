/**
 * @file Regression test for path argument undefined error
 * @description This test reproduces the bug where relativePath is undefined in IPC handlers
 */

describe('Path Argument Bug Regression', () => {
  test('should reproduce undefined relativePath error', () => {
    const mockPath = require('path');

    // Simulate the exact error condition
    const websitePath = '/test/path/website';
    const relativePath = undefined; // This is the problematic value

    expect(() => {
      // This is the exact line that fails in the original code
      mockPath.join(websitePath, relativePath);
    }).toThrow('The "path" argument must be of type string. Received undefined');
  });

  test('should work with proper string arguments', () => {
    const mockPath = require('path');

    const websitePath = '/test/path/website';
    const relativePath = 'src/_data/website.json';

    expect(() => {
      const result = mockPath.join(websitePath, relativePath);
      expect(result).toBe('/test/path/website/src/_data/website.json');
    }).not.toThrow();
  });

  test('should validate parameters before path operations', () => {
    // This test demonstrates the fix we need to implement
    const validateAndJoinPath = (websitePath: string, relativePath: string) => {
      if (!websitePath || !relativePath) {
        throw new Error('Website name and file path are required');
      }
      if (typeof relativePath !== 'string') {
        throw new Error('Relative path must be a string');
      }
      return require('path').join(websitePath, relativePath);
    };

    expect(() => {
      validateAndJoinPath('/test/path', undefined as unknown as string);
    }).toThrow('Website name and file path are required');

    expect(() => {
      validateAndJoinPath('/test/path', 'valid/path.json');
    }).not.toThrow();
  });
});
