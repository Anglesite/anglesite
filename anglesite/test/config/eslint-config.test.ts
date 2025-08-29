/**
 * @file Tests for ESLint configuration, especially JavaScript mock file support
 */

import * as fs from 'fs';
import * as path from 'path';

interface ESLintConfigItem {
  files?: string[];
  languageOptions?: {
    globals?: Record<string, unknown>;
  };
}

describe('ESLint Configuration', () => {
  let eslintConfig: ESLintConfigItem[];

  beforeAll(() => {
    // Load the ESLint configuration
    // Use require.resolve to get the actual path and delete from cache
    delete require.cache[require.resolve('../../eslint.config.cjs')];
    eslintConfig = require('../../eslint.config.cjs');
  });

  it('should have configuration for JavaScript test files', () => {
    expect(Array.isArray(eslintConfig)).toBe(true);

    // Find the configuration for JavaScript test files
    const jsTestConfig = eslintConfig.find((config) => config.files && config.files.includes('test/**/*.js'));

    expect(jsTestConfig).toBeDefined();
    expect(jsTestConfig?.languageOptions).toBeDefined();
  });

  it('should include Jest globals for JavaScript test files', () => {
    const jsTestConfig = eslintConfig.find((config) => config.files && config.files.includes('test/**/*.js'));

    expect(jsTestConfig?.languageOptions?.globals).toBeDefined();
    expect(jsTestConfig?.languageOptions?.globals).toHaveProperty('jest');
    expect(jsTestConfig?.languageOptions?.globals).toHaveProperty('describe');
    expect(jsTestConfig?.languageOptions?.globals).toHaveProperty('it');
    expect(jsTestConfig?.languageOptions?.globals).toHaveProperty('expect');
  });

  it('should have proper configuration for TypeScript test files', () => {
    const tsTestConfig = eslintConfig.find((config) => config.files && config.files.includes('test/**/*.ts'));

    expect(tsTestConfig).toBeDefined();
    expect(tsTestConfig?.languageOptions?.globals).toHaveProperty('jest');
  });

  it('should validate that mock files exist and follow naming convention', () => {
    const mockDir = path.resolve(process.cwd(), 'test/mocks/__mocks__');
    expect(fs.existsSync(mockDir)).toBe(true);

    const mockFiles = fs.readdirSync(mockDir);
    expect(mockFiles.length).toBeGreaterThan(0);

    // Check that mock files are JavaScript files
    const jsFiles = mockFiles.filter((file) => file.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    // Verify specific mock files exist
    expect(mockFiles).toContain('bagit-fs.js');
    expect(mockFiles).toContain('eleventy.js');
    expect(mockFiles).toContain('eleventy-dev-server.js');
  });

  it('should allow mock files to use Jest globals without errors', () => {
    const jestMockFiles = ['test/mocks/__mocks__/bagit-fs.js', 'test/mocks/__mocks__/eleventy-dev-server.js'];

    const classBasedMockFiles = ['test/mocks/__mocks__/eleventy.js'];

    // Check files that use jest.fn
    jestMockFiles.forEach((filePath) => {
      const fullPath = path.resolve(process.cwd(), filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const content = fs.readFileSync(fullPath, 'utf8');
      // These mocks use custom jestFn instead of jest.fn
      expect(content.includes('jestFn') || content.includes('jest.fn')).toBe(true);
    });

    // Check class-based mocks that don't necessarily use jest.fn
    classBasedMockFiles.forEach((filePath) => {
      const fullPath = path.resolve(process.cwd(), filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content.includes('class Mock')).toBe(true);
    });
  });
});
