/**
 * @file Test suite for Diagnostics IPC handlers
 */
import { ipcMain, IpcMainInvokeEvent, WebContents, BrowserWindow } from 'electron';
import { setupDiagnosticsHandlers } from '../../src/main/ipc/diagnostics';
import { ErrorDiagnosticsService } from '../../src/main/services/error-diagnostics-service';
import { DiagnosticsWindowManager } from '../../src/main/ui/diagnostics-window-manager';
import { AngleError, ErrorSeverity, ErrorCategory } from '../../src/main/core/errors';
import { jest } from '@jest/globals';
import { getGlobalContext } from '../../src/main/core/service-registry';
import { ServiceKeys } from '../../src/main/core/container';

// Mock Electron
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn(),
  },
  BrowserWindow: {
    fromWebContents: jest.fn(),
  },
}));

// Mock service registry
jest.mock('../../src/main/core/service-registry', () => ({
  getGlobalContext: jest.fn(),
}));

// Mock logger
jest.mock('../../src/main/utils/logging', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  sanitize: {
    error: (error: any) => error?.message || 'Unknown error',
  },
}));

describe('Diagnostics IPC Handlers', () => {
  let mockErrorDiagnosticsService: any;
  let mockDiagnosticsWindowManager: any;
  let mockContext: any;
  let mockEvent: IpcMainInvokeEvent;
  let mockWebContents: any;
  let mockWindow: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock services
    mockErrorDiagnosticsService = {
      getFilteredErrors: jest.fn().mockResolvedValue([] as any),
      getErrorStatistics: jest.fn().mockResolvedValue({
        total: 0,
        bySeverity: {},
        byCategory: {},
        hourlyTrends: [],
      } as any),
      subscribeToErrors: jest.fn().mockReturnValue((() => {}) as any),
      getPendingNotifications: jest.fn().mockReturnValue([] as any),
      dismissNotification: jest.fn(),
      clearErrors: jest.fn().mockResolvedValue(undefined as any),
      exportErrors: jest.fn().mockResolvedValue('/tmp/export.json' as any),
      getNotificationPreferences: jest.fn().mockReturnValue({
        enableCriticalNotifications: true,
        enableHighNotifications: false,
        notificationDuration: 5000,
      } as any),
      setNotificationPreferences: jest.fn(),
      getServiceHealth: jest.fn().mockReturnValue({
        isHealthy: true,
        errorReportingConnected: true,
        activeSubscriptions: 1,
        pendingNotifications: 0,
      } as any),
    } as any;

    mockDiagnosticsWindowManager = {
      createOrShowWindow: jest.fn().mockResolvedValue(mockWindow as any),
      closeWindow: jest.fn(),
      toggleWindow: jest.fn(),
      isWindowOpen: jest.fn().mockReturnValue(false),
      getWindowStats: jest.fn().mockReturnValue({
        isOpen: false,
        isVisible: false,
        bounds: null,
        preferences: {},
      }),
      getWindowPreferences: jest.fn().mockReturnValue({}),
      updateWindowPreferences: jest.fn(),
    } as any;

    // Mock context
    mockContext = {
      getService: jest.fn((key: string) => {
        if (key === 'ErrorDiagnosticsService') return mockErrorDiagnosticsService;
        if (key === 'DiagnosticsWindowManager') return mockDiagnosticsWindowManager;
        return null;
      }),
    };

    (getGlobalContext as jest.Mock).mockReturnValue(mockContext);

    // Mock event
    mockWebContents = {
      id: 1,
      send: jest.fn(),
    } as any;

    mockWindow = {
      webContents: mockWebContents,
      id: 1,
    } as any;

    mockEvent = {
      sender: mockWebContents,
    } as any;

    (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(mockWindow);

    // Setup handlers
    setupDiagnosticsHandlers();
  });

  describe('Error Data Retrieval', () => {
    test('should handle get-errors request', async () => {
      const mockErrors = [new AngleError('Test error', 'TEST_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.HIGH)];
      mockErrorDiagnosticsService.getFilteredErrors.mockResolvedValue(mockErrors);

      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:get-errors'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      const result = await handler(mockEvent, { severity: [ErrorSeverity.HIGH] });

      expect(mockErrorDiagnosticsService.getFilteredErrors).toHaveBeenCalledWith({
        severity: [ErrorSeverity.HIGH],
      });
      expect(result).toEqual(mockErrors);
    });

    test('should handle get-statistics request', async () => {
      const mockStats = {
        total: 10,
        bySeverity: {
          [ErrorSeverity.LOW]: 5,
          [ErrorSeverity.MEDIUM]: 0,
          [ErrorSeverity.HIGH]: 5,
          [ErrorSeverity.CRITICAL]: 0,
        },
        byCategory: { [ErrorCategory.SYSTEM]: 10 },
        hourlyTrends: [],
      };
      mockErrorDiagnosticsService.getErrorStatistics.mockResolvedValue(mockStats);

      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:get-statistics'
      )?.[1] as Function;

      const result = await handler(mockEvent, {});

      expect(mockErrorDiagnosticsService.getErrorStatistics).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });

    test('should handle errors gracefully', async () => {
      mockErrorDiagnosticsService.getFilteredErrors.mockRejectedValue(new Error('Service error'));

      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:get-errors'
      )?.[1] as Function;

      await expect(handler(mockEvent, {})).rejects.toThrow('Service error');
    });
  });

  describe('Real-time Subscriptions', () => {
    test('should handle error subscription request', () => {
      const handler = (ipcMain.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:subscribe-errors'
      )?.[1] as Function;

      handler(mockEvent);

      expect(mockErrorDiagnosticsService.subscribeToErrors).toHaveBeenCalled();
      expect(mockEvent.sender.send).toHaveBeenCalledWith('diagnostics:subscription-confirmed', {
        subscribed: true,
      });
    });

    test('should handle unsubscribe request', () => {
      // First subscribe
      const subscribeHandler = (ipcMain.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:subscribe-errors'
      )?.[1] as Function;

      const mockUnsubscribe = jest.fn();
      mockErrorDiagnosticsService.subscribeToErrors.mockReturnValue(mockUnsubscribe);

      subscribeHandler(mockEvent);

      // Then unsubscribe
      const unsubscribeHandler = (ipcMain.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:unsubscribe-errors'
      )?.[1] as Function;

      expect(unsubscribeHandler).toBeDefined();
      unsubscribeHandler(mockEvent);

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    test('should broadcast errors to subscribed windows', () => {
      const subscribeHandler = (ipcMain.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:subscribe-errors'
      )?.[1] as Function;

      let errorCallback: ((error: AngleError) => void) | undefined;
      mockErrorDiagnosticsService.subscribeToErrors.mockImplementation((callback) => {
        errorCallback = callback;
        return () => {};
      });

      subscribeHandler(mockEvent);

      // Simulate error
      const testError = new AngleError('Test error', 'TEST', ErrorCategory.SYSTEM, ErrorSeverity.HIGH);
      errorCallback?.(testError);

      expect(mockEvent.sender.send).toHaveBeenCalledWith('diagnostics:error-update', testError);
    });
  });

  describe('Notification Management', () => {
    test('should handle get-notifications request', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          error: new AngleError('Critical error', 'CRIT', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL),
          timestamp: new Date(),
          dismissed: false,
        },
      ];
      mockErrorDiagnosticsService.getPendingNotifications.mockReturnValue(mockNotifications);

      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:get-notifications'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      const result = await handler(mockEvent);

      expect(result).toEqual(mockNotifications);
    });

    test('should handle dismiss-notification request', async () => {
      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:dismiss-notification'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      await handler(mockEvent, 'notif-123');

      expect(mockErrorDiagnosticsService.dismissNotification).toHaveBeenCalledWith('notif-123');
    });
  });

  describe('Error Management', () => {
    test('should handle clear-errors request', async () => {
      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:clear-errors'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      await handler(mockEvent, ['error1', 'error2']);

      expect(mockErrorDiagnosticsService.clearErrors).toHaveBeenCalledWith(['error1', 'error2']);
    });

    test('should handle export-errors request', async () => {
      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:export-errors'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      const result = await handler(mockEvent, { severity: [ErrorSeverity.HIGH] });

      expect(mockErrorDiagnosticsService.exportErrors).toHaveBeenCalledWith({
        severity: [ErrorSeverity.HIGH],
      });
      expect(result).toBe('/tmp/export.json');
    });
  });

  describe('Window Management', () => {
    test('should handle show-window request', async () => {
      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:show-window'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      await handler(mockEvent);

      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalled();
    });

    test('should handle close-window request', async () => {
      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:close-window'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      await handler(mockEvent);

      expect(mockDiagnosticsWindowManager.closeWindow).toHaveBeenCalled();
    });

    test('should handle get-window-state request', async () => {
      const mockStats = {
        isOpen: true,
        isVisible: true,
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        preferences: {},
      };
      mockDiagnosticsWindowManager.getWindowStats.mockReturnValue(mockStats);

      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:get-window-state'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      const result = await handler(mockEvent);

      expect(result).toEqual(mockStats);
    });
  });

  describe('Preferences', () => {
    test('should handle get-preferences request', async () => {
      const mockPrefs = {
        enableCriticalNotifications: true,
        enableHighNotifications: false,
        notificationDuration: 5000,
      };
      mockErrorDiagnosticsService.getNotificationPreferences.mockReturnValue(mockPrefs);

      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:get-preferences'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      const result = await handler(mockEvent);

      expect(result).toEqual({
        notifications: mockPrefs,
        window: {},
      });
    });

    test('should handle set-preferences request', async () => {
      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:set-preferences'
      )?.[1] as Function;

      const prefs = {
        notifications: { enableHighNotifications: true },
        window: { autoShow: false },
      };

      expect(handler).toBeDefined();
      await handler(mockEvent, prefs);

      expect(mockErrorDiagnosticsService.setNotificationPreferences).toHaveBeenCalledWith({
        enableHighNotifications: true,
      });
      expect(mockDiagnosticsWindowManager.updateWindowPreferences).toHaveBeenCalledWith({
        autoShow: false,
      });
    });
  });

  describe('Service Health', () => {
    test('should handle get-service-health request', async () => {
      const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:get-service-health'
      )?.[1] as Function;

      expect(handler).toBeDefined();
      const result = await handler(mockEvent);

      expect(result).toEqual({
        isHealthy: true,
        errorReportingConnected: true,
        activeSubscriptions: 1,
        pendingNotifications: 0,
      });
    });
  });

  describe('Window Cleanup', () => {
    test('should cleanup subscriptions when window is closed', () => {
      // Subscribe first
      const subscribeHandler = (ipcMain.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'diagnostics:subscribe-errors'
      )?.[1] as Function;

      const mockUnsubscribe = jest.fn();
      mockErrorDiagnosticsService.subscribeToErrors.mockReturnValue(mockUnsubscribe);

      subscribeHandler(mockEvent);

      // Simulate window close
      mockWindow.webContents.send = jest.fn();
      (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(null);

      // Try to send error update - should detect window is closed
      const errorCallback = (mockErrorDiagnosticsService.subscribeToErrors as jest.Mock).mock.calls[0][0] as Function;
      const testError = new AngleError('Test', 'TEST', ErrorCategory.SYSTEM, ErrorSeverity.HIGH);
      errorCallback(testError);

      // Should have cleaned up
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
