/**
 * @file Basic SystemNotificationService verification test
 * @description Simple test to verify the service can be instantiated and initialized
 */

// Mock Electron completely
jest.mock('electron', () => ({
  Notification: {
    isSupported: jest.fn(() => true),
  },
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

// Mock logger to avoid logging errors during tests
jest.mock('../../src/main/utils/logging', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  sanitize: {
    error: jest.fn((error) => String(error)),
    message: jest.fn((msg) => msg),
    path: jest.fn((path) => path),
  },
}));

import { SystemNotificationService } from '../../src/main/services/system-notification-service';
import { ErrorDiagnosticsService } from '../../src/main/services/error-diagnostics-service';
import { DiagnosticsWindowManager } from '../../src/main/ui/diagnostics-window-manager';
import { IStore } from '../../src/main/core/interfaces';

describe('SystemNotificationService Basic Verification', () => {
  test('should instantiate and initialize without throwing', async () => {
    // Mock platform as macOS
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    // Mock dependencies
    const mockErrorDiagnosticsService = {
      subscribeToErrors: jest.fn(() => jest.fn()),
      getNotificationPreferences: jest.fn(() => ({
        enableCriticalNotifications: true,
        enableHighNotifications: false,
        notificationDuration: 0,
      })),
      getPendingNotifications: jest.fn(() => []),
      dismissNotification: jest.fn(),
    } as any;

    const mockDiagnosticsWindowManager = {
      createOrShowWindow: jest.fn(),
      getWindow: jest.fn(),
    } as any;

    const mockStore = {
      getAll: jest.fn(() => ({})),
      set: jest.fn(),
      setAll: jest.fn(),
    } as any;

    // Create service
    const service = new SystemNotificationService(mockErrorDiagnosticsService, mockDiagnosticsWindowManager, mockStore);

    // Should start as not healthy
    expect(service.isHealthy()).toBe(false);

    // Should initialize without throwing
    const initResult = await service.initialize().catch((error) => {
      console.error('Initialization error:', error);
      throw error;
    });

    console.log('Service initialized, healthy?', service.isHealthy());
    console.log('Service capabilities:', service.getCapabilities());

    // Should be healthy after initialization
    expect(service.isHealthy()).toBe(true);

    // Should have capabilities
    const capabilities = service.getCapabilities();
    expect(capabilities).toHaveProperty('nativeNotifications');
    expect(capabilities).toHaveProperty('badgeCount');
    expect(capabilities).toHaveProperty('clickActions');
    expect(capabilities).toHaveProperty('soundSupport');

    // Should dispose without throwing
    await expect(service.dispose()).resolves.not.toThrow();

    // Should not be healthy after disposal
    expect(service.isHealthy()).toBe(false);
  });
});
