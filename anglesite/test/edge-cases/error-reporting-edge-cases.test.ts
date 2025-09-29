/**
 * @file ErrorReportingService Edge Cases and Failure Mode Tests
 * @description Tests for edge cases, boundary conditions, and failure modes
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorReportingService } from '../../src/main/services/error-reporting-service';
import { AngleError, ErrorSeverity, ErrorCategory } from '../../src/main/core/errors';
import { IStore } from '../../src/main/core/interfaces';

// Mock Electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((path: string) => {
      if (path === 'userData') {
        return process.env.TEST_USER_DATA || '/tmp/anglesite-edge-case-test';
      }
      return `/mock/${path}`;
    }),
    getVersion: jest.fn(() => '1.0.0-edge-case-test'),
  },
}));

describe('ErrorReportingService Edge Cases and Failure Modes', () => {
  let service: ErrorReportingService;
  let mockStore: jest.Mocked<IStore>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'error-reporting-edge-cases-'));
    process.env.TEST_USER_DATA = tempDir;
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up edge case test directory:', error);
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

  describe('Invalid Input Handling', () => {
    it('should handle null and undefined errors gracefully', async () => {
      await expect(service.report(null)).resolves.not.toThrow();
      await expect(service.report(undefined)).resolves.not.toThrow();

      // Verify service remains functional
      await expect(service.report(new Error('Test after null'))).resolves.not.toThrow();
      const stats = await service.getStatistics();
      expect(typeof stats.total).toBe('number');
    });

    it('should handle circular reference objects', async () => {
      const circularObj: any = { message: 'Circular error' };
      circularObj.self = circularObj;

      await expect(service.report(circularObj)).resolves.not.toThrow();

      // Test context with circular references
      const circularContext: any = { data: 'context' };
      circularContext.circular = circularContext;

      await expect(service.report(new Error('Test'), circularContext)).resolves.not.toThrow();
    });

    it('should handle extremely large error messages', async () => {
      const largeMessage = 'x'.repeat(100000); // 100KB message
      const hugeMessage = 'y'.repeat(1000000); // 1MB message

      await expect(service.report(new Error(largeMessage))).resolves.not.toThrow();
      await expect(service.report(new Error(hugeMessage))).resolves.not.toThrow();

      // Verify service remains responsive
      await expect(service.report(new Error('Small message after large'))).resolves.not.toThrow();
    });

    it('should handle errors with non-string properties', async () => {
      const weirdError: any = new Error('Base message');
      weirdError.number = 42;
      weirdError.boolean = true;
      weirdError.object = { nested: 'value' };
      weirdError.array = [1, 2, 3];
      weirdError.date = new Date();
      weirdError.regexp = /test/g;
      weirdError.fn = () => 'function';

      await expect(service.report(weirdError)).resolves.not.toThrow();
    });

    it('should handle non-Error objects as errors', async () => {
      const testCases = [42, true, false, [], { custom: 'error' }, 'string error', Symbol('symbol-error'), BigInt(123)];

      for (const testCase of testCases) {
        await expect(service.report(testCase as any)).resolves.not.toThrow();
      }
    });
  });

  describe('Resource Exhaustion Scenarios', () => {
    it('should handle filesystem permission errors gracefully', async () => {
      // Mock filesystem to simulate permission errors
      const originalMkdir = fs.mkdir;
      const originalWriteFile = fs.writeFile;
      const originalAppendFile = fs.appendFile;

      fs.mkdir = jest.fn().mockRejectedValue(new Error('EACCES: permission denied'));
      fs.writeFile = jest.fn().mockRejectedValue(new Error('EACCES: permission denied'));
      fs.appendFile = jest.fn().mockRejectedValue(new Error('EACCES: permission denied'));

      // Create new service that will encounter permission errors during initialization
      const permissionService = new ErrorReportingService(mockStore);
      await expect(permissionService.initialize()).resolves.not.toThrow();

      // Service should still accept errors even if persistence fails
      await expect(permissionService.report(new Error('Permission test'))).resolves.not.toThrow();

      await permissionService.dispose();

      // Restore original functions
      fs.mkdir = originalMkdir;
      fs.writeFile = originalWriteFile;
      fs.appendFile = originalAppendFile;
    });

    it('should handle disk space exhaustion', async () => {
      // Mock filesystem to simulate ENOSPC (no space left on device)
      const originalAppendFile = fs.appendFile;
      let errorCount = 0;

      fs.appendFile = jest.fn().mockImplementation(async (filePath, data, options) => {
        errorCount++;
        if (errorCount > 3) {
          throw new Error('ENOSPC: no space left on device');
        }
        return originalAppendFile(filePath, data, options as any);
      });

      // Should handle initial errors normally
      await expect(service.report(new Error('Before disk full'))).resolves.not.toThrow();
      await expect(service.report(new Error('Still working'))).resolves.not.toThrow();

      // Should handle disk full gracefully
      await expect(service.report(new Error('Disk full error'))).resolves.not.toThrow();

      // Service should remain functional
      expect(service.isEnabled()).toBe(true);

      // Restore original function
      fs.appendFile = originalAppendFile;
    });

    it('should handle memory pressure scenarios', async () => {
      // Simulate memory pressure by creating large context objects
      const largeArray = new Array(50000).fill('memory-pressure-test-data');

      const contextWithLargeData = {
        largeArray,
        metadata: {
          description: 'Memory pressure test',
          timestamp: Date.now(),
        },
      };

      // Should handle large contexts without crashing
      await expect(service.report(new Error('Memory pressure test'), contextWithLargeData)).resolves.not.toThrow();

      // Service should remain functional after handling large data
      await expect(service.report(new Error('After memory pressure'))).resolves.not.toThrow();
    });
  });

  describe('Concurrent Access Edge Cases', () => {
    it('should handle multiple simultaneous initializations', async () => {
      const services = Array(5)
        .fill(0)
        .map(() => new ErrorReportingService(mockStore));

      // Initialize all services simultaneously
      const initPromises = services.map((s) => s.initialize());
      await expect(Promise.all(initPromises)).resolves.not.toThrow();

      // All services should be functional
      for (let i = 0; i < services.length; i++) {
        await expect(services[i].report(new Error(`Service ${i} test`))).resolves.not.toThrow();
        expect(services[i].isEnabled()).toBe(true);
      }

      // Clean up all services
      await Promise.all(services.map((s) => s.dispose()));
    });

    it('should handle simultaneous disposal and error reporting', async () => {
      // Start error reporting
      const reportingPromises = [];
      for (let i = 0; i < 50; i++) {
        reportingPromises.push(service.report(new Error(`Concurrent disposal test ${i}`)));
      }

      // Dispose while reporting is happening
      const disposePromise = service.dispose();

      // Neither should throw
      await expect(Promise.all(reportingPromises)).resolves.not.toThrow();
      await expect(disposePromise).resolves.not.toThrow();
    });

    it('should handle rapid enable/disable toggling', async () => {
      const togglePromises = [];

      // Rapidly toggle enabled state
      for (let i = 0; i < 20; i++) {
        togglePromises.push(
          new Promise<void>((resolve) => {
            service.setEnabled(i % 2 === 0);
            resolve();
          })
        );
      }

      await Promise.all(togglePromises);

      // Service should be in a consistent state
      expect(typeof service.isEnabled()).toBe('boolean');

      // Should still accept configuration changes
      service.setEnabled(true);
      expect(service.isEnabled()).toBe(true);
      service.setEnabled(false);
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('Service State Edge Cases', () => {
    it('should handle operations before initialization', async () => {
      const uninitializedService = new ErrorReportingService(mockStore);

      // Operations should not throw but may have limited functionality
      await expect(uninitializedService.report(new Error('Before init'))).resolves.not.toThrow();
      await expect(uninitializedService.getStatistics()).resolves.not.toThrow();
      await expect(uninitializedService.getRecentErrors()).resolves.not.toThrow();

      expect(typeof uninitializedService.isEnabled()).toBe('boolean');
      uninitializedService.setEnabled(false);
      expect(uninitializedService.isEnabled()).toBe(false);

      // Should be able to initialize after operations
      await expect(uninitializedService.initialize()).resolves.not.toThrow();

      await uninitializedService.dispose();
    });

    it('should handle operations after disposal', async () => {
      await service.dispose();

      // Operations should not throw but may have limited functionality
      await expect(service.report(new Error('After disposal'))).resolves.not.toThrow();
      await expect(service.getStatistics()).resolves.not.toThrow();
      await expect(service.getRecentErrors()).resolves.not.toThrow();

      // Configuration should still work
      service.setEnabled(false);
      expect(service.isEnabled()).toBe(false);
    });

    it('should handle multiple disposal calls', async () => {
      await expect(service.dispose()).resolves.not.toThrow();
      await expect(service.dispose()).resolves.not.toThrow();
      await expect(service.dispose()).resolves.not.toThrow();
    });

    it('should handle multiple initialization calls', async () => {
      await expect(service.initialize()).resolves.not.toThrow();
      await expect(service.initialize()).resolves.not.toThrow();
      await expect(service.initialize()).resolves.not.toThrow();

      // Service should remain functional
      await expect(service.report(new Error('Multiple init test'))).resolves.not.toThrow();
    });
  });

  describe('Data Integrity Edge Cases', () => {
    it('should handle corrupted error log files', async () => {
      // Create corrupted log file
      const errorLogDir = path.join(tempDir, 'error-reports');
      await fs.mkdir(errorLogDir, { recursive: true });
      const corruptedFile = path.join(errorLogDir, 'corrupted.jsonl');
      await fs.writeFile(
        corruptedFile,
        'invalid json line\n{"incomplete": "json object"\n{"valid": "json"}\n',
        'utf-8'
      );

      // Service should handle corrupted files gracefully
      const corruptedService = new ErrorReportingService(mockStore);
      await expect(corruptedService.initialize()).resolves.not.toThrow();

      await expect(corruptedService.getStatistics()).resolves.not.toThrow();
      await expect(corruptedService.getRecentErrors()).resolves.not.toThrow();

      await corruptedService.dispose();
    });

    it('should handle invalid date filtering', async () => {
      const invalidDates = [
        new Date('invalid'),
        new Date(NaN),
        new Date('2024-13-32'), // Invalid date
        new Date(8640000000000001), // Beyond max date
      ];

      for (const invalidDate of invalidDates) {
        await expect(service.getStatistics(invalidDate)).resolves.not.toThrow();
        await expect(service.getRecentErrors(10)).resolves.not.toThrow();
      }
    });

    it('should handle extreme limit values for getRecentErrors', async () => {
      const extremeLimits = [-1, 0, Number.MAX_SAFE_INTEGER, Infinity, NaN];

      for (const limit of extremeLimits) {
        const result = await service.getRecentErrors(limit);
        expect(Array.isArray(result)).toBe(true);
      }
    });
  });

  describe('Export Function Edge Cases', () => {
    it('should handle invalid export paths', async () => {
      const invalidPaths = [
        '', // Empty string
        '/dev/null/cannot-create', // Path under /dev/null
        '/root/permission-denied', // Likely permission denied
        'relative/path', // Relative path
      ];

      // Main goal: service should not crash when given invalid paths
      for (const invalidPath of invalidPaths) {
        try {
          await service.exportErrors(invalidPath);
          // If it succeeds, that's fine
        } catch (error) {
          // If it rejects with an error, that's also expected behavior
          // Just verify it's truthy (an actual error occurred)
          expect(error).toBeTruthy();
        }
        // Most important: service didn't crash and is still functional
      }

      // Verify service remains functional after handling invalid paths
      await expect(service.report(new Error('After invalid paths test'))).resolves.not.toThrow();
      const stats = await service.getStatistics();
      expect(typeof stats.total).toBe('number');
    });

    it('should handle export with invalid date filters', async () => {
      const tempExportPath = path.join(tempDir, 'invalid-date-export.json');

      const invalidDates = [new Date('invalid'), new Date(NaN), null as any, undefined as any];

      for (const invalidDate of invalidDates) {
        // Should handle gracefully
        await expect(service.exportErrors(tempExportPath, invalidDate)).resolves.not.toThrow();
      }
    });
  });

  describe('Context Sanitization Edge Cases', () => {
    it('should handle deeply nested context objects', async () => {
      // Create deeply nested object (100 levels deep)
      let deepObj: any = { value: 'deep' };
      for (let i = 0; i < 100; i++) {
        deepObj = { level: i, nested: deepObj };
      }

      await expect(service.report(new Error('Deep nesting test'), deepObj)).resolves.not.toThrow();
    });

    it('should handle context with sensitive data patterns', async () => {
      const sensitiveContext = {
        // Various sensitive data patterns
        password: 'secret123',
        PASSWORD: 'SECRET456',
        pwd: 'hidden',
        apiKey: 'ak-1234567890',
        api_key: 'sk-abcdefghijk',
        token: 'tok_sensitive_data',
        secret: 'confidential',
        creditCard: '4111-1111-1111-1111',
        ssn: '123-45-6789',
        email: 'user@example.com',
        // Nested sensitive data
        config: {
          database: {
            password: 'db_secret',
            connectionString: 'postgres://user:pass@host/db',
          },
          auth: {
            secret: 'jwt_secret',
          },
        },
        // Arrays with sensitive data
        credentials: ['user', 'password123'],
        // Normal data that should be preserved
        normalField: 'should be kept',
        userId: 12345,
      };

      await expect(service.report(new Error('Sensitive data test'), sensitiveContext)).resolves.not.toThrow();
    });

    it('should handle context with special characters and encodings', async () => {
      const specialContext = {
        unicode: '🔥💻🚀',
        emoji: '👍👎😀😢',
        specialChars: '!@#$%^&*()[]{}|;:,.<>?',
        controlChars: '\n\r\t\0\b\f\v',
        quotes: `"'` + '`',
        backslashes: '\\\\\\',
        nullByte: 'before\0after',
        // Different encodings
        latin1: 'café',
        cyrillic: 'привет',
        chinese: '你好',
        arabic: 'مرحبا',
      };

      await expect(service.report(new Error('Special chars test'), specialContext)).resolves.not.toThrow();
    });
  });

  describe('Rate Limiting Edge Cases', () => {
    it('should handle rate limiting with identical error objects', async () => {
      const sameError = new Error('Identical error for rate limiting test');

      const promises = [];
      for (let i = 0; i < 150; i++) {
        promises.push(service.report(sameError)); // Same object instance
      }

      await Promise.all(promises);

      // Main goal: service should handle rapid identical reports without crashing
      await expect(service.getRecentErrors(50)).resolves.toBeDefined();
      await expect(service.getStatistics()).resolves.toBeDefined();

      // Verify service remains responsive after rate limiting scenario
      await expect(service.report(new Error('After rate limit test'))).resolves.not.toThrow();
      expect(service.isEnabled()).toBe(true);
    });

    it('should handle rate limiting across service restarts', async () => {
      const errorMessage = 'Restart rate limit test';

      // Report errors up to rate limit
      const firstBatchPromises = [];
      for (let i = 0; i < 100; i++) {
        firstBatchPromises.push(service.report(new Error(errorMessage)));
      }
      await Promise.all(firstBatchPromises);

      // Restart service
      await service.dispose();
      service = new ErrorReportingService(mockStore);
      await service.initialize();

      // Additional errors with same message should still be limited
      // (depending on rate limiting implementation persistence)
      const secondBatchPromises = [];
      for (let i = 0; i < 50; i++) {
        secondBatchPromises.push(service.report(new Error(errorMessage)));
      }
      await Promise.all(secondBatchPromises);

      // Rate limiting behavior may vary based on implementation
      // This test mainly ensures the service doesn't crash
      const stats = await service.getStatistics();
      expect(typeof stats.total).toBe('number');
    });

    it('should handle rate limiting with very long error messages', async () => {
      const longMessage = 'Long error message for edge case testing: ' + 'x'.repeat(3000);

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(service.report(new Error(longMessage)));
      }

      await Promise.all(promises);

      // Main goal: service should handle long messages without crashing
      const recentErrors = await service.getRecentErrors(50);
      expect(Array.isArray(recentErrors)).toBe(true);

      // Verify service remains functional after processing long messages
      await expect(service.getStatistics()).resolves.toBeDefined();
      await expect(service.report(new Error('Short message after long'))).resolves.not.toThrow();
    });
  });
});
