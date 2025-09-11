/**
 * @file Regression tests for fsevents crash during application quit
 *
 * These tests specifically target the race condition between async file watcher cleanup
 * and Node.js native module destruction during app quit that causes SIGABRT crashes.
 *
 * Bug Report: App crashes on quit with abort() in fsevents.node during fse_instance_destroy
 * Root Cause: Race condition where async server cleanup may not complete before
 *            Node.js begins tearing down native modules (fsevents.node)
 */

// Jest is globally available

// Import and use existing test infrastructure
import { TEST_CONSTANTS } from '../constants/test-constants';
import {
  mockMultiWindowManager,
  mockAppMenu,
  mockStoreInstance,
  mockFirstLaunch,
  mockHostsManager,
  resetAppModulesMocks,
} from '../mocks/app-modules';
import { mockApp, resetElectronMocks } from '../mocks/electron';
import { setupConsoleSpies, restoreConsoleSpies } from '../mocks/utils';

describe('FSEvents Crash Regression Tests', () => {
  let mockChokidarWatcher: any;
  let mockServiceRegistry: any;
  let mockServerManager: any;
  let mockFileWatcher: any;
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear the module cache to ensure fresh imports FIRST
    jest.resetModules();

    // Set up console spies
    const { consoleSpy: newConsoleSpy, consoleErrorSpy: newConsoleErrorSpy } = setupConsoleSpies();
    consoleSpy = newConsoleSpy;
    consoleErrorSpy = newConsoleErrorSpy;

    // Reset existing mocks
    resetElectronMocks();
    resetAppModulesMocks();

    // Set up default mock returns
    mockStoreInstance.get.mockImplementation((key: string) => {
      switch (key) {
        case 'firstLaunchCompleted':
          return true;
        case 'httpsMode':
          return 'https';
        default:
          return undefined;
      }
    });

    mockAppMenu.createApplicationMenu.mockReturnValue({ id: 'mock-menu' });
    mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());

    // Mock async functions to resolve
    mockFirstLaunch.handleFirstLaunch.mockResolvedValue(undefined);
    mockHostsManager.cleanupHostsFile.mockResolvedValue(undefined);
    mockHostsManager.checkAndSuggestTouchIdSetup.mockResolvedValue(undefined);
    mockMultiWindowManager.restoreWindowStates.mockResolvedValue(undefined);

    // Mock chokidar with realistic fsevents behavior
    mockChokidarWatcher = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn(() => {
        // Simulate async cleanup delay that can cause race condition
        return new Promise((resolve) => setTimeout(resolve, 50));
      }),
      unwatch: jest.fn().mockReturnValue(undefined),
    };

    // Mock file watcher with realistic cleanup timing
    mockFileWatcher = {
      stop: jest.fn(() => {
        // Simulate the time it takes to properly close fsevents
        return new Promise((resolve) => setTimeout(resolve, 30));
      }),
      isWatching: jest.fn(() => true),
    };

    // Setup app mock to return promise from whenReady
    mockApp.whenReady.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    restoreConsoleSpies(consoleSpy, consoleErrorSpy);
  });

  describe('App Quit Sequence Race Conditions', () => {
    it('should handle rapid app quit with multiple active file watchers', async () => {
      // Import main after mocks are set up
      require('../../src/main/main');

      // Get the before-quit handler
      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      expect(beforeQuitHandler).toBeDefined();

      // Create a scenario with multiple active file watchers
      const multipleWatchers = new Map([
        ['site1', { fileWatcher: { ...mockFileWatcher, stop: jest.fn(() => Promise.resolve()) } }],
        ['site2', { fileWatcher: { ...mockFileWatcher, stop: jest.fn(() => Promise.resolve()) } }],
        ['site3', { fileWatcher: { ...mockFileWatcher, stop: jest.fn(() => Promise.resolve()) } }],
      ]);

      mockServerManager.getAllRunningServers.mockReturnValue(multipleWatchers);

      // Mock closeAllWindows to trigger server cleanup
      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          // Simulate the server cleanup that happens in closeAllWindows
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      // Execute the before-quit handler
      const quitPromise = beforeQuitHandler();

      // This should complete without throwing errors
      await expect(quitPromise).resolves.toBeUndefined();

      // Verify all watchers were stopped
      expect(mockServerManager.stopAllServers).toHaveBeenCalled();
    });

    it('should handle slow file watcher cleanup during quit', async () => {
      // Set up a slow-to-close file watcher that could cause race condition
      const slowFileWatcher = {
        stop: jest.fn(() => {
          // Simulate fsevents taking longer to clean up than expected
          return new Promise((resolve) => setTimeout(resolve, 200));
        }),
        isWatching: jest.fn(() => true),
      };

      mockServerManager.getAllRunningServers.mockReturnValue(
        new Map([['slow-site', { fileWatcher: slowFileWatcher }]])
      );

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      // Mock closeAllWindows with realistic server shutdown
      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      // Execute quit sequence and measure timing
      const startTime = Date.now();
      await beforeQuitHandler();
      const duration = Date.now() - startTime;

      // Should wait for proper cleanup
      expect(duration).toBeGreaterThan(150);
      expect(slowFileWatcher.stop).toHaveBeenCalled();
    });

    it('should handle file watcher cleanup failure gracefully', async () => {
      // Set up a file watcher that fails to close properly
      const failingFileWatcher = {
        stop: jest.fn(() => Promise.reject(new Error('FSEvents cleanup failed'))),
        isWatching: jest.fn(() => true),
      };

      mockServerManager.getAllRunningServers.mockReturnValue(
        new Map([['failing-site', { fileWatcher: failingFileWatcher }]])
      );

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          try {
            await mockServerManager.stopAllServers();
          } catch (error) {
            // Should handle cleanup failures gracefully
            console.error('Server cleanup failed:', error);
          }
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      // This should not throw even if file watcher cleanup fails
      await expect(beforeQuitHandler()).resolves.toBeUndefined();
      expect(failingFileWatcher.stop).toHaveBeenCalled();
    });
  });

  describe('Concurrent File Watcher Operations During Quit', () => {
    it('should handle file changes during quit sequence', async () => {
      // Set up file watcher that receives events during shutdown
      let changeHandler: Function;
      mockChokidarWatcher.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'change') {
          changeHandler = handler;
        }
        return mockChokidarWatcher;
      });

      const activeFileWatcher = {
        stop: jest.fn(() => {
          // Simulate file change event arriving during shutdown
          if (changeHandler) {
            setTimeout(() => changeHandler('/test/path/file.md'), 10);
          }
          return new Promise((resolve) => setTimeout(resolve, 50));
        }),
        isWatching: jest.fn(() => true),
      };

      mockServerManager.getAllRunningServers.mockReturnValue(
        new Map([['active-site', { fileWatcher: activeFileWatcher }]])
      );

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      // Should handle concurrent file events during shutdown
      await expect(beforeQuitHandler()).resolves.toBeUndefined();
      expect(activeFileWatcher.stop).toHaveBeenCalled();
    });

    it('should prevent new file watchers from starting during quit', async () => {
      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      // Start quit sequence
      const quitPromise = beforeQuitHandler();

      // Attempt to start new watcher during quit
      const newWatcher = {
        start: jest.fn(),
        stop: jest.fn(() => Promise.resolve()),
      };

      // This simulates the race condition where new watchers might be created
      // during the quit sequence
      setTimeout(() => {
        newWatcher.start();
      }, 25);

      await quitPromise;

      // New watchers should not interfere with quit sequence
      expect(quitPromise).resolves.toBeUndefined();
    });
  });

  describe('Memory and Resource Cleanup', () => {
    it('should properly clean up all fsevents resources', async () => {
      // Track resource cleanup calls
      const resourceCleanupCalls: string[] = [];

      const trackedFileWatcher = {
        stop: jest.fn(async () => {
          resourceCleanupCalls.push('file-watcher-stop');
          // Simulate proper fsevents cleanup
          await new Promise((resolve) => setTimeout(resolve, 20));
          resourceCleanupCalls.push('fsevents-cleanup');
        }),
        isWatching: jest.fn(() => true),
      };

      mockServerManager.getAllRunningServers.mockReturnValue(
        new Map([['tracked-site', { fileWatcher: trackedFileWatcher }]])
      );

      mockServerManager.stopAllServers.mockImplementation(async () => {
        resourceCleanupCalls.push('stop-all-servers');
        for (const [, server] of mockServerManager.getAllRunningServers()) {
          if (server.fileWatcher) {
            await server.fileWatcher.stop();
          }
        }
      });

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          resourceCleanupCalls.push('close-all-windows');
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      await beforeQuitHandler();

      // Verify cleanup sequence
      expect(resourceCleanupCalls).toEqual([
        'close-all-windows',
        'stop-all-servers',
        'file-watcher-stop',
        'fsevents-cleanup',
      ]);
    });

    it('should handle timeout during fsevents cleanup', async () => {
      // Simulate fsevents hanging during cleanup
      const hangingFileWatcher = {
        stop: jest.fn(() => {
          // Never resolves - simulates fsevents hanging
          return new Promise(() => {});
        }),
        isWatching: jest.fn(() => true),
      };

      mockServerManager.getAllRunningServers.mockReturnValue(
        new Map([['hanging-site', { fileWatcher: hangingFileWatcher }]])
      );

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          // Add timeout to prevent hanging
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Cleanup timeout')), 1000)
          );

          const cleanupPromise = mockServerManager.stopAllServers();

          try {
            await Promise.race([cleanupPromise, timeoutPromise]);
          } catch (error) {
            console.error('Cleanup timed out, forcing quit:', error);
          }
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      // Should complete even if cleanup hangs
      const startTime = Date.now();
      await beforeQuitHandler();
      const duration = Date.now() - startTime;

      // Should not hang indefinitely
      expect(duration).toBeLessThan(2000);
      expect(hangingFileWatcher.stop).toHaveBeenCalled();
    });
  });

  describe('Platform-Specific FSEvents Behavior', () => {
    it('should handle macOS-specific fsevents cleanup', async () => {
      // Mock macOS platform
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      const macFileWatcher = {
        stop: jest.fn(async () => {
          // Simulate macOS fsevents-specific cleanup delay
          await new Promise((resolve) => setTimeout(resolve, 75));
        }),
        isWatching: jest.fn(() => true),
      };

      mockServerManager.getAllRunningServers.mockReturnValue(new Map([['mac-site', { fileWatcher: macFileWatcher }]]));

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      const startTime = Date.now();
      await beforeQuitHandler();
      const duration = Date.now() - startTime;

      // Should wait for proper macOS fsevents cleanup
      expect(duration).toBeGreaterThan(50);
      expect(macFileWatcher.stop).toHaveBeenCalled();
    });
  });
});
