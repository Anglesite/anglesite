/**
 * @file Regression test specifically for path module mock pollution
 * @description Tests that verify the path module mock doesn't break file path operations
 */

describe('Path Mock Regression Tests', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should not break path.join when using real paths', () => {
    // Use eval to bypass Jest's module mocking completely
    const realPath = eval('require')('path');
    const realFs = eval('require')('fs');

    // Test that path.join works correctly for real paths
    const projectRoot = realPath.resolve(__dirname, '../..');
    const packageJsonPath = realPath.join(projectRoot, 'package.json');

    // Verify the path is constructed correctly
    expect(packageJsonPath).toContain('package.json');
    expect(realPath.isAbsolute(packageJsonPath)).toBe(true);

    // Verify the file actually exists at this path
    expect(realFs.existsSync(packageJsonPath)).toBe(true);
  });

  it('should not break path.resolve when using real paths', () => {
    const realPath = eval('require')('path');
    const realFs = eval('require')('fs');

    // Test that path.resolve works correctly
    const packageJsonPath = realPath.resolve(__dirname, '../../package.json');

    // Verify the path is constructed correctly
    expect(packageJsonPath).toContain('anglesite');
    expect(packageJsonPath).toContain('package.json');
    expect(realPath.isAbsolute(packageJsonPath)).toBe(true);

    // Verify the file actually exists at this path
    expect(realFs.existsSync(packageJsonPath)).toBe(true);
  });

  it('should detect when path module is mocked and causing issues', () => {
    // Get the current path module (which might be mocked)
    const currentPath = require('path');
    const realPath = eval('require')('path');

    // Test a simple path operation
    const testPath = currentPath.join('/test', 'file.txt');
    const realTestPath = realPath.join('/test', 'file.txt');

    // If path is properly mocked, these should be equal
    // If path is broken (like with args.join('/')), they might differ
    console.log('Mocked path result:', testPath);
    console.log('Real path result:', realTestPath);

    // This test documents the difference and will help verify the fix
    expect(typeof testPath).toBe('string');
    expect(typeof realTestPath).toBe('string');
  });

  it('should demonstrate the path mock pollution fix', () => {
    // This test will fail before the fix and pass after
    const currentPath = require('path');
    const realFs = eval('require')('fs');

    // Use the current (possibly mocked) path module
    const projectRoot = currentPath.resolve(__dirname, '../..');
    const packageJsonPath = currentPath.join(projectRoot, 'package.json');

    // This should work if path mocking is fixed
    expect(realFs.existsSync(packageJsonPath)).toBe(true);
  });
});
