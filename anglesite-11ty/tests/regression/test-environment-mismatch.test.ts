/**
 * @file Regression test for test environment mismatch now fixed
 * @description Verifies that MockFactory now works correctly after environment fix
 */

/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-unused-expressions */

// Import the MockFactory that used to cause the issue
import { MockFactory } from '../../../anglesite/test/utils/mock-factory';

describe('Test Environment Mismatch Now Fixed', () => {
  test('should now work when MockFactory.resetAllMocks is called', () => {
    // Our setup file now provides a window object, so this should work
    expect(typeof window).toBe('object');

    // This should no longer fail with "ReferenceError: window is not defined"
    expect(() => {
      MockFactory.resetAllMocks();
    }).not.toThrow();
  });

  test('should demonstrate Node.js environment globals are still available', () => {
    // Verify we're still in Node.js environment (with polyfilled browser globals)
    expect(typeof process).toBe('object');
    expect(process.versions.node).toBeDefined();
    expect(typeof require).toBe('function');
    expect(typeof global).toBe('object');
  });

  test('should demonstrate that window is now polyfilled safely', () => {
    // window should now be available as a safe mock object
    expect(typeof window).toBe('object');
    expect(window).toBeDefined();

    // The electronAPI should be safely manageable
    expect(() => {
      // This should work now
      window.electronAPI;
    }).not.toThrow();
  });

  test('should show that MockFactory can safely access window now', () => {
    // The resetAllMocks method should no longer crash
    const mockFactorySource = MockFactory.resetAllMocks.toString();
    expect(mockFactorySource).toContain('window');
    expect(mockFactorySource).toContain('electronAPI');

    // And it should actually execute without error
    expect(() => MockFactory.resetAllMocks()).not.toThrow();
  });
});
