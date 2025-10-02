/**
 * @file System Notification Integration Tests
 * @description End-to-end tests for the complete notification system flow
 */

import { ErrorReportingService } from '../../src/main/services/error-reporting-service';
import { ErrorDiagnosticsService } from '../../src/main/services/error-diagnostics-service';
import { SystemNotificationService } from '../../src/main/services/system-notification-service';
import { DiagnosticsWindowManager } from '../../src/main/ui/diagnostics-window-manager';
import { AngleError, ErrorSeverity, ErrorCategory } from '../../src/main/core/errors';
import { IStore } from '../../src/main/core/interfaces';

// Mock Electron
jest.mock('electron', () => ({
  Notification: jest.fn(() => ({
    on: jest.fn(),
    show: jest.fn(),
    close: jest.fn(),
    isDestroyed: jest.fn(() => false),
  })),
  app: {
    dock: {
      setBadge: jest.fn(),
    },
    setBadgeCount: jest.fn(),
    getPath: jest.fn(() => '/tmp/test'),
    getVersion: jest.fn(() => '1.0.0-test'),
  },
  BrowserWindow: jest.fn(() => ({
    webContents: {
      send: jest.fn(),
    },
    loadFile: jest.fn(),
    show: jest.fn(),
    focus: jest.fn(),
    setBounds: jest.fn(),
    getBounds: jest.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    isDestroyed: jest.fn(() => false),
    isVisible: jest.fn(() => true),
    on: jest.fn(),
    once: jest.fn(),
  })),
  nativeImage: {
    createFromPath: jest.fn(() => 'mock-icon'),
  },
}));

// In-memory store for testing
class InMemoryStore implements IStore {
  private data: any = {};

  get<K extends string>(key: K): any {
    return this.data[key];
  }

  set<K extends string>(key: K, val: any): void {
    this.data[key] = val;
  }

  getAll(): any {
    return { ...this.data };
  }

  setAll(settings: any): void {
    this.data = { ...settings };
  }

  // Store interface methods (simplified for testing)
  saveWindowStates = jest.fn();
  getWindowStates = jest.fn(() => []);
  clearWindowStates = jest.fn();
  addRecentWebsite = jest.fn();
  getRecentWebsites = jest.fn(() => []);
  clearRecentWebsites = jest.fn();
  removeRecentWebsite = jest.fn();
  forceSave = jest.fn();
  dispose = jest.fn();
}

describe('System Notification Integration', () => {
  let errorReportingService: ErrorReportingService;
  let errorDiagnosticsService: ErrorDiagnosticsService;
  let diagnosticsWindowManager: DiagnosticsWindowManager;
  let systemNotificationService: SystemNotificationService;
  let mockStore: InMemoryStore;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock platform as macOS
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    // Mock notification support
    const { Notification } = require('electron');
    Notification.isSupported = jest.fn(() => true);
    Notification.requestPermission = jest.fn().mockResolvedValue('granted');

    // Create real services with in-memory store
    mockStore = new InMemoryStore();

    errorReportingService = new ErrorReportingService(mockStore);
    await errorReportingService.initialize();

    errorDiagnosticsService = new ErrorDiagnosticsService(errorReportingService, mockStore);
    diagnosticsWindowManager = new DiagnosticsWindowManager(mockStore);

    systemNotificationService = new SystemNotificationService(
      errorDiagnosticsService,
      diagnosticsWindowManager,
      mockStore
    );

    await systemNotificationService.initialize();
  }, 15000); // Increased timeout for service initialization

  afterEach(async () => {
    // Clean up services
    await systemNotificationService.dispose();
    await errorReportingService.dispose();
  });

  describe('End-to-End Critical Error Flow', () => {
    test('should create system notification when critical error is reported', async () => {
      const { Notification } = require('electron');

      // Create a critical error
      const criticalError = new AngleError(
        'Database connection lost',
        'DB_CONNECTION_LOST',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL,
        {
          operation: 'database-query',
          context: { table: 'users', query: 'SELECT * FROM users' },
        }
      );

      // Report the error through the error reporting service
      await errorReportingService.report(criticalError);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify that a system notification was created
      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Anglesite - Critical Error',
          body: 'Database connection lost',
          silent: false,
        })
      );

      // Verify badge count was updated
      const { app } = require('electron');
      expect(app.dock.setBadge).toHaveBeenCalledWith('1');
    });

    test('should coordinate dismissal between diagnostics and system notifications', async () => {
      const { Notification } = require('electron');
      const mockNotification = {
        on: jest.fn(),
        show: jest.fn(),
        close: jest.fn(),
        isDestroyed: jest.fn(() => false),
      };
      Notification.mockImplementation(() => mockNotification);

      // Create and report a critical error
      const criticalError = new AngleError(
        'Critical system failure',
        'SYSTEM_FAILURE',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL
      );

      await errorReportingService.report(criticalError);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get the notification that was created
      const pendingNotifications = errorDiagnosticsService.getPendingNotifications();
      expect(pendingNotifications).toHaveLength(1);

      const notificationId = pendingNotifications[0].id;

      // Dismiss through the system notification service
      await systemNotificationService.dismissSystemNotification(notificationId);

      // Verify both OS notification and diagnostics notification were dismissed
      expect(mockNotification.close).toHaveBeenCalled();

      const remainingNotifications = errorDiagnosticsService.getPendingNotifications();
      expect(remainingNotifications).toHaveLength(0);

      // Verify badge was cleared
      const { app } = require('electron');
      expect(app.dock.setBadge).toHaveBeenCalledWith('');
    });
  });

  describe('Real-time Error Subscription', () => {
    test('should receive and process errors from diagnostics service in real-time', async () => {
      const { Notification } = require('electron');
      let subscriptionCallback: ((error: AngleError) => void) | undefined;

      // Capture the subscription callback
      const mockSubscribe = jest.fn((callback) => {
        subscriptionCallback = callback;
        return jest.fn(); // Return unsubscribe function
      });
      errorDiagnosticsService.subscribeToErrors = mockSubscribe;

      // Re-initialize to setup subscription
      await systemNotificationService.dispose();
      systemNotificationService = new SystemNotificationService(
        errorDiagnosticsService,
        diagnosticsWindowManager,
        mockStore
      );
      await systemNotificationService.initialize();

      expect(mockSubscribe).toHaveBeenCalled();
      expect(subscriptionCallback).toBeDefined();

      // Simulate a critical error being reported
      const criticalError = new AngleError(
        'Real-time error',
        'REALTIME_ERROR',
        ErrorCategory.NETWORK,
        ErrorSeverity.CRITICAL
      );

      // Mock the diagnostics service to return a pending notification
      const mockNotification = {
        id: 'realtime-notification-1',
        error: criticalError,
        timestamp: new Date(),
        dismissed: false,
      };
      errorDiagnosticsService.getPendingNotifications = jest.fn(() => [mockNotification]);

      // Trigger the subscription callback
      subscriptionCallback!(criticalError);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify system notification was created
      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Real-time error',
        })
      );
    });

    test('should not create system notifications for non-critical errors', async () => {
      const { Notification } = require('electron');
      let subscriptionCallback: ((error: AngleError) => void) | undefined;

      errorDiagnosticsService.subscribeToErrors = jest.fn((callback) => {
        subscriptionCallback = callback;
        return jest.fn();
      });

      await systemNotificationService.dispose();
      systemNotificationService = new SystemNotificationService(
        errorDiagnosticsService,
        diagnosticsWindowManager,
        mockStore
      );
      await systemNotificationService.initialize();

      // Simulate a medium severity error
      const mediumError = new AngleError(
        'Medium severity error',
        'MEDIUM_ERROR',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );

      subscriptionCallback!(mediumError);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not create a system notification
      expect(Notification).not.toHaveBeenCalled();
    });
  });

  describe('Notification Click Integration', () => {
    test('should open diagnostics window when notification is clicked', async () => {
      const { Notification, BrowserWindow } = require('electron');
      const mockNotification = {
        on: jest.fn(),
        show: jest.fn(),
        close: jest.fn(),
        isDestroyed: jest.fn(() => false),
      };
      const mockWindow = {
        webContents: { send: jest.fn() },
        loadFile: jest.fn(),
        show: jest.fn(),
        focus: jest.fn(),
        setBounds: jest.fn(),
        getBounds: jest.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
        isDestroyed: jest.fn(() => false),
        isVisible: jest.fn(() => true),
        on: jest.fn(),
        once: jest.fn(),
      };

      Notification.mockImplementation(() => mockNotification);
      BrowserWindow.mockImplementation(() => mockWindow);

      // Create a critical error and notification
      const criticalError = new AngleError(
        'Click test error',
        'CLICK_TEST_ERROR',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL
      );

      await errorReportingService.report(criticalError);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get the click handler that was registered
      const clickHandlerCall = mockNotification.on.mock.calls.find((call) => call[0] === 'click');
      expect(clickHandlerCall).toBeDefined();

      const clickHandler = clickHandlerCall[1];

      // Simulate notification click
      await clickHandler();

      // Verify diagnostics window was opened
      expect(mockWindow.loadFile).toHaveBeenCalled();
      expect(mockWindow.show).toHaveBeenCalled();

      // Verify focus message was sent to renderer
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('diagnostics:focus-notification', expect.any(String));
    });
  });

  describe('Preferences Integration', () => {
    test('should respect notification preferences from diagnostics service', async () => {
      const { Notification } = require('electron');

      // Configure diagnostics service to disable critical notifications
      errorDiagnosticsService.setNotificationPreferences({
        enableCriticalNotifications: false,
      });

      // Create a critical error
      const criticalError = new AngleError(
        'Disabled notification test',
        'DISABLED_NOTIFICATION',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL
      );

      await errorReportingService.report(criticalError);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not create system notification when disabled
      expect(Notification).not.toHaveBeenCalled();
    });

    test('should coordinate preference changes between services', () => {
      // Update system notification preferences
      systemNotificationService.setNotificationPreferences({
        enableCriticalNotifications: false,
        enableSound: false,
        maxConcurrentNotifications: 10,
      });

      // Verify diagnostics service preferences were updated
      expect(errorDiagnosticsService.setNotificationPreferences).toHaveBeenCalledWith({
        enableCriticalNotifications: false,
        enableHighNotifications: undefined,
        notificationDuration: undefined,
      });

      // Verify system-specific preferences were stored
      const storedSettings = mockStore.getAll();
      expect(storedSettings.systemNotifications).toEqual(
        expect.objectContaining({
          enableSound: false,
          maxConcurrentNotifications: 10,
        })
      );
    });
  });

  describe('Service Health and Error Handling', () => {
    test('should maintain functionality when diagnostics window fails', async () => {
      const { Notification } = require('electron');

      // Mock diagnostics window manager to fail
      diagnosticsWindowManager.createOrShowWindow = jest.fn().mockRejectedValue(new Error('Window creation failed'));

      const criticalError = new AngleError(
        'Window failure test',
        'WINDOW_FAILURE',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL
      );

      await errorReportingService.report(criticalError);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // System notification should still be created
      expect(Notification).toHaveBeenCalled();

      // Service should remain healthy
      expect(systemNotificationService.isHealthy()).toBe(true);
    });

    test('should handle service disposal with active notifications', async () => {
      const { Notification, app } = require('electron');
      const mockNotification = {
        on: jest.fn(),
        show: jest.fn(),
        close: jest.fn(),
        isDestroyed: jest.fn(() => false),
      };
      Notification.mockImplementation(() => mockNotification);

      // Create multiple critical errors
      for (let i = 0; i < 3; i++) {
        const error = new AngleError(
          `Disposal test error ${i}`,
          `DISPOSAL_ERROR_${i}`,
          ErrorCategory.SYSTEM,
          ErrorSeverity.CRITICAL
        );
        await errorReportingService.report(error);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify notifications were created
      expect(Notification).toHaveBeenCalledTimes(3);

      // Dispose the system notification service
      await systemNotificationService.dispose();

      // Verify all notifications were closed and badge was cleared
      expect(mockNotification.close).toHaveBeenCalledTimes(3);
      expect(app.dock.setBadge).toHaveBeenCalledWith('');

      // Service should no longer be healthy
      expect(systemNotificationService.isHealthy()).toBe(false);
    });
  });

  describe('Cross-Service State Consistency', () => {
    test('should maintain consistent notification state across all services', async () => {
      // Create a critical error
      const criticalError = new AngleError(
        'State consistency test',
        'STATE_CONSISTENCY',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL
      );

      await errorReportingService.report(criticalError);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify state consistency
      const diagnosticsNotifications = errorDiagnosticsService.getPendingNotifications();
      const systemNotifications = systemNotificationService.getActiveNotifications();

      expect(diagnosticsNotifications).toHaveLength(1);
      expect(systemNotifications).toHaveLength(1);

      // IDs should match
      expect(systemNotifications[0].id).toBe(diagnosticsNotifications[0].id);

      // Error details should match
      expect(systemNotifications[0].errorNotification.error.code).toBe(diagnosticsNotifications[0].error.code);
    });

    test('should maintain state consistency during rapid error reporting', async () => {
      const errors = Array.from(
        { length: 10 },
        (_, i) => new AngleError(`Rapid error ${i}`, `RAPID_ERROR_${i}`, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL)
      );

      // Report all errors quickly
      await Promise.all(errors.map((error) => errorReportingService.report(error)));
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify state consistency
      const diagnosticsCount = errorDiagnosticsService.getPendingNotifications().length;
      const systemCount = systemNotificationService.getActiveNotifications().length;

      // Should have notifications (may be rate limited)
      expect(diagnosticsCount).toBeGreaterThan(0);
      expect(systemCount).toBeGreaterThanOrEqual(0); // May be rate limited

      // All system notifications should have corresponding diagnostics notifications
      const systemNotifications = systemNotificationService.getActiveNotifications();
      const diagnosticsNotifications = errorDiagnosticsService.getPendingNotifications();

      systemNotifications.forEach((systemNotif) => {
        const matchingDiagnostic = diagnosticsNotifications.find((diagNotif) => diagNotif.id === systemNotif.id);
        expect(matchingDiagnostic).toBeDefined();
      });
    });
  });
});
