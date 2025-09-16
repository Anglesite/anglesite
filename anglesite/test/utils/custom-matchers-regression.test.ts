/**
 * @file Regression test for custom matchers setup
 * @description Verifies that custom Jest matchers can be loaded without "expect is not defined" errors
 */

describe('Custom Matchers Regression Test', () => {
  it('should have custom matchers available without initialization errors', () => {
    // This test exists to verify that the Jest setup completes successfully
    // and custom matchers are available. The fact that this test runs at all
    // proves that the "expect is not defined" bug is fixed.

    const testConfig = {
      title: 'Test Website',
      url: 'https://example.com',
      language: 'en',
    };

    // Test that our custom matchers work
    expect(testConfig).toBeValidWebsiteConfig();
    expect('valid-website-name').toBeValidWebsiteName();
    expect('malicious../path').not.toBeValidWebsiteName();
    expect('https://valid.com').toBeValidURL();
    expect('{"valid": "json"}').toBeValidJSON();

    // If this test passes, it means:
    // 1. Jest initialized successfully
    // 2. Custom matchers were registered in setupFilesAfterEnv
    // 3. The "expect is not defined" error is resolved
  });

  it('should not have registration timing issues', () => {
    // This verifies that expect is available when custom matchers are registered
    expect(typeof expect).toBe('function');
    expect(typeof expect.extend).toBe('function');

    // Test that Jest globals are available
    expect(typeof beforeEach).toBe('function');
    expect(typeof afterEach).toBe('function');
    expect(typeof describe).toBe('function');
    expect(typeof it).toBe('function');
  });
});
