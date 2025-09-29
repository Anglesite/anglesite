/**
 * @file ErrorReportingService Light Performance Tests
 * @description Lightweight performance tests for regular CI/CD execution
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
        return process.env.TEST_USER_DATA || '/tmp/anglesite-light-performance-test';
      }
      return `/mock/${path}`;
    }),
    getVersion: jest.fn(() => '1.0.0-light-performance-test'),
  },
}));

describe('ErrorReportingService Light Performance Tests', () => {
  let service: ErrorReportingService;
  let mockStore: jest.Mocked<IStore>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'error-reporting-light-perf-'));
    process.env.TEST_USER_DATA = tempDir;
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up light performance test directory:', error);
    }
    delete process.env.TEST_USER_DATA;
  });

  beforeEach(async () => {
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

    service = new ErrorReportingService(mockStore);
    await service.initialize();
  });

  afterEach(async () => {
    if (service) {
      await service.dispose();
    }
  });

  describe('Basic Performance Metrics', () => {
    it('should handle moderate error volume efficiently', async () => {
      const errorCount = 1000;
      const startTime = process.hrtime.bigint();
      const startMemory = process.memoryUsage();

      // Report errors in a reasonable batch
      const promises = [];
      for (let i = 0; i < errorCount; i++) {
        promises.push(
          service.report(new Error(`Light perf test error ${i}`), {
            testIndex: i,
            timestamp: Date.now(),
          })
        );
      }

      await Promise.all(promises);

      const endTime = process.hrtime.bigint();
      const endMemory = process.memoryUsage();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      const memoryIncrease = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

      console.log(`Light Performance Test Results:`);
      console.log(`- Processed ${errorCount} errors in ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / errorCount).toFixed(4)}ms per error`);
      console.log(`- Memory increase: ${memoryIncrease.toFixed(2)}MB`);

      // Performance assertions for moderate load
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      expect(duration / errorCount).toBeLessThan(15); // Less than 15ms per error average
      expect(memoryIncrease).toBeLessThan(50); // Memory increase should be reasonable
    }, 20000);

    it('should maintain consistent performance across multiple batches', async () => {
      const batchSize = 200;
      const numBatches = 5;
      const batchTimes = [];

      for (let batch = 0; batch < numBatches; batch++) {
        const batchStartTime = process.hrtime.bigint();

        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          promises.push(
            service.report(new Error(`Batch ${batch} error ${i}`), {
              batchId: batch,
              errorIndex: i,
            })
          );
        }

        await Promise.all(promises);

        const batchEndTime = process.hrtime.bigint();
        const batchDuration = Number(batchEndTime - batchStartTime) / 1000000;
        batchTimes.push(batchDuration);

        console.log(`Batch ${batch + 1}: ${batchDuration.toFixed(2)}ms for ${batchSize} errors`);
      }

      // Analyze consistency
      const avgTime = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length;
      const maxTime = Math.max(...batchTimes);
      const minTime = Math.min(...batchTimes);
      const variance = maxTime - minTime;

      console.log(`Batch Performance Consistency:`);
      console.log(`- Average: ${avgTime.toFixed(2)}ms`);
      console.log(`- Min: ${minTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms`);
      console.log(`- Variance: ${variance.toFixed(2)}ms`);

      // Performance should be consistent (variance should be reasonable)
      expect(avgTime).toBeLessThan(3000); // Average batch should complete quickly
      expect(variance / avgTime).toBeLessThan(2); // Variance shouldn't exceed 200% of average
    }, 25000);

    it('should handle rate limiting efficiently', async () => {
      const errorMessage = 'Rate limit test error';
      const attemptedErrors = 150; // More than the 100/minute limit
      const startTime = process.hrtime.bigint();

      const promises = [];
      for (let i = 0; i < attemptedErrors; i++) {
        promises.push(
          service.report(new Error(errorMessage), {
            attemptIndex: i,
          })
        );
      }

      await Promise.all(promises);

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;

      console.log(`Rate Limiting Performance:`);
      console.log(`- Attempted ${attemptedErrors} identical errors`);
      console.log(`- Processing time: ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / attemptedErrors).toFixed(4)}ms per attempt`);

      // Even with rate limiting, should remain performant
      expect(duration).toBeLessThan(5000); // Should complete quickly even with rate limiting
      expect(duration / attemptedErrors).toBeLessThan(50); // Less than 50ms per attempt

      // Verify rate limiting worked
      const recentErrors = await service.getRecentErrors(200);
      expect(recentErrors.length).toBeLessThanOrEqual(100); // Should be rate limited
    }, 15000);
  });

  describe('Service Responsiveness', () => {
    it('should initialize and dispose quickly', async () => {
      const cycles = 10;
      const initTimes = [];
      const disposeTimes = [];

      for (let i = 0; i < cycles; i++) {
        // Test initialization
        const initStartTime = process.hrtime.bigint();
        const testService = new ErrorReportingService(mockStore);
        await testService.initialize();
        const initEndTime = process.hrtime.bigint();
        const initDuration = Number(initEndTime - initStartTime) / 1000000;
        initTimes.push(initDuration);

        // Report a quick error to ensure service works
        await testService.report(new Error(`Init cycle ${i} test`));

        // Test disposal
        const disposeStartTime = process.hrtime.bigint();
        await testService.dispose();
        const disposeEndTime = process.hrtime.bigint();
        const disposeDuration = Number(disposeEndTime - disposeStartTime) / 1000000;
        disposeTimes.push(disposeDuration);
      }

      const avgInitTime = initTimes.reduce((sum, time) => sum + time, 0) / initTimes.length;
      const avgDisposeTime = disposeTimes.reduce((sum, time) => sum + time, 0) / disposeTimes.length;

      console.log(`Service Lifecycle Performance:`);
      console.log(`- Average initialization: ${avgInitTime.toFixed(2)}ms`);
      console.log(`- Average disposal: ${avgDisposeTime.toFixed(2)}ms`);
      console.log(`- Total lifecycle: ${(avgInitTime + avgDisposeTime).toFixed(2)}ms`);

      // Service lifecycle should be fast
      expect(avgInitTime).toBeLessThan(1000); // Less than 1 second to initialize
      expect(avgDisposeTime).toBeLessThan(2000); // Less than 2 seconds to dispose
    }, 20000);

    it('should respond to queries quickly under load', async () => {
      // Generate some background load
      const backgroundPromises = [];
      for (let i = 0; i < 500; i++) {
        backgroundPromises.push(service.report(new Error(`Background load ${i}`), { backgroundIndex: i }));
      }

      // While background load is processing, test query responsiveness
      const queryTypes = [() => service.getRecentErrors(50), () => service.getStatistics(), () => service.isEnabled()];

      const queryTimes = [];
      for (const queryFn of queryTypes) {
        const queryStartTime = process.hrtime.bigint();
        await queryFn();
        const queryEndTime = process.hrtime.bigint();
        const queryDuration = Number(queryEndTime - queryStartTime) / 1000000;
        queryTimes.push(queryDuration);
      }

      // Wait for background load to complete
      await Promise.all(backgroundPromises);

      const avgQueryTime = queryTimes.reduce((sum, time) => sum + time, 0) / queryTimes.length;
      const maxQueryTime = Math.max(...queryTimes);

      console.log(`Query Responsiveness Under Load:`);
      console.log(`- Average query time: ${avgQueryTime.toFixed(2)}ms`);
      console.log(`- Maximum query time: ${maxQueryTime.toFixed(2)}ms`);

      // Queries should remain responsive even under load
      expect(avgQueryTime).toBeLessThan(100); // Less than 100ms average
      expect(maxQueryTime).toBeLessThan(500); // Less than 500ms maximum
    }, 15000);
  });

  describe('Memory Efficiency', () => {
    it('should not accumulate excessive memory during normal operation', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Simulate normal error reporting over time
      for (let cycle = 0; cycle < 3; cycle++) {
        const promises = [];
        for (let i = 0; i < 300; i++) {
          promises.push(
            service.report(new Error(`Memory cycle ${cycle} error ${i}`), {
              cycle,
              errorIndex: i,
            })
          );
        }
        await Promise.all(promises);

        // Force flush to prevent excessive buffering
        await service.dispose();
        service = new ErrorReportingService(mockStore);
        await service.initialize();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowthMB = (finalMemory - initialMemory) / 1024 / 1024;

      console.log(`Memory Growth During Normal Operation:`);
      console.log(`- Initial memory: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Final memory: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Growth: ${memoryGrowthMB.toFixed(2)}MB`);

      // Memory growth should be modest during normal operation
      expect(memoryGrowthMB).toBeLessThan(25); // Less than 25MB growth
    }, 20000);
  });

  describe('Edge Case Performance', () => {
    it('should handle various error types efficiently', async () => {
      const errorFactories = [
        () => new Error('Standard error'),
        () => new AngleError('System error', 'SYS_ERR', ErrorCategory.SYSTEM, ErrorSeverity.HIGH),
        () => 'String error',
        () => ({ message: 'Object error' }),
        () => null,
        () => undefined,
      ];

      const errorsPerType = 100;
      const startTime = process.hrtime.bigint();

      const promises = [];
      errorFactories.forEach((factory, typeIndex) => {
        for (let i = 0; i < errorsPerType; i++) {
          promises.push(
            service.report(factory(), {
              errorTypeIndex: typeIndex,
              errorIndex: i,
            })
          );
        }
      });

      await Promise.all(promises);

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;
      const totalErrors = errorFactories.length * errorsPerType;

      console.log(`Mixed Error Types Performance:`);
      console.log(`- ${totalErrors} errors of ${errorFactories.length} types`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Average: ${(duration / totalErrors).toFixed(4)}ms per error`);

      // Should handle diverse error types efficiently
      expect(duration).toBeLessThan(5000); // Within 5 seconds
      expect(duration / totalErrors).toBeLessThan(10); // Less than 10ms per error

      // Verify all types were processed
      const stats = await service.getStatistics();
      expect(stats.total).toBeGreaterThan(0);
    }, 15000);
  });
});
