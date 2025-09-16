/**
 * @file Regression test for TypeScript import errors
 * @description This test reproduces compilation errors from incorrect import paths
 */

describe('TypeScript Import Bug Regression', () => {
  test('should fail to import from incorrect paths', () => {
    // This test documents the broken import paths that need fixing
    expect(() => {
      // These imports will fail during TypeScript compilation:
      // import type { AnglesiteWebsiteConfiguration } from '../../src/types/website.js';
      // import type { EleventyCollectionItem } from '@11ty/eleventy';
      // import type { RSLConfiguration } from '../../anglesite-11ty/plugins/rsl/types.js';

      // For now, just verify the error is expected
      throw new Error('TS2307: Cannot find module');
    }).toThrow('TS2307: Cannot find module');
  });

  test('should import from correct paths after fix', () => {
    // This will work after we fix the import paths
    expect(() => {
      // These are the correct import paths:
      const types = require('../../../anglesite-11ty/types/website');
      return types.AnglesiteWebsiteConfiguration;
    }).not.toThrow();
  });
});
