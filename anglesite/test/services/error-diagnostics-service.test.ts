/**
 * @file Test suite for ErrorDiagnosticsService
 */
import { ErrorDiagnosticsService } from '../../src/main/services/error-diagnostics-service';
import { IErrorReportingService } from '../../src/main/core/interfaces';
import { AngleError, ErrorSeverity, ErrorCategory } from '../../src/main/core/errors';
import { jest } from '@jest/globals';

describe('ErrorDiagnosticsService', () => {
  let diagnosticsService: ErrorDiagnosticsService;
  let mockErrorReportingService: jest.Mocked<IErrorReportingService>;
  let mockStoreService: any;

  beforeEach(() => {
    // Mock ErrorReportingService based on actual interface
    mockErrorReportingService = {
      report: jest.fn(),
      getStatistics: jest.fn(),
      getRecentErrors: jest.fn(),
      clearHistory: jest.fn(),
      setEnabled: jest.fn(),
      isEnabled: jest.fn(),
      exportErrors: jest.fn(),
      initialize: jest.fn(),
      dispose: jest.fn(),
    } as any;

    // Mock StoreService
    mockStoreService = {
      get: jest.fn(),
      set: jest.fn(),
      getAll: jest.fn().mockReturnValue({}),
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

    diagnosticsService = new ErrorDiagnosticsService(mockErrorReportingService, mockStoreService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Retrieval and Filtering', () => {
    test('should retrieve all errors without filter', async () => {
      const mockErrors = [
        createMockAngleError('error1', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('error2', ErrorSeverity.LOW, ErrorCategory.FILE_SYSTEM),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const result = await diagnosticsService.getFilteredErrors();

      expect(result).toEqual(mockErrors);
      expect(mockErrorReportingService.getRecentErrors).toHaveBeenCalledWith();
    });

    test('should filter errors by severity', async () => {
      const mockErrors = [
        createMockAngleError('error1', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('error2', ErrorSeverity.LOW, ErrorCategory.FILE_SYSTEM),
        createMockAngleError('error3', ErrorSeverity.CRITICAL, ErrorCategory.NETWORK),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const result = await diagnosticsService.getFilteredErrors({
        severity: [ErrorSeverity.HIGH, ErrorSeverity.CRITICAL],
      });

      expect(result).toHaveLength(2);
      expect(result.every((e) => [ErrorSeverity.HIGH, ErrorSeverity.CRITICAL].includes(e.severity))).toBe(true);
    });

    test('should filter errors by category', async () => {
      const mockErrors = [
        createMockAngleError('error1', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('error2', ErrorSeverity.LOW, ErrorCategory.FILE_SYSTEM),
        createMockAngleError('error3', ErrorSeverity.CRITICAL, ErrorCategory.SYSTEM),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const result = await diagnosticsService.getFilteredErrors({
        category: [ErrorCategory.SYSTEM],
      });

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.category === ErrorCategory.SYSTEM)).toBe(true);
    });

    test('should filter errors by search text', async () => {
      const mockErrors = [
        createMockAngleError('website loading failed', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('file not found', ErrorSeverity.LOW, ErrorCategory.FILE_SYSTEM),
        createMockAngleError('website export error', ErrorSeverity.CRITICAL, ErrorCategory.EXPORT_OPERATION),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const result = await diagnosticsService.getFilteredErrors({
        searchText: 'website',
      });

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.message.toLowerCase().includes('website'))).toBe(true);
    });

    test('should combine multiple filter criteria', async () => {
      const mockErrors = [
        createMockAngleError('website loading failed', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('website file not found', ErrorSeverity.LOW, ErrorCategory.FILE_SYSTEM),
        createMockAngleError('website export error', ErrorSeverity.HIGH, ErrorCategory.EXPORT_OPERATION),
        createMockAngleError('system crash', ErrorSeverity.CRITICAL, ErrorCategory.SYSTEM),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const result = await diagnosticsService.getFilteredErrors({
        severity: [ErrorSeverity.HIGH],
        searchText: 'website',
      });

      expect(result).toHaveLength(2);
      expect(
        result.every((e) => e.severity === ErrorSeverity.HIGH && e.message.toLowerCase().includes('website'))
      ).toBe(true);
    });

    test('should filter errors by date range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Create mock error objects with specific timestamps
      const mockErrors = [
        new AngleError(
          'recent error',
          'TEST_RECENT_ERROR',
          ErrorCategory.SYSTEM,
          ErrorSeverity.HIGH,
          {},
          undefined,
          now
        ),
        new AngleError(
          'old error',
          'TEST_OLD_ERROR',
          ErrorCategory.FILE_SYSTEM,
          ErrorSeverity.LOW,
          {},
          undefined,
          twoHoursAgo
        ),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const result = await diagnosticsService.getFilteredErrors({
        dateRange: { start: oneHourAgo, end: now },
      });

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('recent error');
    });
  });

  describe('Error Statistics', () => {
    test('should generate error statistics', async () => {
      const mockErrors = [
        createMockAngleError('error1', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('error2', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('error3', ErrorSeverity.LOW, ErrorCategory.FILE_SYSTEM),
        createMockAngleError('error4', ErrorSeverity.CRITICAL, ErrorCategory.NETWORK),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const stats = await diagnosticsService.getErrorStatistics();

      expect(stats.total).toBe(4);
      expect(stats.bySeverity[ErrorSeverity.HIGH]).toBe(2);
      expect(stats.bySeverity[ErrorSeverity.LOW]).toBe(1);
      expect(stats.bySeverity[ErrorSeverity.CRITICAL]).toBe(1);
      expect(stats.byCategory[ErrorCategory.SYSTEM]).toBe(2);
      expect(stats.byCategory[ErrorCategory.FILE_SYSTEM]).toBe(1);
      expect(stats.byCategory[ErrorCategory.NETWORK]).toBe(1);
    });

    test('should generate hourly trends for statistics', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Create mock error objects with specific timestamps
      const mockErrors = [
        new AngleError('error1', 'TEST_ERROR_1', ErrorCategory.SYSTEM, ErrorSeverity.HIGH, {}, undefined, now),
        new AngleError('error2', 'TEST_ERROR_2', ErrorCategory.SYSTEM, ErrorSeverity.HIGH, {}, undefined, now),
        new AngleError(
          'error3',
          'TEST_ERROR_3',
          ErrorCategory.FILE_SYSTEM,
          ErrorSeverity.LOW,
          {},
          undefined,
          oneHourAgo
        ),
        new AngleError(
          'error4',
          'TEST_ERROR_4',
          ErrorCategory.NETWORK,
          ErrorSeverity.CRITICAL,
          {},
          undefined,
          twoHoursAgo
        ),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const stats = await diagnosticsService.getErrorStatistics();

      expect(stats.hourlyTrends).toHaveLength(24); // Last 24 hours
      expect(stats.hourlyTrends[23].count).toBe(2); // Current hour
      expect(stats.hourlyTrends[22].count).toBe(1); // One hour ago
      expect(stats.hourlyTrends[21].count).toBe(1); // Two hours ago
    });
  });

  describe('Real-time Subscriptions', () => {
    test('should allow subscribing to new errors', () => {
      const callback = jest.fn();
      const unsubscribe = diagnosticsService.subscribeToErrors(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    test('should handle critical error notifications manually', () => {
      const criticalError = createMockAngleError('critical error', ErrorSeverity.CRITICAL, ErrorCategory.SYSTEM);
      diagnosticsService.addCriticalNotification(criticalError);

      // Should track critical errors for notifications
      const notifications = diagnosticsService.getPendingNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].error).toEqual(criticalError);
    });
  });

  describe('Notification Management', () => {
    test('should track critical error notifications', () => {
      const criticalError = createMockAngleError('critical error', ErrorSeverity.CRITICAL, ErrorCategory.SYSTEM);

      diagnosticsService.addCriticalNotification(criticalError);

      const notifications = diagnosticsService.getPendingNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].error).toEqual(criticalError);
      expect(notifications[0].dismissed).toBe(false);
    });

    test('should allow dismissing notifications', () => {
      const criticalError = createMockAngleError('critical error', ErrorSeverity.CRITICAL, ErrorCategory.SYSTEM);

      diagnosticsService.addCriticalNotification(criticalError);
      const notifications = diagnosticsService.getPendingNotifications();
      const notificationId = notifications[0].id;

      diagnosticsService.dismissNotification(notificationId);

      const updatedNotifications = diagnosticsService.getPendingNotifications();
      expect(updatedNotifications).toHaveLength(0);
    });

    test('should not create duplicate notifications for same error', () => {
      const criticalError = createMockAngleError('critical error', ErrorSeverity.CRITICAL, ErrorCategory.SYSTEM);

      diagnosticsService.addCriticalNotification(criticalError);
      diagnosticsService.addCriticalNotification(criticalError);

      const notifications = diagnosticsService.getPendingNotifications();
      expect(notifications).toHaveLength(1);
    });
  });

  describe('Error Management', () => {
    test('should clear all errors', async () => {
      const errorIds = ['error1', 'error2'];

      await diagnosticsService.clearErrors(errorIds);

      expect(mockErrorReportingService.clearHistory).toHaveBeenCalled();
    });

    test('should clear all errors when no IDs provided', async () => {
      await diagnosticsService.clearErrors();

      expect(mockErrorReportingService.clearHistory).toHaveBeenCalled();
    });

    test('should export filtered errors', async () => {
      const mockErrors = [
        createMockAngleError('error1', ErrorSeverity.HIGH, ErrorCategory.SYSTEM),
        createMockAngleError('error2', ErrorSeverity.LOW, ErrorCategory.FILE_SYSTEM),
      ];

      mockErrorReportingService.getRecentErrors.mockResolvedValue(mockErrors);

      const exportPath = await diagnosticsService.exportErrors({
        severity: [ErrorSeverity.HIGH],
      });

      expect(exportPath).toContain('error-export-');
      expect(exportPath).toContain('.json');
    });
  });
});

// Helper function to create mock AngleError instances
function createMockAngleError(message: string, severity: ErrorSeverity, category: ErrorCategory): AngleError {
  return new AngleError(message, `TEST_${message.replace(/\s+/g, '_').toUpperCase()}`, category, severity, {
    operation: 'test-operation',
    context: { test: true },
  });
}
