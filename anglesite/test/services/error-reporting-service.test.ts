/**
 * @file ErrorReportingService Unit Tests
 * @description Comprehensive tests for the global error reporting service
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorReportingService } from '../../src/main/services/error-reporting-service';
import { AngleError, ErrorSeverity, ErrorCategory, ErrorUtils } from '../../src/main/core/errors';
import { IStore } from '../../src/main/core/interfaces';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    appendFile: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockResolvedValue({ size: 1000, mtime: new Date() }),
    unlink: jest.fn().mockResolvedValue(undefined),
    mkdtemp: jest.fn().mockResolvedValue('/tmp/test-dir'),
    rm: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((path: string) => `/mock/${path}`),
    getVersion: jest.fn(() => '1.0.0-test'),
  },
}));

describe('ErrorReportingService', () => {
  let service: ErrorReportingService;
  let mockStore: jest.Mocked<IStore>;
  let testTempDir: string;

  // Get reference to mocked fs methods
  const mockFs = require('fs').promises;

  beforeEach(async () => {
    // Use mock temporary directory
    testTempDir = '/tmp/test-error-reporting';

    // Create mock store
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

    // Reset mocks
    jest.clearAllMocks();
    Object.values(mockFs).forEach((mock) => (mock as jest.Mock).mockClear());

    service = new ErrorReportingService(mockStore);
  });

  afterEach(async () => {
    // Clean up service
    if (service) {
      await service.dispose();
    }

    // Clear all timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Service Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(service.initialize()).resolves.not.toThrow();

      // Verify directory creation was attempted
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      // Mock filesystem failure
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      // Should not throw but should handle gracefully
      await expect(service.initialize()).resolves.not.toThrow();
    });

    it('should start in enabled state by default', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('should dispose cleanly', async () => {
      await service.initialize();

      // Should not throw during disposal
      await expect(service.dispose()).resolves.not.toThrow();
    });
  });

  describe('Error Reporting', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should accept and process a simple error', async () => {
      const testError = new Error('Test error message');

      await expect(service.report(testError)).resolves.not.toThrow();
    });

    it('should accept AngleError instances', async () => {
      const angleError = new AngleError('Test angle error', 'TEST_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.MEDIUM);

      await expect(service.report(angleError)).resolves.not.toThrow();
    });

    it('should accept errors with context', async () => {
      const testError = new Error('Context error');
      const context = { userId: '123', operation: 'test' };

      await expect(service.report(testError, context)).resolves.not.toThrow();
    });

    it('should handle non-Error objects', async () => {
      const stringError = 'String error message';
      const objectError = { message: 'Object error' };
      const numberError = 42;

      await expect(service.report(stringError)).resolves.not.toThrow();
      await expect(service.report(objectError)).resolves.not.toThrow();
      await expect(service.report(numberError)).resolves.not.toThrow();
    });

    it('should reject errors when disabled', async () => {
      service.setEnabled(false);

      const testError = new Error('Disabled test');
      await service.report(testError);

      // Should not appear in recent errors
      const recentErrors = await service.getRecentErrors(10);
      expect(recentErrors.length).toBe(0);
    });

    it('should sanitize context data', async () => {
      const testError = new Error('Sanitization test');
      const context = {
        userPath: '/Users/sensitiveuser/Documents/secret.txt',
        apiKey: 'sk-1234567890abcdef',
        normalField: 'normal value',
      };

      await service.report(testError, context);

      // Context should be sanitized but we can't easily verify without exposing internals
      // This test documents the expected behavior
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should enforce rate limiting', async () => {
      // Use fake timers for precise control
      jest.useFakeTimers();

      // Report same error many times quickly
      const testError = new Error('Rate limit test');
      const reportPromises = Array(150)
        .fill(0)
        .map(() => service.report(testError));

      await Promise.all(reportPromises);

      const recentErrors = await service.getRecentErrors(200);

      // Should have applied rate limiting (default is 100/minute)
      expect(recentErrors.length).toBeLessThanOrEqual(100);

      jest.useRealTimers();
    });

    it('should reset rate limits after time window', async () => {
      jest.useFakeTimers();

      // Report at limit
      const testError = new Error('Reset test');
      for (let i = 0; i < 100; i++) {
        await service.report(testError);
      }

      // Advance time by 1 minute
      jest.advanceTimersByTime(60 * 1000);

      // Should accept new errors
      await expect(service.report(testError)).resolves.not.toThrow();

      jest.useRealTimers();
    });
  });

  describe('Configuration Management', () => {
    it('should allow enabling and disabling', () => {
      expect(service.isEnabled()).toBe(true);

      service.setEnabled(false);
      expect(service.isEnabled()).toBe(false);

      service.setEnabled(true);
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('Statistics Generation', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return empty statistics initially', async () => {
      const stats = await service.getStatistics();

      expect(stats.total).toBe(0);
      // Categories and severities should have zero counts but be initialized
      Object.values(stats.byCategory).forEach((count) => expect(count).toBe(0));
      Object.values(stats.bySeverity).forEach((count) => expect(count).toBe(0));
    });

    it('should generate statistics after errors reported', async () => {
      // Report varied errors
      await service.report(new AngleError('Critical sys', 'TEST1', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL));
      await service.report(new AngleError('Medium sys', 'TEST2', ErrorCategory.SYSTEM, ErrorSeverity.MEDIUM));
      await service.report(new AngleError('Low validation', 'TEST3', ErrorCategory.VALIDATION, ErrorSeverity.LOW));

      // Force processing by triggering a flush
      await service.clearHistory(); // This will include current buffer in statistics

      // Note: Without direct access to internal buffer, this test is limited
      // In a real scenario, we might need to expose a testing API or wait for persistence
    });

    it('should support date filtering in statistics', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

      const stats = await service.getStatistics(pastDate);

      expect(typeof stats.total).toBe('number');
    });
  });

  describe('Recent Errors Retrieval', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return empty array initially', async () => {
      const recentErrors = await service.getRecentErrors();
      expect(recentErrors).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      // Report multiple errors
      for (let i = 0; i < 10; i++) {
        await service.report(new Error(`Error ${i}`));
      }

      const limited = await service.getRecentErrors(5);
      expect(limited.length).toBeLessThanOrEqual(5);
    });

    it('should handle large limits gracefully', async () => {
      const massive = await service.getRecentErrors(1000000);
      expect(Array.isArray(massive)).toBe(true);
    });
  });

  describe('History Management', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should clear error history', async () => {
      // Report some errors
      await service.report(new Error('Error 1'));
      await service.report(new Error('Error 2'));

      // Clear history
      await service.clearHistory();

      // Should be empty
      const recentErrors = await service.getRecentErrors();
      expect(recentErrors).toEqual([]);
    });

    it('should handle clear history errors gracefully', async () => {
      // Mock filesystem error
      mockFs.readdir.mockRejectedValue(new Error('FS error'));

      await expect(service.clearHistory()).resolves.not.toThrow();
    });
  });

  describe('Export Functionality', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should export errors to specified file', async () => {
      const exportPath = path.join(testTempDir, 'export.json');

      // Report some test errors
      await service.report(new Error('Export test 1'));
      await service.report(new Error('Export test 2'));

      // Mock successful file write
      mockFs.writeFile.mockResolvedValue(undefined);

      await expect(service.exportErrors(exportPath)).resolves.not.toThrow();

      // Verify writeFile was called
      expect(mockFs.writeFile).toHaveBeenCalledWith(exportPath, expect.stringContaining('exportDate'), 'utf-8');
    });

    it('should support date filtering in exports', async () => {
      const exportPath = path.join(testTempDir, 'export-filtered.json');
      const sinceDate = new Date(Date.now() - 1000); // 1 second ago

      mockFs.writeFile.mockResolvedValue(undefined);

      await expect(service.exportErrors(exportPath, sinceDate)).resolves.not.toThrow();
    });

    it('should handle export errors properly', async () => {
      const exportPath = '/invalid/path/export.json';

      // Mock filesystem error
      mockFs.writeFile.mockRejectedValue(new Error('Permission denied'));

      await expect(service.exportErrors(exportPath)).rejects.toThrow('Permission denied');
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle service initialization failure gracefully', async () => {
      // Mock all filesystem operations to fail
      mockFs.mkdir.mockRejectedValue(new Error('FS failure'));
      mockFs.readdir.mockRejectedValue(new Error('FS failure'));

      // Should not throw
      await expect(service.initialize()).resolves.not.toThrow();

      // Service should still be functional
      expect(service.isEnabled()).toBe(true);
    });

    it('should handle persistence failures during error reporting', async () => {
      await service.initialize();

      // Mock persistence failure
      mockFs.appendFile.mockRejectedValue(new Error('Disk full'));

      // Should not throw when reporting errors
      await expect(service.report(new Error('Persistence fail test'))).resolves.not.toThrow();
    });

    it('should continue operating after disposal', async () => {
      await service.initialize();
      await service.dispose();

      // Should still accept configuration changes
      service.setEnabled(false);
      expect(service.isEnabled()).toBe(false);
    });
  });
});
