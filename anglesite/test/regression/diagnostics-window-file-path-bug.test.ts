/**
 * @file Regression test for diagnostics window file path bug
 * @description Tests that the DiagnosticsWindowManager correctly resolves the path
 * to diagnostics.html file when creating the window.
 *
 * Bug: DiagnosticsWindowManager uses incorrect relative path '../renderer/diagnostics.html'
 * instead of '../../renderer/diagnostics.html', causing ERR_FILE_NOT_FOUND when
 * trying to open the diagnostics window.
 */

import * as path from 'path';

// Mock file system to verify path resolution
const mockLoadFile = jest.fn();

// Mock electron modules first
jest.mock('electron', () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    id: 1,
    loadFile: mockLoadFile,
    on: jest.fn(),
    once: jest.fn(),
    show: jest.fn(),
    focus: jest.fn(),
    close: jest.fn(),
    hide: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false),
    isVisible: jest.fn().mockReturnValue(true),
    getBounds: jest.fn().mockReturnValue({ x: 0, y: 0, width: 1200, height: 800 }),
    setBounds: jest.fn(),
    webContents: {
      on: jest.fn(),
      send: jest.fn(),
    },
  })),
  app: {
    getPath: jest.fn().mockReturnValue('/mock/path'),
  },
}));

import { DiagnosticsWindowManager } from '../../src/main/ui/diagnostics-window-manager';
import { IStore } from '../../src/main/core/interfaces';
import { BrowserWindow } from 'electron';

// Helper function to create a mock store
function createMockStore(): IStore {
  const defaultSettings = {
    autoDnsEnabled: false,
    httpsMode: false,
    firstLaunchCompleted: true,
    theme: 'system' as const,
    recentWebsites: [],
    windowStates: [],
  };

  return {
    get: jest.fn((key: string) => defaultSettings[key as keyof typeof defaultSettings]),
    set: jest.fn(),
    getAll: jest.fn(() => defaultSettings as any),
    setAll: jest.fn(),
    saveWindowStates: jest.fn(),
    getWindowStates: jest.fn(() => []),
    clearWindowStates: jest.fn(),
    addRecentWebsite: jest.fn(),
    getRecentWebsites: jest.fn(() => []),
    clearRecentWebsites: jest.fn(),
    removeRecentWebsite: jest.fn(),
    forceSave: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
  } as IStore;
}

describe('Regression: Diagnostics Window File Path Bug', () => {
  let diagnosticsWindowManager: DiagnosticsWindowManager;
  let mockStore: IStore;

  beforeEach(() => {
    mockStore = createMockStore();
    diagnosticsWindowManager = new DiagnosticsWindowManager(mockStore);

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    diagnosticsWindowManager.dispose();
  });

  describe('Bug Reproduction', () => {
    it('should attempt to load diagnostics.html file when creating window', async () => {
      // Act: Try to create the diagnostics window
      await diagnosticsWindowManager.createOrShowWindow();

      // Assert: Verify that loadFile was called
      expect(mockLoadFile).toHaveBeenCalledTimes(1);

      // Get the path that was attempted to be loaded
      const loadedPath = mockLoadFile.mock.calls[0][0];

      // The bug reproducer: verify what path is currently being used
      // This will show the incorrect path construction
      expect(typeof loadedPath).toBe('string');
      expect(loadedPath).toContain('diagnostics.html');
    });

    it('should show the incorrect path construction (reproduces bug)', async () => {
      // Simulate the current incorrect path construction that the manager uses
      // This represents the buggy behavior where the path is wrong

      // Mock __dirname to simulate the actual compiled location
      const mockDirname = '/dist/src/main/ui';
      const currentBuggyPath = path.join(mockDirname, '../renderer/diagnostics.html');
      const expectedCorrectPath = path.join(mockDirname, '../../renderer/diagnostics.html');

      // Show the bug: current path resolves incorrectly
      expect(path.normalize(currentBuggyPath)).toBe('/dist/src/main/renderer/diagnostics.html');

      // Show the fix: correct path resolves properly
      expect(path.normalize(expectedCorrectPath)).toBe('/dist/src/renderer/diagnostics.html');

      // The paths should be different (demonstrating the bug)
      expect(currentBuggyPath).not.toBe(expectedCorrectPath);
    });
  });

  describe('Path Resolution Analysis', () => {
    it('should demonstrate correct path resolution from main/ui to renderer', () => {
      // Test path resolution logic that should be used
      const mockMainUiDir = '/some/project/dist/src/main/ui';

      // Current (buggy) relative path
      const buggyRelativePath = '../renderer/diagnostics.html';
      const buggyFullPath = path.resolve(mockMainUiDir, buggyRelativePath);

      // Correct relative path
      const correctRelativePath = '../../renderer/diagnostics.html';
      const correctFullPath = path.resolve(mockMainUiDir, correctRelativePath);

      // Demonstrate the difference
      expect(buggyFullPath).toBe('/some/project/dist/src/main/renderer/diagnostics.html');
      expect(correctFullPath).toBe('/some/project/dist/src/renderer/diagnostics.html');

      // The correct path goes up two levels from main/ui to reach src/, then into renderer/
      expect(correctFullPath).toMatch(/\/dist\/src\/renderer\/diagnostics\.html$/);
      expect(correctFullPath).not.toMatch(/\/main\/renderer\/diagnostics\.html$/);
    });

    it('should handle different base directories correctly', () => {
      // Test only Unix-style paths for simplicity
      const testCases = [
        {
          baseDir: '/app/dist/src/main/ui',
          expectedPath: '/app/dist/src/renderer/diagnostics.html',
        },
        {
          baseDir: '/Users/test/project/dist/src/main/ui',
          expectedPath: '/Users/test/project/dist/src/renderer/diagnostics.html',
        },
      ];

      testCases.forEach(({ baseDir, expectedPath }) => {
        const resolvedPath = path.resolve(baseDir, '../../renderer/diagnostics.html');
        expect(path.normalize(resolvedPath)).toBe(path.normalize(expectedPath));
      });
    });
  });

  describe('Expected Behavior (After Fix)', () => {
    it('should resolve to the correct file path after fix', () => {
      // Test the behavior we expect after fixing the path
      const mockDirname = '/project/dist/src/main/ui';
      const fixedPath = path.join(mockDirname, '../../renderer/diagnostics.html');

      // After fix, this should resolve to the correct location
      expect(path.normalize(fixedPath)).toBe('/project/dist/src/renderer/diagnostics.html');
      expect(fixedPath).toMatch(/renderer\/diagnostics\.html$/);
      expect(fixedPath).not.toMatch(/main\/renderer/);
    });

    it('should create window with correct file path when fixed', async () => {
      // This test verifies the fix - it should load from renderer/ not main/renderer
      await diagnosticsWindowManager.createOrShowWindow();

      expect(mockLoadFile).toHaveBeenCalledTimes(1);
      const loadedPath = mockLoadFile.mock.calls[0][0];

      // After fix: The path should end with renderer/diagnostics.html (without main/)
      expect(loadedPath).toMatch(/renderer\/diagnostics\.html$/);
      expect(loadedPath).not.toMatch(/main\/renderer\/diagnostics\.html$/);
    });

    it('should handle window creation without throwing errors', async () => {
      // This should not throw when the correct path is used
      await expect(diagnosticsWindowManager.createOrShowWindow()).resolves.toBeDefined();

      // loadFile should be called with some path
      expect(mockLoadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple window creation attempts', async () => {
      // First creation
      const window1 = await diagnosticsWindowManager.createOrShowWindow();
      expect(window1).toBeDefined();

      // Second attempt should return existing window
      const window2 = await diagnosticsWindowManager.createOrShowWindow();
      expect(window2).toBe(window1);

      // loadFile should only be called once for the initial creation
      expect(mockLoadFile).toHaveBeenCalledTimes(1);
    });

    it('should handle window disposal and recreation', async () => {
      // Create window
      await diagnosticsWindowManager.createOrShowWindow();
      expect(mockLoadFile).toHaveBeenCalledTimes(1);

      // Dispose window
      diagnosticsWindowManager.dispose();

      // Create again - should call loadFile again
      await diagnosticsWindowManager.createOrShowWindow();
      expect(mockLoadFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('File System Integration', () => {
    it('should verify the expected file structure', () => {
      // Test assumes certain file structure exists
      // This is more of a documentation test to show expected layout

      const projectStructure = {
        'dist/src/main/ui/diagnostics-window-manager.js': 'compiled manager',
        'dist/src/renderer/diagnostics.html': 'target HTML file',
      };

      // The relative path from manager to HTML should be ../../renderer/
      const managerLocation = 'dist/src/main/ui';
      const htmlLocation = 'dist/src/renderer/diagnostics.html';

      // Calculate relative path
      const relativePath = path.relative(managerLocation, htmlLocation);
      expect(relativePath).toBe(path.normalize('../../renderer/diagnostics.html'));
    });
  });
});
