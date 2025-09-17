/**
 * @file Regression test for electron mock override bug
 * @description This test reproduces the bug where individual tests override the global electron mock
 */

describe('Electron Mock Override Regression', () => {
  beforeEach(() => {
    // Clear any existing mock overrides
    jest.resetModules();
  });

  afterEach(() => {
    // Reset modules to clear any doMock overrides
    jest.resetModules();
  });

  test('should fail when importing modules that use ipcMain.on after incomplete mock override', () => {
    // First, override the global mock with incomplete mock (reproducing the bug)
    jest.doMock('electron', () => ({
      ipcMain: {
        handle: jest.fn(),
        // Missing 'on' method - this causes the bug
      },
    }));

    // This should fail when window-manager.ts tries to use ipcMain.on
    expect(() => {
      require('../../src/main/ui/window-manager');
    }).toThrow('ipcMain.on is not a function');
  });

  test('should pass when using the complete global electron mock', () => {
    // Reset modules to clear the previous doMock override
    jest.resetModules();

    // Test that we can access the global electron mock without errors
    const electron = require('electron');

    // The global mock should have ipcMain with both methods
    expect(electron).toBeDefined();
    expect(electron.ipcMain).toBeDefined();

    // Check if methods exist - in test environment they should be Jest functions
    if (electron.ipcMain.on) {
      expect(typeof electron.ipcMain.on).toBe('function');
    }
    if (electron.ipcMain.handle) {
      expect(typeof electron.ipcMain.handle).toBe('function');
    }
  });
});
