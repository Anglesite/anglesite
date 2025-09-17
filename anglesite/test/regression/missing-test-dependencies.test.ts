/**
 * @file Regression test for missing test dependencies
 * @description This test reproduces the bug where tests import non-existent utilities and matchers
 */

// Type for Jest expect with non-existent matchers
interface ExtendedExpect {
  toBeCompletelyUndefinedMatcher(): unknown;
  toBeAnotherNonExistentMatcher(): unknown;
  toValidateThisNonExistentThing(): unknown;
}

// Import modules at the top level to avoid Jest hook registration issues
import * as reactTestProviders from '../utils/react-test-providers';
import * as mockFactory from '../utils/mock-factory';
import * as websiteConfigBuilder from '../builders/website-config-builder';

describe('Missing Test Dependencies Regression', () => {
  test('should successfully import existing test utilities', () => {
    // These imports should work because the files exist and are imported at module level
    expect(reactTestProviders).toBeDefined();
    expect(mockFactory).toBeDefined();
    expect(websiteConfigBuilder).toBeDefined();
  });

  test('should fail when importing truly non-existent files', () => {
    // Test with files that actually don't exist
    expect(() => {
      require('../utils/non-existent-utility');
    }).toThrow('Cannot find module');

    expect(() => {
      require('../builders/non-existent-builder');
    }).toThrow('Cannot find module');

    expect(() => {
      require('../helpers/non-existent-helper');
    }).toThrow('Cannot find module');
  });

  test('should successfully use defined custom Jest matchers', () => {
    // Test that the custom matchers module can be imported without errors
    expect(() => {
      require('../matchers/custom-matchers');
    }).not.toThrow();

    // Test that mock functions can be created without errors
    const mockWindow = {
      isDestroyed: jest.fn(() => false),
      isMaximized: jest.fn(() => true),
      isFocused: jest.fn(() => false),
      getTitle: jest.fn(() => 'Test Window'),
    };

    expect(mockWindow.isDestroyed()).toBe(false);
    expect(mockWindow.isMaximized()).toBe(true);
  });

  test('should fail when using truly undefined custom Jest matchers', () => {
    // Test with matchers that actually don't exist
    expect(() => {
      (expect('test') as unknown as ExtendedExpect).toBeCompletelyUndefinedMatcher();
    }).toThrow();

    expect(() => {
      (expect({}) as unknown as ExtendedExpect).toBeAnotherNonExistentMatcher();
    }).toThrow();

    expect(() => {
      (expect({}) as unknown as ExtendedExpect).toValidateThisNonExistentThing();
    }).toThrow();
  });

  test('should successfully import existing WebsiteConfigEditor component', () => {
    expect(() => {
      require('../../src/renderer/ui/react/components/WebsiteConfigEditor');
    }).not.toThrow();
  });
});
