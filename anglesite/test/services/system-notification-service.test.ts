/**
 * @file SystemNotificationService unit tests
 * @description Comprehensive tests for native OS notification functionality
 */

import { Notification, app } from 'electron';
import {
  SystemNotificationService,
  SystemNotificationPreferences,
} from '../../src/main/services/system-notification-service';
import { ErrorDiagnosticsService, ErrorNotification } from '../../src/main/services/error-diagnostics-service';
import { DiagnosticsWindowManager } from '../../src/main/ui/diagnostics-window-manager';
import { AngleError, ErrorSeverity, ErrorCategory } from '../../src/main/core/errors';
import { IStore } from '../../src/main/core/interfaces';

// Mock Electron modules
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
    getVersion: jest.fn(() => '1.0.0'),
  },
  nativeImage: {
    createFromPath: jest.fn(() => 'mock-icon'),
  },
}));

// Mock services
const mockErrorDiagnosticsService = {
  subscribeToErrors: jest.fn(() => jest.fn()), // Returns unsubscribe function
  dismissNotification: jest.fn(),
  getPendingNotifications: jest.fn(() => []),
  getNotificationPreferences: jest.fn(() => ({
    enableCriticalNotifications: true,
    enableHighNotifications: false,
    notificationDuration: 0,
  })),
  setNotificationPreferences: jest.fn(),
} as jest.Mocked<ErrorDiagnosticsService>;

const mockDiagnosticsWindowManager = {
  createOrShowWindow: jest.fn(),
  getWindow: jest.fn(() => ({
    webContents: {
      send: jest.fn(),
    },
  })),
} as jest.Mocked<DiagnosticsWindowManager>;

const mockStore = {
  getAll: jest.fn(() => ({})),
  setAll: jest.fn(),
} as jest.Mocked<IStore>;

describe('SystemNotificationService', () => {
  let systemNotificationService: SystemNotificationService;
  let mockNotification: jest.Mocked<Notification>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Notification mock
    mockNotification = {
      on: jest.fn(),
      show: jest.fn(),
      close: jest.fn(),
      isDestroyed: jest.fn(() => false),
    } as any;
    (Notification as jest.Mock).mockImplementation(() => mockNotification);

    // Mock platform detection
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    // Create service instance
    systemNotificationService = new SystemNotificationService(
      mockErrorDiagnosticsService as any,
      mockDiagnosticsWindowManager as any,
      mockStore
    );
  });

  describe('Initialization', () => {
    test('should initialize successfully and setup error subscription', async () => {
      // Mock notification support
      (Notification.isSupported as jest.Mock) = jest.fn(() => true);
      (Notification.requestPermission as jest.Mock) = jest.fn().mockResolvedValue('granted');

      await systemNotificationService.initialize();

      expect(mockErrorDiagnosticsService.subscribeToErrors).toHaveBeenCalled();
      expect(systemNotificationService.isHealthy()).toBe(true);
    });

    test('should handle initialization failure gracefully', async () => {
      (Notification.isSupported as jest.Mock) = jest.fn(() => false);

      await systemNotificationService.initialize();

      // Should not throw and service should still be healthy
      expect(systemNotificationService.isHealthy()).toBe(true);
      const capabilities = systemNotificationService.getCapabilities();
      expect(capabilities.nativeNotifications).toBe(false);
    });

    test('should detect platform capabilities correctly', async () => {
      // Test macOS capabilities
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      await systemNotificationService.initialize();
      const capabilities = systemNotificationService.getCapabilities();

      expect(capabilities.badgeCount).toBe(true);
    });
  });

  describe('Notification Creation', () => {
    beforeEach(async () => {
      (Notification.isSupported as jest.Mock) = jest.fn(() => true);
      (Notification.requestPermission as jest.Mock) = jest.fn().mockResolvedValue('granted');
      await systemNotificationService.initialize();
    });

    test('should create native notification for critical error', async () => {
      const criticalError = new AngleError(
        'Database connection failed',
        'DB_CONNECTION_ERROR',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL
      );

      const notification: ErrorNotification = {
        id: 'test-notification-1',
        error: criticalError,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      expect(Notification).toHaveBeenCalledWith({
        title: 'Anglesite - Critical Error',
        body: 'Database connection failed',
        silent: false,
        timeoutType: 'never',
        actions: [
          { type: 'button', text: 'View Details' },
          { type: 'button', text: 'Dismiss' },
        ],
        icon: 'mock-icon',
      });

      expect(mockNotification.show).toHaveBeenCalled();
      expect(app.dock?.setBadge).toHaveBeenCalledWith('1');
    });

    test('should truncate long error messages for notification display', async () => {
      const longMessage = 'A'.repeat(300); // 300 character message
      const longError = new AngleError(longMessage, 'LONG_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification: ErrorNotification = {
        id: 'test-long-notification',
        error: longError,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringMatching(/\.{3}$/), // Should end with ellipsis
        })
      );
    });

    test('should respect notification preferences', async () => {
      // Disable critical notifications
      mockErrorDiagnosticsService.getNotificationPreferences.mockReturnValue({
        enableCriticalNotifications: false,
        enableHighNotifications: false,
        notificationDuration: 0,
      });

      const criticalError = new AngleError(
        'Critical error',
        'CRITICAL_ERROR',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL
      );

      const notification: ErrorNotification = {
        id: 'test-disabled-notification',
        error: criticalError,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      expect(Notification).not.toHaveBeenCalled();
    });

    test('should prevent duplicate notifications', async () => {
      const error = new AngleError('Duplicate error', 'DUP_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification1: ErrorNotification = {
        id: 'test-dup-1',
        error,
        timestamp: new Date(),
        dismissed: false,
      };

      const notification2: ErrorNotification = {
        id: 'test-dup-2',
        error, // Same error
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification1);
      await systemNotificationService.showCriticalNotification(notification2);

      // Should only create one notification
      expect(Notification).toHaveBeenCalledTimes(1);
    });

    test('should respect rate limiting', async () => {
      // Mock preferences with low concurrent limit
      mockStore.getAll.mockReturnValue({
        systemNotifications: {
          maxConcurrentNotifications: 2,
        },
      });

      // Create multiple notifications
      for (let i = 0; i < 5; i++) {
        const error = new AngleError(`Error ${i}`, `ERROR_${i}`, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

        const notification: ErrorNotification = {
          id: `test-rate-${i}`,
          error,
          timestamp: new Date(),
          dismissed: false,
        };

        await systemNotificationService.showCriticalNotification(notification);
      }

      // Should only create 2 notifications due to rate limiting
      expect(Notification).toHaveBeenCalledTimes(2);
    });
  });

  describe('Notification Dismissal', () => {
    beforeEach(async () => {
      (Notification.isSupported as jest.Mock) = jest.fn(() => true);
      await systemNotificationService.initialize();
    });

    test('should dismiss individual system notification', async () => {
      // Create a notification first
      const error = new AngleError('Test error', 'TEST_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification: ErrorNotification = {
        id: 'test-dismiss-1',
        error,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      // Now dismiss it
      await systemNotificationService.dismissSystemNotification('test-dismiss-1');

      expect(mockNotification.close).toHaveBeenCalled();
      expect(mockErrorDiagnosticsService.dismissNotification).toHaveBeenCalledWith('test-dismiss-1');
      expect(app.dock?.setBadge).toHaveBeenCalledWith(''); // Badge should be cleared
    });

    test('should dismiss all system notifications', async () => {
      // Create multiple notifications
      for (let i = 0; i < 3; i++) {
        const error = new AngleError(`Error ${i}`, `ERROR_${i}`, ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

        const notification: ErrorNotification = {
          id: `test-dismiss-all-${i}`,
          error,
          timestamp: new Date(),
          dismissed: false,
        };

        await systemNotificationService.showCriticalNotification(notification);
      }

      await systemNotificationService.dismissAllSystemNotifications();

      expect(mockNotification.close).toHaveBeenCalledTimes(3);
      expect(app.dock?.setBadge).toHaveBeenCalledWith('');
    });
  });

  describe('Badge Management', () => {
    beforeEach(async () => {
      await systemNotificationService.initialize();
    });

    test('should update badge count based on active notifications', () => {
      systemNotificationService.updateBadgeCount();
      expect(app.dock?.setBadge).toHaveBeenCalled();
    });

    test('should clear badge count when no notifications', () => {
      systemNotificationService.clearBadgeCount();
      expect(app.dock?.setBadge).toHaveBeenCalledWith('');
    });

    test('should handle badge API unavailable gracefully', () => {
      // Mock dock API as unavailable
      (app as any).dock = undefined;

      expect(() => systemNotificationService.updateBadgeCount()).not.toThrow();
      expect(app.setBadgeCount).toHaveBeenCalled();
    });
  });

  describe('Notification Click Handling', () => {
    beforeEach(async () => {
      (Notification.isSupported as jest.Mock) = jest.fn(() => true);
      await systemNotificationService.initialize();
    });

    test('should handle notification click by opening diagnostics window', async () => {
      const error = new AngleError('Click test error', 'CLICK_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification: ErrorNotification = {
        id: 'test-click-1',
        error,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      // Simulate notification click
      const clickHandler = mockNotification.on.mock.calls.find((call) => call[0] === 'click')?.[1];
      expect(clickHandler).toBeDefined();

      await clickHandler();

      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalled();
    });

    test('should handle notification action buttons', async () => {
      const error = new AngleError('Action test error', 'ACTION_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification: ErrorNotification = {
        id: 'test-action-1',
        error,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      // Simulate action button click (View Details = index 0, Dismiss = index 1)
      const actionHandler = mockNotification.on.mock.calls.find((call) => call[0] === 'action')?.[1];
      expect(actionHandler).toBeDefined();

      // Test "View Details" action
      await actionHandler({}, 0);
      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalled();

      // Test "Dismiss" action
      await actionHandler({}, 1);
      expect(mockNotification.close).toHaveBeenCalled();
    });
  });

  describe('Preferences Management', () => {
    beforeEach(async () => {
      await systemNotificationService.initialize();
    });

    test('should get notification preferences', () => {
      const preferences = systemNotificationService.getNotificationPreferences();

      expect(preferences).toEqual({
        enableCriticalNotifications: true,
        enableHighNotifications: false,
        notificationDuration: 0,
        enableSound: true,
        enableBadgeCount: true,
        maxConcurrentNotifications: 5,
      });
    });

    test('should set notification preferences', () => {
      const newPreferences: Partial<SystemNotificationPreferences> = {
        enableSound: false,
        maxConcurrentNotifications: 10,
      };

      systemNotificationService.setNotificationPreferences(newPreferences);

      expect(mockStore.setAll).toHaveBeenCalledWith(
        expect.objectContaining({
          systemNotifications: expect.objectContaining({
            enableSound: false,
            maxConcurrentNotifications: 10,
          }),
        })
      );
    });

    test('should disable badge count when preference is disabled', () => {
      systemNotificationService.setNotificationPreferences({
        enableBadgeCount: false,
      });

      expect(app.dock?.setBadge).toHaveBeenCalledWith('');
    });
  });

  describe('Cross-Platform Compatibility', () => {
    test('should detect Windows capabilities correctly', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const service = new SystemNotificationService(
        mockErrorDiagnosticsService as any,
        mockDiagnosticsWindowManager as any,
        mockStore
      );

      await service.initialize();
      const capabilities = service.getCapabilities();

      expect(capabilities.badgeCount).toBe(true); // Windows supports setBadgeCount
    });

    test('should detect Linux capabilities correctly', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const service = new SystemNotificationService(
        mockErrorDiagnosticsService as any,
        mockDiagnosticsWindowManager as any,
        mockStore
      );

      await service.initialize();
      const capabilities = service.getCapabilities();

      expect(capabilities.badgeCount).toBe(false); // Linux typically doesn't support badges
      expect(capabilities.soundSupport).toBe(false); // Linux sound is inconsistent
    });
  });

  describe('Error Handling', () => {
    test('should handle notification creation errors gracefully', async () => {
      (Notification.isSupported as jest.Mock) = jest.fn(() => true);
      await systemNotificationService.initialize();

      // Mock notification constructor to throw
      (Notification as jest.Mock).mockImplementation(() => {
        throw new Error('Notification creation failed');
      });

      const error = new AngleError('Test error', 'TEST_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification: ErrorNotification = {
        id: 'test-error-1',
        error,
        timestamp: new Date(),
        dismissed: false,
      };

      // Should not throw
      await expect(systemNotificationService.showCriticalNotification(notification)).resolves.not.toThrow();
    });

    test('should handle service disposal gracefully', async () => {
      await systemNotificationService.initialize();

      // Create some notifications
      const error = new AngleError('Disposal test', 'DISPOSAL_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification: ErrorNotification = {
        id: 'test-disposal-1',
        error,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      // Dispose should clean up everything
      await systemNotificationService.dispose();

      expect(mockNotification.close).toHaveBeenCalled();
      expect(app.dock?.setBadge).toHaveBeenCalledWith('');
      expect(systemNotificationService.isHealthy()).toBe(false);
    });
  });

  describe('Service Health', () => {
    test('should report healthy status when initialized', async () => {
      await systemNotificationService.initialize();
      expect(systemNotificationService.isHealthy()).toBe(true);
    });

    test('should report unhealthy status when not initialized', () => {
      expect(systemNotificationService.isHealthy()).toBe(false);
    });

    test('should maintain health status after errors', async () => {
      await systemNotificationService.initialize();

      // Simulate error in notification creation
      (Notification as jest.Mock).mockImplementation(() => {
        throw new Error('Mock error');
      });

      const error = new AngleError('Health test error', 'HEALTH_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.CRITICAL);

      const notification: ErrorNotification = {
        id: 'test-health-1',
        error,
        timestamp: new Date(),
        dismissed: false,
      };

      await systemNotificationService.showCriticalNotification(notification);

      // Service should remain healthy even after individual errors
      expect(systemNotificationService.isHealthy()).toBe(true);
    });
  });
});
