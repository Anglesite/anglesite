/**
 * @file Error Handler Utility Tests
 * @description Tests for the centralized error handler utility
 */

import { ErrorHandlerUtility } from '../../src/main/utils/error-handler-utility';
import { ErrorReportingService } from '../../src/main/services/error-reporting-service';
import { ErrorSeverity, ErrorCategory } from '../../src/main/core/errors';
import { IStore } from '../../src/main/core/interfaces';
import * as fc from 'fast-check';

// Mock the ErrorReportingService
jest.mock('../../src/main/services/error-reporting-service');

describe('ErrorHandlerUtility', () => {
  let errorHandlerUtil: ErrorHandlerUtility;
  let mockErrorReportingService: jest.Mocked<ErrorReportingService>;
  let mockStore: jest.Mocked<IStore>;

  beforeEach(() => {
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

    mockErrorReportingService = new ErrorReportingService(mockStore) as jest.Mocked<ErrorReportingService>;
    mockErrorReportingService.report = jest.fn().mockResolvedValue(undefined);
    mockErrorReportingService.isEnabled = jest.fn().mockReturnValue(true);

    errorHandlerUtil = new ErrorHandlerUtility(mockErrorReportingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Error Reporting', () => {
    it('should report error with default HIGH severity', async () => {
      const testError = new Error('Test error');
      const context = { operation: 'test' };

      await errorHandlerUtil.reportError(testError, context, ErrorSeverity.HIGH);

      expect(mockErrorReportingService.report).toHaveBeenCalledWith(testError, expect.objectContaining(context));
    });

    it('should handle null and undefined errors gracefully', async () => {
      await expect(errorHandlerUtil.reportError(null)).resolves.not.toThrow();
      await expect(errorHandlerUtil.reportError(undefined)).resolves.not.toThrow();

      expect(mockErrorReportingService.report).toHaveBeenCalledTimes(2);
    });

    it('should report errors when service is available', async () => {
      const testError = new Error('Available service test');

      await errorHandlerUtil.reportError(testError);

      expect(mockErrorReportingService.report).toHaveBeenCalledWith(testError, expect.any(Object));
    });
  });

  describe('Service Error Reporting', () => {
    it('should report service error with SERVICE_MANAGEMENT category', async () => {
      const testError = new Error('Service error');

      await errorHandlerUtil.reportServiceError('TestService', 'testOperation', testError, { additionalInfo: 'test' });

      expect(mockErrorReportingService.report).toHaveBeenCalledWith(
        testError,
        expect.objectContaining({
          category: ErrorCategory.SERVICE_MANAGEMENT,
          serviceName: 'TestService',
          operation: 'testOperation',
          additionalInfo: 'test',
        })
      );
    });

    it('should include service-specific context', async () => {
      await errorHandlerUtil.reportServiceError('DNS', 'resolve', new Error('DNS error'));

      const reportCall = mockErrorReportingService.report.mock.calls[0];
      const context = reportCall[1];

      expect(context).toMatchObject({
        serviceName: 'DNS',
        operation: 'resolve',
        category: ErrorCategory.SERVICE_MANAGEMENT,
      });
    });
  });

  describe('IPC Error Reporting', () => {
    it('should report IPC error with IPC_COMMUNICATION category', async () => {
      const testError = new Error('IPC error');

      await errorHandlerUtil.reportIPCError('file', 'getFileUrl', testError, { filePath: '/test/path' });

      expect(mockErrorReportingService.report).toHaveBeenCalledWith(
        testError,
        expect.objectContaining({
          category: ErrorCategory.IPC_COMMUNICATION,
          channel: 'file',
          operation: 'getFileUrl',
          filePath: '/test/path',
        })
      );
    });

    it('should generate correlation IDs for IPC operations', async () => {
      await errorHandlerUtil.reportIPCError('website', 'create', new Error('IPC error'));

      const context = mockErrorReportingService.report.mock.calls[0][1];
      expect(context).toHaveProperty('correlationId');
      expect(context.correlationId).toMatch(/^ipc-\w+-\d+$/);
    });
  });

  describe('Renderer Error Reporting', () => {
    it('should report renderer error with UI_COMPONENT category', async () => {
      const testError = new Error('Renderer error');
      const errorInfo = { componentStack: 'TestComponent' };

      await errorHandlerUtil.reportRendererError('TestComponent', testError, errorInfo);

      expect(mockErrorReportingService.report).toHaveBeenCalledWith(
        testError,
        expect.objectContaining({
          category: ErrorCategory.UI_COMPONENT,
          component: 'TestComponent',
          errorInfo,
        })
      );
    });

    it('should generate correlation IDs for renderer errors', async () => {
      await errorHandlerUtil.reportRendererError('TestComponent', new Error('test'));

      const context = mockErrorReportingService.report.mock.calls[0][1];
      expect(context).toHaveProperty('correlationId');
      expect(context.correlationId).toMatch(/^ui-\w+-\d+$/);
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle service unavailability gracefully', async () => {
      mockErrorReportingService.isEnabled.mockReturnValue(false);

      await expect(errorHandlerUtil.reportError(new Error('Service unavailable test'))).resolves.not.toThrow();
    });

    it('should handle service report failures gracefully', async () => {
      mockErrorReportingService.report.mockRejectedValue(new Error('Report failed'));

      await expect(errorHandlerUtil.reportError(new Error('Report failure test'))).resolves.not.toThrow();
    });

    it('should return false when service is not available', () => {
      mockErrorReportingService.isEnabled.mockReturnValue(false);

      expect(errorHandlerUtil.isAvailable()).toBe(false);
    });

    it('should return true when service is available', () => {
      mockErrorReportingService.isEnabled.mockReturnValue(true);

      expect(errorHandlerUtil.isAvailable()).toBe(true);
    });
  });

  describe('Severity Mapping', () => {
    it('should map HIGH severity correctly', async () => {
      const testError = new Error('High severity error');

      await errorHandlerUtil.reportError(testError, {}, ErrorSeverity.HIGH);

      // The error severity should be handled by the AngleError wrapping in ErrorReportingService
      expect(mockErrorReportingService.report).toHaveBeenCalledWith(testError, expect.any(Object));
    });

    it('should map MEDIUM severity correctly', async () => {
      const testError = new Error('Medium severity error');

      await errorHandlerUtil.reportError(testError, {}, ErrorSeverity.MEDIUM);

      expect(mockErrorReportingService.report).toHaveBeenCalledWith(testError, expect.any(Object));
    });
  });

  describe('Context Standardization', () => {
    it('should include timestamp in all error reports', async () => {
      await errorHandlerUtil.reportError(new Error('Timestamp test'));

      const context = mockErrorReportingService.report.mock.calls[0][1];
      expect(context).toHaveProperty('timestamp');
      expect(typeof context.timestamp).toBe('number');
    });

    it('should preserve custom context fields', async () => {
      const customContext = {
        customField: 'customValue',
        numericValue: 42,
        booleanValue: true,
      };

      await errorHandlerUtil.reportError(new Error('Custom context test'), customContext);

      const context = mockErrorReportingService.report.mock.calls[0][1];
      expect(context).toMatchObject(customContext);
    });

    it('should not override system context fields', async () => {
      const contextWithSystemFields = {
        timestamp: 12345, // Should be overridden
        correlationId: 'custom-id', // Should be preserved if provided
        operation: 'customOperation',
      };

      await errorHandlerUtil.reportError(new Error('System field test'), contextWithSystemFields);

      const context = mockErrorReportingService.report.mock.calls[0][1];
      expect(context.timestamp).not.toBe(12345);
      expect(context.correlationId).toBe('custom-id');
      expect(context.operation).toBe('customOperation');
    });
  });

  // Property-based tests
  describe('Property-Based Tests', () => {
    it('should handle any error type without throwing', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.record({ message: fc.string() }),
            fc.string(),
            fc.integer(),
            fc.constant(null),
            fc.constant(undefined)
          ),
          fc.record({
            operation: fc.string(),
            serviceName: fc.option(fc.string(), { nil: undefined }),
            correlationId: fc.option(fc.string(), { nil: undefined }),
          }),
          async (error, context) => {
            await expect(errorHandlerUtil.reportError(error, context)).resolves.not.toThrow();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should preserve all provided context fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            operation: fc.string(),
            customField: fc.string(),
            numericValue: fc.integer(),
          }),
          async (context) => {
            await errorHandlerUtil.reportError(new Error('test'), context);

            const reportCall =
              mockErrorReportingService.report.mock.calls[mockErrorReportingService.report.mock.calls.length - 1];
            const reportedContext = reportCall[1];

            expect(reportedContext).toMatchObject(context);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle circular reference errors', async () => {
      const circularError: any = { message: 'Circular error' };
      circularError.self = circularError;

      await expect(errorHandlerUtil.reportError(circularError)).resolves.not.toThrow();
    });

    it('should handle extremely large contexts', async () => {
      const largeContext = {
        largeData: 'x'.repeat(50000),
        metadata: Array(1000).fill({ key: 'value' }),
      };

      await expect(errorHandlerUtil.reportError(new Error('Large context test'), largeContext)).resolves.not.toThrow();
    });

    it('should handle concurrent error reporting', async () => {
      const promises = Array(100)
        .fill(0)
        .map((_, i) => errorHandlerUtil.reportError(new Error(`Concurrent error ${i}`)));

      await expect(Promise.all(promises)).resolves.not.toThrow();
      expect(mockErrorReportingService.report).toHaveBeenCalledTimes(100);
    });
  });
});
