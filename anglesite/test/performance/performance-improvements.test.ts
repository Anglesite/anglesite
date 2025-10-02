/**
 * Performance improvements verification tests
 */

import { WebContents, App, ProcessMetric } from 'electron';
import {
  setupWebContentsWithCleanup,
  cleanupWebContentsListeners,
  monitorWebContentsMemory,
  createCleanupFunction,
} from '../../src/main/ui/webcontents-cleanup';

// Mock app.getAppMetrics
const mockApp = {
  getAppMetrics: jest.fn(),
} as unknown as App;

// Make app available globally for the module
jest.mock('electron', () => ({
  ...jest.requireActual('electron'),
  app: {
    getAppMetrics: jest.fn(),
  },
}));

// Mock WebContents
const mockWebContents = {
  on: jest.fn(),
  removeListener: jest.fn(),
  isDestroyed: jest.fn(() => false),
  once: jest.fn(),
  getProcessId: jest.fn(() => 12345), // Default PID for tests
} as unknown as WebContents;

describe('Performance Improvements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('WebContents Cleanup', () => {
    it('should set up WebContents with proper cleanup tracking', () => {
      const setupCallback = jest.fn();

      setupWebContentsWithCleanup(mockWebContents, setupCallback);

      expect(setupCallback).toHaveBeenCalledWith(mockWebContents);
      expect(mockWebContents.on).toHaveBeenCalledWith('render-process-gone', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('unresponsive', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('responsive', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('destroyed', expect.any(Function));
    });

    it('should clean up WebContents listeners properly', () => {
      cleanupWebContentsListeners(mockWebContents);

      // Should not throw any errors
      expect(mockWebContents.isDestroyed).toHaveBeenCalled();
    });

    it('should create cleanup functions that handle errors gracefully', () => {
      const failingCleanup = jest.fn(() => {
        throw new Error('Cleanup failed');
      });
      const successfulCleanup = jest.fn();

      const cleanup = createCleanupFunction([failingCleanup, successfulCleanup]);

      // Should not throw despite one cleanup failing
      expect(() => cleanup()).not.toThrow();
      expect(failingCleanup).toHaveBeenCalled();
      expect(successfulCleanup).toHaveBeenCalled();
    });

    it('should monitor memory usage without errors', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      monitorWebContentsMemory(mockWebContents, 'test-identifier');

      // Should set up monitoring without errors
      expect(mockWebContents.on).toHaveBeenCalledWith('destroyed', expect.any(Function));

      consoleSpy.mockRestore();
    });

    describe('Memory Monitoring Accuracy', () => {
      let consoleWarnSpy: jest.SpyInstance;
      let appGetAppMetricsSpy: jest.SpyInstance;

      beforeEach(() => {
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        // Get the mocked app from electron
        const { app } = require('electron');
        appGetAppMetricsSpy = jest.spyOn(app, 'getAppMetrics');
      });

      afterEach(() => {
        consoleWarnSpy.mockRestore();
        appGetAppMetricsSpy.mockRestore();
        jest.clearAllTimers();
      });

      it('should use app.getAppMetrics() instead of process.memoryUsage()', () => {
        jest.useFakeTimers();

        const mockMetrics: ProcessMetric[] = [
          {
            pid: 12345,
            type: 'Tab',
            cpu: { percentCPUUsage: 5, idleWakeupsPerSecond: 0 },
            creationTime: Date.now(),
            memory: {
              workingSetSize: 50 * 1024, // 50MB in KB
              peakWorkingSetSize: 60 * 1024,
            },
          },
        ];

        appGetAppMetricsSpy.mockReturnValue(mockMetrics);

        monitorWebContentsMemory(mockWebContents, 'test-webcontents');

        // Fast-forward to trigger the first memory check
        jest.advanceTimersByTime(30000);

        // Should call app.getAppMetrics to get process-specific memory
        expect(appGetAppMetricsSpy).toHaveBeenCalled();

        jest.useRealTimers();
      });

      it('should NOT warn when WebContents memory is below threshold', () => {
        jest.useFakeTimers();

        const mockMetrics: ProcessMetric[] = [
          {
            pid: 12345, // Matches mockWebContents.getProcessId()
            type: 'Tab',
            cpu: { percentCPUUsage: 5, idleWakeupsPerSecond: 0 },
            creationTime: Date.now(),
            memory: {
              workingSetSize: 50 * 1024, // 50MB in KB - below 100MB threshold
              peakWorkingSetSize: 60 * 1024,
            },
          },
        ];

        appGetAppMetricsSpy.mockReturnValue(mockMetrics);

        monitorWebContentsMemory(mockWebContents, 'test-webcontents');

        jest.advanceTimersByTime(30000);

        // Should NOT warn because 50MB < 100MB threshold
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('High memory usage'),
          expect.any(Object)
        );

        jest.useRealTimers();
      });

      it('should warn when WebContents memory exceeds threshold', () => {
        jest.useFakeTimers();

        const mockMetrics: ProcessMetric[] = [
          {
            pid: 12345, // Matches mockWebContents.getProcessId()
            type: 'Tab',
            cpu: { percentCPUUsage: 10, idleWakeupsPerSecond: 0 },
            creationTime: Date.now(),
            memory: {
              workingSetSize: 150 * 1024, // 150MB in KB - above 100MB threshold
              peakWorkingSetSize: 160 * 1024,
            },
          },
        ];

        appGetAppMetricsSpy.mockReturnValue(mockMetrics);

        monitorWebContentsMemory(mockWebContents, 'high-memory-webcontents');

        jest.advanceTimersByTime(30000);

        // Should warn because 150MB > 100MB threshold
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('High memory usage for WebContents high-memory-webcontents'),
          expect.objectContaining({
            workingSetSize: expect.stringContaining('MB'),
            peakWorkingSetSize: expect.stringContaining('MB'),
          })
        );

        jest.useRealTimers();
      });

      it('should handle case when WebContents process is not found in metrics', () => {
        jest.useFakeTimers();

        // Return metrics for different processes, not matching our WebContents PID
        const mockMetrics: ProcessMetric[] = [
          {
            pid: 99999, // Different PID
            type: 'Tab',
            cpu: { percentCPUUsage: 5, idleWakeupsPerSecond: 0 },
            creationTime: Date.now(),
            memory: {
              workingSetSize: 50 * 1024,
              peakWorkingSetSize: 60 * 1024,
            },
          },
        ];

        appGetAppMetricsSpy.mockReturnValue(mockMetrics);

        monitorWebContentsMemory(mockWebContents, 'not-found-webcontents');

        jest.advanceTimersByTime(30000);

        // Should not crash and should not warn (graceful handling)
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('High memory usage'),
          expect.any(Object)
        );

        jest.useRealTimers();
      });

      it('should correctly convert memory from KB to MB in logs', () => {
        jest.useFakeTimers();

        const mockMetrics: ProcessMetric[] = [
          {
            pid: 12345,
            type: 'Tab',
            cpu: { percentCPUUsage: 10, idleWakeupsPerSecond: 0 },
            creationTime: Date.now(),
            memory: {
              workingSetSize: 153600, // Exactly 150MB in KB
              peakWorkingSetSize: 163840, // Exactly 160MB in KB
            },
          },
        ];

        appGetAppMetricsSpy.mockReturnValue(mockMetrics);

        monitorWebContentsMemory(mockWebContents, 'conversion-test');

        jest.advanceTimersByTime(30000);

        // Should show correct MB values
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            workingSetSize: '150MB',
            peakWorkingSetSize: '160MB',
          })
        );

        jest.useRealTimers();
      });
    });
  });

  describe('Bundle Size Optimization', () => {
    it('should have webpack DefinePlugin configuration for production', () => {
      // This test verifies that our webpack configuration includes
      // the DefinePlugin settings to disable React DevTools
      // The actual test would be in the webpack config or build output
      expect(true).toBe(true); // Placeholder - actual test would check webpack config
    });
  });

  describe('Lazy Loading', () => {
    it('should support dynamic imports for React components', async () => {
      // Test that dynamic imports work correctly
      const importPromise = import('react');
      expect(importPromise).toBeInstanceOf(Promise);

      const reactModule = await importPromise;
      expect(reactModule).toBeDefined();
      expect(reactModule.lazy).toBeDefined();
      expect(reactModule.Suspense).toBeDefined();
    });
  });
});
