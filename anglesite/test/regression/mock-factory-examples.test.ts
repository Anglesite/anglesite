/**
 * @file Mock Factory Examples Integration Tests
 * @description Verifies that the examples in mock factory documentation actually work
 */

import { createMockAppContextValue, createMockWebsiteConfig, createPlatformGuard } from '../utils/mock-factory';

describe('Mock Factory Examples Integration', () => {
  describe('createMockAppContextValue examples', () => {
    test('basic usage with default test values works', () => {
      // Example from documentation
      const mockContext = createMockAppContextValue();

      // Verify the documented defaults
      expect(mockContext.state.websiteName).toBe('test-website');
      expect(mockContext.state.currentView).toBe('website-config');
      expect(mockContext.state.selectedFile).toBe(null);
      expect(mockContext.state.loading).toBe(false);
    });

    test('override specific state for testing scenarios works', () => {
      // Example from documentation
      const loadingContext = createMockAppContextValue({
        websiteName: 'my-test-site',
        loading: true,
      });

      // Verify overrides work as documented
      expect(loadingContext.state.websiteName).toBe('my-test-site');
      expect(loadingContext.state.loading).toBe(true);
      // Other properties should keep defaults
      expect(loadingContext.state.currentView).toBe('website-config');
    });

    test('context methods are Jest mocks as documented', () => {
      const mockContext = createMockAppContextValue();

      // Verify all setter functions are Jest mocks
      expect(jest.isMockFunction(mockContext.setCurrentView)).toBe(true);
      expect(jest.isMockFunction(mockContext.setSelectedFile)).toBe(true);
      expect(jest.isMockFunction(mockContext.setWebsiteName)).toBe(true);
      expect(jest.isMockFunction(mockContext.setWebsitePath)).toBe(true);
      expect(jest.isMockFunction(mockContext.setLoading)).toBe(true);
    });
  });

  describe('createMockWebsiteConfig examples', () => {
    test('basic configuration with defaults works', () => {
      // Example from documentation
      const config = createMockWebsiteConfig();
      expect(config.title).toBe('Test Website');
      expect(config.language).toBe('en');
      expect(config.description).toBe('A test website configuration');
      expect(config.author).toEqual({
        name: 'Test Author',
        email: 'test@example.com',
      });
    });

    test('override specific properties for testing works', () => {
      // Example from documentation
      const customConfig = createMockWebsiteConfig({
        title: 'My Custom Site',
        url: 'https://example.com',
        author: { name: 'John Doe', email: 'john@example.com' },
      });

      expect(customConfig.title).toBe('My Custom Site');
      expect((customConfig as Record<string, unknown>).url).toBe('https://example.com');
      expect(customConfig.author).toEqual({ name: 'John Doe', email: 'john@example.com' });
      // Non-overridden properties should keep defaults
      expect(customConfig.language).toBe('en');
      expect(customConfig.description).toBe('A test website configuration');
    });
  });

  describe('createPlatformGuard examples', () => {
    test('platform modification and restoration works as documented', () => {
      const originalPlatform = process.platform;

      // Example pattern from documentation
      const platformGuard = createPlatformGuard();

      // Test Windows platform setting
      platformGuard.setPlatform('win32');
      expect(process.platform).toBe('win32');

      // Test macOS platform setting
      platformGuard.setPlatform('darwin');
      expect(process.platform).toBe('darwin');

      // Test restoration
      platformGuard.restore();
      expect(process.platform).toBe(originalPlatform);
    });

    test('multiple platform guards work independently', () => {
      const originalPlatform = process.platform;

      const guard1 = createPlatformGuard();
      guard1.setPlatform('win32');

      const guard2 = createPlatformGuard(); // Should capture win32 as original
      guard2.setPlatform('linux');
      expect(process.platform).toBe('linux');

      // Restore guard2 should go back to win32
      guard2.restore();
      expect(process.platform).toBe('win32');

      // Restore guard1 should go back to original
      guard1.restore();
      expect(process.platform).toBe(originalPlatform);
    });
  });
});
