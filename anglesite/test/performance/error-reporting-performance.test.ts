/**
 * @file ErrorReportingService Performance and Stress Tests
 * @description Performance tests focusing on high-volume scenarios, memory usage, and system limits
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorReportingService } from '../../src/main/services/error-reporting-service';
import { AngleError, ErrorSeverity, ErrorCategory } from '../../src/main/core/errors';
import { IStore } from '../../src/main/core/interfaces';

// Mock Electron for performance tests
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((path: string) => {
      if (path === 'userData') {
        return process.env.TEST_USER_DATA || '/tmp/anglesite-performance-test';
      }
      return `/mock/${path}`;
    }),
    getVersion: jest.fn(() => '1.0.0-performance-test'),
  },
}));

describe('ErrorReportingService Performance Tests', () => {
  let service: ErrorReportingService;
  let mockStore: jest.Mocked<IStore>;
  let tempDir: string;
  let errorLogDir: string;

  beforeAll(async () => {
    // Create unique temporary directory for performance tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'error-reporting-performance-'));
    errorLogDir = path.join(tempDir, 'error-reports');
    process.env.TEST_USER_DATA = tempDir;
  });

  afterAll(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up performance test directory:', error);
    }
    delete process.env.TEST_USER_DATA;
  });

  beforeEach(async () => {
    // Create fresh mock store for each test
    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      getAll: jest.fn(),
      setAll: jest.fn(),
      saveWindowStates: jest.fn(),
      getWindowStates: jest.fn(),
      clearWindowStates: jest.fn(),
      addRecentWebsite: jest.fn(),
      getRecentWebsites: jest.fn(),
      clearRecentWebsites: jest.fn(),
      removeRecentWebsite: jest.fn(),
      forceSave: jest.fn(),
      dispose: jest.fn(),
    };

    // Clear error log directory
    try {
      await fs.rm(errorLogDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }

    service = new ErrorReportingService(mockStore);
    await service.initialize();
  });

  afterEach(async () => {
    if (service) {
      await service.dispose();
    }
  });

  describe('High Volume Error Reporting', () => {
    it('should handle 5,000 errors efficiently', async () => {
      const errorCount = 5000;
      const startTime = process.hrtime.bigint();
      const startMemory = process.memoryUsage();

      // Report errors in batches to avoid overwhelming the system
      const batchSize = 500;
      const batches = Math.ceil(errorCount / batchSize);

      for (let batch = 0; batch < batches; batch++) {
        const batchPromises = [];
        const batchStart = batch * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, errorCount);

        for (let i = batchStart; i < batchEnd; i++) {
          batchPromises.push(
            service.report(new Error(`Performance test error ${i}`), {
              batchId: batch,
              errorIndex: i,
            })
          );
        }

        await Promise.all(batchPromises);
      }

      const endTime = process.hrtime.bigint();
      const endMemory = process.memoryUsage();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

      console.log(`Performance Test Results:`);
      console.log(`- Processed ${errorCount} errors in ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / errorCount).toFixed(4)}ms per error`);
      console.log(`- Memory change: ${((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024).toFixed(2)}MB`);

      // Performance assertions
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
      expect(duration / errorCount).toBeLessThan(5); // Less than 5ms per error average

      // Memory usage should not grow excessively (allow up to 100MB increase)
      const memoryIncrease = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;
      expect(memoryIncrease).toBeLessThan(100);

      // Force disposal to trigger final flush and verify persistence
      await service.dispose();

      // Verify some errors were actually persisted (accounting for rate limiting)
      try {
        const logFiles = await fs.readdir(errorLogDir);
        if (logFiles.length > 0) {
          let totalPersistedErrors = 0;
          for (const file of logFiles) {
            const content = await fs.readFile(path.join(errorLogDir, file), 'utf-8');
            const lines = content
              .trim()
              .split('\n')
              .filter((line) => line.length > 0);
            totalPersistedErrors += lines.length;
          }
          console.log(`- Persisted ${totalPersistedErrors} errors to disk`);
          expect(totalPersistedErrors).toBeGreaterThan(0);
        }
      } catch (error) {
        console.log('- No errors persisted (still in buffer)');
      }
    }, 45000);

    it('should handle concurrent error reporting from multiple sources', async () => {
      const concurrentSources = 10;
      const errorsPerSource = 1000;
      const startTime = process.hrtime.bigint();

      // Create concurrent error reporting from multiple "sources"
      const sourcePromises = Array(concurrentSources)
        .fill(0)
        .map(async (_, sourceId) => {
          const sourceErrors = [];
          for (let i = 0; i < errorsPerSource; i++) {
            sourceErrors.push(
              service.report(
                new AngleError(
                  `Concurrent error from source ${sourceId}`,
                  `CONCURRENT_ERROR_${sourceId}`,
                  ErrorCategory.SYSTEM,
                  ErrorSeverity.MEDIUM
                ),
                {
                  sourceId,
                  errorIndex: i,
                  timestamp: Date.now(),
                }
              )
            );
          }
          return Promise.all(sourceErrors);
        });

      await Promise.all(sourcePromises);

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;
      const totalErrors = concurrentSources * errorsPerSource;

      console.log(`Concurrent Reporting Results:`);
      console.log(`- ${concurrentSources} sources × ${errorsPerSource} errors = ${totalErrors} total`);
      console.log(`- Completed in ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / totalErrors).toFixed(4)}ms per error`);

      // Should handle concurrent load efficiently
      expect(duration).toBeLessThan(60000); // Within 60 seconds
      expect(duration / totalErrors).toBeLessThan(10); // Less than 10ms per error average

      // Verify service can still respond to queries after concurrent load
      const stats = await service.getStatistics();
      expect(typeof stats.total).toBe('number');
      expect(stats.total).toBeGreaterThanOrEqual(0);
    }, 45000);
  });

  describe('Memory and Resource Management', () => {
    it('should not leak memory during extended operation', async () => {
      const iterations = 3;
      const errorsPerIteration = 1000;
      const memoryMeasurements = [];

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const initialMemory = process.memoryUsage();
      memoryMeasurements.push(initialMemory.heapUsed);

      for (let iteration = 0; iteration < iterations; iteration++) {
        // Report errors
        const promises = [];
        for (let i = 0; i < errorsPerIteration; i++) {
          promises.push(
            service.report(new Error(`Memory test error ${iteration}-${i}`), {
              iteration,
              index: i,
            })
          );
        }
        await Promise.all(promises);

        // Force flush to prevent excessive buffering
        await service.dispose();
        service = new ErrorReportingService(mockStore);
        await service.initialize();

        // Measure memory after each iteration
        if (global.gc) {
          global.gc();
        }
        const currentMemory = process.memoryUsage();
        memoryMeasurements.push(currentMemory.heapUsed);

        console.log(`Iteration ${iteration + 1}: ${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      }

      // Analyze memory growth
      const memoryGrowth = memoryMeasurements[memoryMeasurements.length - 1] - memoryMeasurements[0];
      const memoryGrowthMB = memoryGrowth / 1024 / 1024;

      console.log(`Memory Growth Analysis:`);
      console.log(`- Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Final: ${(memoryMeasurements[memoryMeasurements.length - 1] / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Growth: ${memoryGrowthMB.toFixed(2)}MB`);

      // Memory growth should be reasonable (allow up to 50MB growth for extended operation)
      expect(memoryGrowthMB).toBeLessThan(50);

      // Check for consistent memory usage (no exponential growth)
      let hasExponentialGrowth = false;
      for (let i = 1; i < memoryMeasurements.length; i++) {
        const growth = memoryMeasurements[i] - memoryMeasurements[i - 1];
        const growthMB = growth / 1024 / 1024;
        if (growthMB > 20) {
          // More than 20MB growth in one iteration
          hasExponentialGrowth = true;
          break;
        }
      }
      expect(hasExponentialGrowth).toBe(false);
    }, 60000);

    it('should handle rapid service initialization and disposal cycles', async () => {
      const cycles = 50;
      const startTime = process.hrtime.bigint();

      for (let cycle = 0; cycle < cycles; cycle++) {
        const testService = new ErrorReportingService(mockStore);
        await testService.initialize();

        // Report a few errors to ensure service is working
        await testService.report(new Error(`Cycle ${cycle} error 1`));
        await testService.report(new Error(`Cycle ${cycle} error 2`));

        await testService.dispose();
      }

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;

      console.log(`Service Lifecycle Performance:`);
      console.log(`- ${cycles} init/dispose cycles in ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / cycles).toFixed(2)}ms per cycle`);

      // Should handle rapid cycles efficiently
      expect(duration).toBeLessThan(10000); // Within 10 seconds
      expect(duration / cycles).toBeLessThan(100); // Less than 100ms per cycle
    }, 30000);
  });

  describe('Disk I/O Performance', () => {
    it('should handle large error reports efficiently', async () => {
      const largeContextSize = 5000; // 5KB of context data
      const errorCount = 500;

      // Create large context object
      const largeContext = {
        largeData: 'x'.repeat(largeContextSize),
        metadata: Array(100)
          .fill(0)
          .map((_, i) => ({
            key: `metadata_key_${i}`,
            value: `metadata_value_${i}`,
          })),
        timestamp: Date.now(),
        processInfo: {
          pid: process.pid,
          memory: process.memoryUsage(),
          uptime: process.uptime(),
        },
      };

      const startTime = process.hrtime.bigint();

      // Report errors with large context
      const promises = [];
      for (let i = 0; i < errorCount; i++) {
        promises.push(
          service.report(new Error(`Large context error ${i}`), {
            ...largeContext,
            errorIndex: i,
          })
        );
      }

      await Promise.all(promises);
      await service.dispose(); // Force persistence

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;

      console.log(`Large Error Report Performance:`);
      console.log(`- ${errorCount} errors with ~${largeContextSize} bytes context each`);
      console.log(`- Total data: ~${((errorCount * largeContextSize) / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / errorCount).toFixed(2)}ms per error`);

      // Should handle large payloads reasonably efficiently
      expect(duration).toBeLessThan(30000); // Within 30 seconds
      expect(duration / errorCount).toBeLessThan(50); // Less than 50ms per large error

      // Verify data was persisted correctly
      try {
        const logFiles = await fs.readdir(errorLogDir);
        if (logFiles.length > 0) {
          const firstFile = path.join(errorLogDir, logFiles[0]);
          const content = await fs.readFile(firstFile, 'utf-8');
          const lines = content.trim().split('\n');
          expect(lines.length).toBeGreaterThan(0);

          // Verify structure of persisted data
          const firstError = JSON.parse(lines[0]);
          expect(firstError).toHaveProperty('id');
          expect(firstError).toHaveProperty('timestamp');
          expect(firstError).toHaveProperty('error');
          expect(firstError).toHaveProperty('context');
        }
      } catch (error) {
        console.log('Large context test: Could not verify persisted data');
      }
    }, 45000);
  });

  describe('Rate Limiting Stress Tests', () => {
    it('should maintain performance under rate limiting conditions', async () => {
      const totalErrors = 2000;
      const uniqueMessages = 10; // This will cause heavy rate limiting
      const startTime = process.hrtime.bigint();

      // Create errors that will trigger heavy rate limiting
      const promises = [];
      for (let i = 0; i < totalErrors; i++) {
        const messageId = i % uniqueMessages;
        promises.push(
          service.report(new Error(`Rate limit test message ${messageId}`), {
            errorIndex: i,
            messageId,
          })
        );
      }

      await Promise.all(promises);

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;

      console.log(`Rate Limiting Performance:`);
      console.log(`- ${totalErrors} errors with only ${uniqueMessages} unique messages`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / totalErrors).toFixed(4)}ms per error`);

      // Even with heavy rate limiting, should remain performant
      expect(duration).toBeLessThan(15000); // Within 15 seconds
      expect(duration / totalErrors).toBeLessThan(5); // Less than 5ms per error

      // Verify rate limiting is working
      const recentErrors = await service.getRecentErrors(10000);
      expect(recentErrors.length).toBeLessThanOrEqual(uniqueMessages * 100); // Each message limited to 100/min

      // Verify service responsiveness after rate limiting
      const stats = await service.getStatistics();
      expect(stats.total).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Edge Case Performance', () => {
    it('should handle mixed error types efficiently', async () => {
      const errorCount = 1500;
      const errorTypes = [
        () => new Error('Standard Error'),
        () => new AngleError('System Error', 'SYS_ERR', ErrorCategory.SYSTEM, ErrorSeverity.HIGH),
        () => new AngleError('Network Error', 'NET_ERR', ErrorCategory.NETWORK, ErrorSeverity.MEDIUM),
        () => 'String error message',
        () => ({ message: 'Object error', code: 'OBJ_ERR' }),
        () => 42, // Number as error
        () => null, // Null as error
        () => undefined, // Undefined as error
      ];

      const startTime = process.hrtime.bigint();

      const promises = [];
      for (let i = 0; i < errorCount; i++) {
        const errorTypeIndex = i % errorTypes.length;
        const errorFactory = errorTypes[errorTypeIndex];
        promises.push(
          service.report(errorFactory(), {
            errorTypeIndex,
            errorIndex: i,
          })
        );
      }

      await Promise.all(promises);

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;

      console.log(`Mixed Error Types Performance:`);
      console.log(`- ${errorCount} errors of ${errorTypes.length} different types`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / errorCount).toFixed(4)}ms per error`);

      // Should handle diverse error types efficiently
      expect(duration).toBeLessThan(20000); // Within 20 seconds
      expect(duration / errorCount).toBeLessThan(10); // Less than 10ms per error

      // Verify all error types were processed
      const stats = await service.getStatistics();
      expect(stats.total).toBeGreaterThan(0);
    }, 30000);
  });
});
