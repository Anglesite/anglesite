/**
 * @file Service Error Handler Integration Tests
 * @description Integration tests for service error handler updates
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorReportingService } from '../../src/main/services/error-reporting-service';
import { ErrorHandlerUtility } from '../../src/main/utils/error-handler-utility';
import { ErrorCategory } from '../../src/main/core/errors';
import { IStore } from '../../src/main/core/interfaces';

// Mock Electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((path: string) => {
      if (path === 'userData') {
        return process.env.TEST_USER_DATA || '/tmp/anglesite-service-integration-test';
      }
      return `/mock/${path}`;
    }),
    getVersion: jest.fn(() => '1.0.0-service-integration-test'),
  },
}));

describe('Service Error Handler Integration', () => {
  let errorReportingService: ErrorReportingService;
  let errorHandlerUtil: ErrorHandlerUtility;
  let mockStore: jest.Mocked<IStore>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-error-integration-'));
    process.env.TEST_USER_DATA = tempDir;
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up service integration test directory:', error);
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

    // Use real ErrorReportingService for integration testing
    errorReportingService = new ErrorReportingService(mockStore);
    await errorReportingService.initialize();

    // Clear any previous errors to ensure test isolation
    await errorReportingService.clearHistory();

    errorHandlerUtil = new ErrorHandlerUtility(errorReportingService);
  });

  afterEach(async () => {
    if (errorReportingService) {
      await errorReportingService.dispose();
    }
  });

  describe('Service Error Reporting Integration', () => {
    it('should report service errors through ErrorReportingService', async () => {
      const serviceError = new Error('Monitor configuration failed');

      await errorHandlerUtil.reportServiceError('MonitorManager', 'getConfiguration', serviceError, {
        monitorId: 'primary',
        configType: 'display',
      });

      // Verify error was actually reported to the service
      const recentErrors = await errorReportingService.getRecentErrors(5);
      expect(recentErrors).toHaveLength(1);

      const reportedError = recentErrors[0];
      expect(reportedError.error.message).toBe('Monitor configuration failed');
      expect(reportedError.context.serviceName).toBe('MonitorManager');
      expect(reportedError.context.operation).toBe('getConfiguration');
      expect(reportedError.context.category).toBe(ErrorCategory.SERVICE_MANAGEMENT);
      expect(reportedError.context.monitorId).toBe('primary');
    });

    it('should categorize service errors correctly', async () => {
      await errorHandlerUtil.reportServiceError('DNS', 'resolve', new Error('DNS resolution failed'));

      const stats = await errorReportingService.getStatistics();
      expect(stats.byCategory.service_management).toBe(1);
    });

    it('should include correlation IDs for service errors', async () => {
      await errorHandlerUtil.reportServiceError('TestService', 'testOperation', new Error('Test error'));

      const recentErrors = await errorReportingService.getRecentErrors(1);
      const context = recentErrors[0].context;

      expect(context.correlationId).toBeDefined();
      expect(context.correlationId).toMatch(/^service-\w+-\d+$/);
    });

    it('should handle service errors when ErrorReportingService is unavailable', async () => {
      // Disable the service
      errorReportingService.setEnabled(false);

      // Should not throw even when service is disabled
      await expect(
        errorHandlerUtil.reportServiceError('TestService', 'failedOperation', new Error('Service unavailable test'))
      ).resolves.not.toThrow();
    });

    it('should preserve additional context from services', async () => {
      const complexContext = {
        hostEntry: {
          ip: '127.0.0.1',
          domain: 'test.local',
        },
        operation: 'addHost',
        backup: true,
        lineNumber: 42,
      };

      await errorHandlerUtil.reportServiceError(
        'HostsManager',
        'addHost',
        new Error('Hosts file error'),
        complexContext
      );

      const recentErrors = await errorReportingService.getRecentErrors(1);
      const reportedContext = recentErrors[0].context;

      expect(reportedContext.hostEntry).toEqual({
        ip: '127.0.0.1',
        domain: 'test.local',
      });
      expect(reportedContext.backup).toBe(true);
      expect(reportedContext.lineNumber).toBe(42);
    });
  });

  describe('Error Handler Availability Integration', () => {
    it('should report availability status correctly', async () => {
      expect(errorHandlerUtil.isAvailable()).toBe(true);

      errorReportingService.setEnabled(false);
      expect(errorHandlerUtil.isAvailable()).toBe(false);

      errorReportingService.setEnabled(true);
      expect(errorHandlerUtil.isAvailable()).toBe(true);
    });

    it('should handle service initialization race conditions', async () => {
      // Create new service that hasn't been initialized
      const uninitializedService = new ErrorReportingService(mockStore);
      const utilWithUninitializedService = new ErrorHandlerUtility(uninitializedService);

      // Should handle gracefully
      await expect(
        utilWithUninitializedService.reportServiceError('TestService', 'test', new Error('Race condition test'))
      ).resolves.not.toThrow();
    });
  });

  describe('Real-World Service Error Scenarios', () => {
    it('should handle MonitorManager configuration errors', async () => {
      const monitorError = new Error('Failed to get monitor configuration');

      await errorHandlerUtil.reportServiceError('MonitorManager', 'getMonitorConfiguration', monitorError, {
        monitorCount: 2,
        primaryMonitor: false,
        scaleFactor: 2.0,
      });

      const stats = await errorReportingService.getStatistics();
      expect(stats.total).toBe(1);
      expect(stats.byCategory.service_management).toBe(1);

      const recentErrors = await errorReportingService.getRecentErrors(1);
      expect(recentErrors[0].context.monitorCount).toBe(2);
    });

    it('should handle DNS/Hosts management errors', async () => {
      const dnsError = new Error('Failed to update hosts file');

      await errorHandlerUtil.reportServiceError('HostsManager', 'updateHostsFile', dnsError, {
        operation: 'add',
        domain: 'mysite.test',
        ip: '127.0.0.1',
        backupCreated: true,
      });

      const recentErrors = await errorReportingService.getRecentErrors(1);
      const context = recentErrors[0].context;

      expect(context.serviceName).toBe('HostsManager');
      expect(context.domain).toBe('mysite.test');
      expect(context.backupCreated).toBe(true);
    });

    it('should handle service startup and shutdown errors', async () => {
      // Simulate service startup error
      await errorHandlerUtil.reportServiceError(
        'WebsiteServerManager',
        'startServer',
        new Error('Port already in use'),
        {
          port: 3000,
          websiteId: 'my-website',
          attemptNumber: 3,
        }
      );

      // Simulate service shutdown error
      await errorHandlerUtil.reportServiceError(
        'WebsiteServerManager',
        'stopServer',
        new Error('Server process not found'),
        {
          port: 3001,
          websiteId: 'another-website',
          gracefulShutdown: false,
        }
      );

      const stats = await errorReportingService.getStatistics();
      expect(stats.total).toBe(2);
      expect(stats.byCategory.service_management).toBe(2);
    });
  });

  describe('Service Error Context Validation', () => {
    it('should standardize timestamps across service errors', async () => {
      const beforeTime = Date.now();

      await errorHandlerUtil.reportServiceError('TestService', 'test', new Error('Timestamp test'));

      const afterTime = Date.now();
      const recentErrors = await errorReportingService.getRecentErrors(1);
      const timestamp = recentErrors[0].context.timestamp;

      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should handle service errors with null or undefined context', async () => {
      await expect(
        errorHandlerUtil.reportServiceError('TestService', 'test', new Error('Null context test'), null as any)
      ).resolves.not.toThrow();

      await expect(
        errorHandlerUtil.reportServiceError(
          'TestService',
          'test',
          new Error('Undefined context test'),
          undefined as any
        )
      ).resolves.not.toThrow();

      const recentErrors = await errorReportingService.getRecentErrors(2);
      expect(recentErrors).toHaveLength(2);
    });
  });
});
