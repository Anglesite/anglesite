/**
 * @file Regression test for Jest module mocking timing issues
 * @description Reproduces the bug where jest.doMock() inside beforeAll() doesn't affect ES6 imports
 */

describe('Jest Module Mocking Timing Regression', () => {
  describe('Problematic Pattern - Mock in beforeAll (should fail)', () => {
    let mockHandlers: Record<string, (...args: unknown[]) => unknown>;

    beforeAll(() => {
      // This is the PROBLEMATIC pattern from the failing integration test
      // jest.doMock() inside beforeAll() is too late for ES6 imports
      jest.doMock('../../src/main/utils/website-manager', () => ({
        getWebsitePath: jest.fn((_websiteName: string) => {
          // Return null to trigger the error condition that should be tested
          return null;
        }),
      }));

      // Track registered handlers like the integration test does
      mockHandlers = {};
      const { ipcMain } = require('electron');
      (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
        mockHandlers[channel] = handler;
      });

      // Import handlers AFTER mock (but this won't work due to ES6 import timing)
      const { setupReactEditorHandlers } = require('../../src/main/ipc/react-editor');
      setupReactEditorHandlers();
    });

    afterAll(() => {
      jest.resetModules();
    });

    test('should fail because mock is not applied to ES6 imports', async () => {
      const mockEvent = { sender: {} };
      const getFileHandler = mockHandlers['get-file-content'];

      expect(getFileHandler).toBeDefined();

      // This should fail with "Unable to get website path" because the mock doesn't work
      await expect(getFileHandler(mockEvent, 'test-website', 'test.json')).rejects.toThrow(
        'Unable to get website path for: test-website'
      );
    });
  });

  describe('Working Pattern - Mock at top level (should pass)', () => {
    // This test demonstrates the CORRECT approach
    test('should work when using proper mock timing', async () => {
      // Clear any previous mocks
      jest.resetModules();

      // Apply mock at top level BEFORE any imports
      jest.doMock('../../src/main/utils/website-manager', () => ({
        getWebsitePath: jest.fn((_websiteName: string) => {
          return `/working/mocked/path/${_websiteName}`;
        }),
      }));

      // Use dynamic import to respect the mock
      const { getWebsitePath } = await import('../../src/main/utils/website-manager');

      // This should work because the mock was applied before import
      const result = getWebsitePath('test-website');
      expect(result).toBe('/working/mocked/path/test-website');
      expect(jest.isMockFunction(getWebsitePath)).toBe(true);
    });
  });
});
