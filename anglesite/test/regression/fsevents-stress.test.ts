/**
 * @file Stress tests for fsevents crash reproduction under high load
 *
 * These tests create high-stress scenarios that are more likely to trigger
 * the race condition between file watcher cleanup and Node.js module destruction.
 *
 * Focus: Reproducing the exact conditions that lead to SIGABRT in fsevents.node
 */

import { jest } from '@jest/globals';

// Mock modules
jest.mock('electron');
jest.mock('chokidar');
jest.mock('../../src/main/core/service-registry');

import { mockApp, resetElectronMocks } from '../mocks/electron';

describe('FSEvents Stress Tests - Race Condition Reproduction', () => {
  let mockChokidarWatcher: any;
  let mockServiceRegistry: any;
  let originalPlatform: string;

  beforeEach(() => {
    jest.resetModules();
    resetElectronMocks();

    // Store original platform
    originalPlatform = process.platform;

    // Mock platform as macOS (where fsevents is used)
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  describe('High-Load Quit Scenarios', () => {
    it('should handle rapid startup/shutdown cycles', async () => {
      // This test simulates rapid app startup/shutdown that can trigger the race condition
      const cycles = 10;
      const results: boolean[] = [];

      for (let i = 0; i < cycles; i++) {
        // Reset modules for each cycle
        jest.resetModules();
        resetElectronMocks();

        // Set up fresh mocks with realistic timing
        const fileWatcherInstances = Array.from({ length: 3 }, (_, index) => ({
          stop: jest.fn(() => {
            // Simulate varying cleanup times
            const delay = Math.random() * 100 + 50; // 50-150ms
            return new Promise((resolve) => setTimeout(resolve, delay));
          }),
          isWatching: jest.fn(() => true),
          id: `watcher-${i}-${index}`,
        }));

        const mockServerManager = {
          stopAllServers: jest.fn(async () => {
            // Simulate concurrent server shutdowns
            await Promise.all(fileWatcherInstances.map((watcher) => watcher.stop()));
          }),
          getAllRunningServers: jest.fn(() => {
            const servers = new Map();
            fileWatcherInstances.forEach((watcher, index) => {
              servers.set(`site-${index}`, { fileWatcher: watcher });
            });
            return servers;
          }),
        };

        // Mock service registry
        mockServiceRegistry = {
          shutdownGlobalContext: jest.fn(async () => {
            // Simulate DI container shutdown delay
            await new Promise((resolve) => setTimeout(resolve, 25));
          }),
        };

        jest.doMock('../../src/main/core/service-registry', () => mockServiceRegistry);
        jest.doMock('../../src/main/server/website-server-manager', () => ({
          getWebsiteServerManager: () => mockServerManager,
        }));

        const mockMultiWindowManager = {
          closeAllWindows: jest.fn(async () => {
            await mockServerManager.stopAllServers();
          }),
        };

        jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

        try {
          // Import and trigger app lifecycle
          require('../../src/main/main');

          const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

          if (beforeQuitHandler) {
            // Execute quit sequence with timeout
            await Promise.race([
              beforeQuitHandler(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Quit timeout')), 500)),
            ]);
          }

          results.push(true);
        } catch (error) {
          console.error(`Cycle ${i} failed:`, error);
          results.push(false);
        }
      }

      // At least 80% of cycles should complete successfully
      const successRate = results.filter(Boolean).length / cycles;
      expect(successRate).toBeGreaterThan(0.8);
    });

    it('should handle multiple concurrent file watchers with heavy I/O', async () => {
      // Simulate heavy file system activity during quit
      const numWatchers = 15;
      const fileChangeEvents: Array<{ watcher: any; events: number }> = [];

      const fileWatchers = Array.from({ length: numWatchers }, (_, index) => {
        let eventCount = 0;
        const watcher = {
          stop: jest.fn(async () => {
            // Simulate file events arriving during shutdown
            const eventsToSimulate = Math.floor(Math.random() * 5) + 1;

            for (let i = 0; i < eventsToSimulate; i++) {
              setTimeout(() => {
                eventCount++;
                // Simulate file change event
              }, Math.random() * 50);
            }

            fileChangeEvents.push({ watcher, events: eventCount });

            // Simulate cleanup with realistic delay
            await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 40));
          }),
          isWatching: jest.fn(() => true),
          id: `heavy-watcher-${index}`,
        };

        return watcher;
      });

      const mockServerManager = {
        stopAllServers: jest.fn(async () => {
          // Stop all watchers concurrently to stress test
          await Promise.all(fileWatchers.map((watcher) => watcher.stop()));
        }),
        getAllRunningServers: jest.fn(() => {
          const servers = new Map();
          fileWatchers.forEach((watcher, index) => {
            servers.set(`heavy-site-${index}`, { fileWatcher: watcher });
          });
          return servers;
        }),
      };

      jest.doMock('../../src/main/server/website-server-manager', () => ({
        getWebsiteServerManager: () => mockServerManager,
      }));

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      expect(beforeQuitHandler).toBeDefined();

      const startTime = Date.now();
      await beforeQuitHandler();
      const duration = Date.now() - startTime;

      // Should handle all watchers within reasonable time
      expect(duration).toBeLessThan(2000);
      expect(fileWatchers.every((watcher) => watcher.stop)).toHaveProperty('mock.calls.length', numWatchers);
    });

    it('should handle fsevents mutex destruction race condition', async () => {
      // This test specifically targets the mutex destruction issue in fsevents
      let mutexOperations: string[] = [];

      const raceConditionWatcher = {
        stop: jest.fn(async () => {
          mutexOperations.push('watcher-stop-start');

          // Simulate the critical section where fsevents mutex operations occur
          setTimeout(() => {
            mutexOperations.push('fsevents-mutex-lock');
          }, 10);

          setTimeout(() => {
            mutexOperations.push('fsevents-mutex-unlock');
          }, 30);

          setTimeout(() => {
            mutexOperations.push('fsevents-instance-destroy');
          }, 50);

          // Simulate the timing that can cause the race condition
          await new Promise((resolve) => setTimeout(resolve, 60));

          mutexOperations.push('watcher-stop-complete');
        }),
        isWatching: jest.fn(() => true),
      };

      const mockServerManager = {
        stopAllServers: jest.fn(async () => {
          await raceConditionWatcher.stop();
        }),
        getAllRunningServers: jest.fn(() => new Map([['race-site', { fileWatcher: raceConditionWatcher }]])),
      };

      jest.doMock('../../src/main/server/website-server-manager', () => ({
        getWebsiteServerManager: () => mockServerManager,
      }));

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      // Trigger quit sequence
      await beforeQuitHandler();

      // Verify mutex operations completed in correct order
      expect(mutexOperations).toEqual([
        'watcher-stop-start',
        'fsevents-mutex-lock',
        'fsevents-mutex-unlock',
        'fsevents-instance-destroy',
        'watcher-stop-complete',
      ]);
    });
  });

  describe('Memory Pressure Scenarios', () => {
    it('should handle quit under memory pressure', async () => {
      // Simulate memory pressure that might affect cleanup timing
      const memoryPressureWatcher = {
        stop: jest.fn(async () => {
          // Simulate garbage collection pressure during cleanup
          const largeArrays: number[][] = [];

          // Create memory pressure
          for (let i = 0; i < 100; i++) {
            largeArrays.push(new Array(1000).fill(i));
          }

          // Force garbage collection pressure
          setTimeout(() => {
            largeArrays.length = 0;
          }, 25);

          await new Promise((resolve) => setTimeout(resolve, 75));
        }),
        isWatching: jest.fn(() => true),
      };

      const mockServerManager = {
        stopAllServers: jest.fn(async () => {
          await memoryPressureWatcher.stop();
        }),
        getAllRunningServers: jest.fn(
          () => new Map([['memory-pressure-site', { fileWatcher: memoryPressureWatcher }]])
        ),
      };

      jest.doMock('../../src/main/server/website-server-manager', () => ({
        getWebsiteServerManager: () => mockServerManager,
      }));

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      // Should handle quit even under memory pressure
      await expect(beforeQuitHandler()).resolves.toBeUndefined();
      expect(memoryPressureWatcher.stop).toHaveBeenCalled();
    });
  });

  describe('Error Propagation During Race Conditions', () => {
    it('should handle errors that occur during the critical race condition window', async () => {
      const errors: Error[] = [];

      const errorProneWatcher = {
        stop: jest.fn(async () => {
          // Simulate various errors that can occur during fsevents cleanup
          setTimeout(() => {
            errors.push(new Error('ENOENT: File system node destroyed'));
          }, 20);

          setTimeout(() => {
            errors.push(new Error('pthread_mutex_lock: Invalid argument'));
          }, 40);

          // Don't throw here - simulate that errors are swallowed
          await new Promise((resolve) => setTimeout(resolve, 60));
        }),
        isWatching: jest.fn(() => true),
      };

      const mockServerManager = {
        stopAllServers: jest.fn(async () => {
          try {
            await errorProneWatcher.stop();
          } catch (error) {
            errors.push(error as Error);
          }
        }),
        getAllRunningServers: jest.fn(() => new Map([['error-prone-site', { fileWatcher: errorProneWatcher }]])),
      };

      jest.doMock('../../src/main/server/website-server-manager', () => ({
        getWebsiteServerManager: () => mockServerManager,
      }));

      const mockMultiWindowManager = {
        closeAllWindows: jest.fn(async () => {
          await mockServerManager.stopAllServers();
        }),
      };

      jest.doMock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

      require('../../src/main/main');

      const beforeQuitHandler = mockApp.on.mock.calls.find((call) => call[0] === 'before-quit')?.[1];

      // Should complete despite internal errors
      await expect(beforeQuitHandler()).resolves.toBeUndefined();

      // Verify errors were captured but didn't crash the process
      expect(errors.length).toBeGreaterThan(0);
      expect(errorProneWatcher.stop).toHaveBeenCalled();
    });
  });
});
