/**
 * @file Test suite for diagnostics menu handlers
 */
import { jest } from '@jest/globals';
import {
  createDiagnosticsMenuHandler,
  checkDiagnosticsServiceAvailability,
  handleDiagnosticsMenuClick,
  handleDiagnosticsKeyboardShortcut,
} from '../../../src/main/ui/menu/diagnostics-menu-handlers';

// Mock dependencies
jest.mock('../../../src/main/core/service-registry', () => ({
  getGlobalContext: jest.fn(),
}));

jest.mock('electron', () => ({
  dialog: {
    showErrorBox: jest.fn(),
  },
}));

import { getGlobalContext } from '../../../src/main/core/service-registry';
import { dialog } from 'electron';

interface MockDiagnosticsWindowManager {
  createOrShowWindow: jest.MockedFunction<() => Promise<void>>;
  toggleWindow: jest.MockedFunction<() => void>;
  isWindowOpen: jest.MockedFunction<() => boolean>;
  focusWindow: jest.MockedFunction<() => void>;
}

interface MockContext {
  getService: jest.MockedFunction<(name: string) => MockDiagnosticsWindowManager | null>;
}

describe('Diagnostics Menu Handlers', () => {
  let mockDiagnosticsWindowManager: MockDiagnosticsWindowManager;
  let mockContext: MockContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDiagnosticsWindowManager = {
      createOrShowWindow: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      toggleWindow: jest.fn<() => void>(),
      isWindowOpen: jest.fn<() => boolean>().mockReturnValue(false),
      focusWindow: jest.fn<() => void>(),
    } as MockDiagnosticsWindowManager;

    mockContext = {
      getService: jest.fn().mockReturnValue(mockDiagnosticsWindowManager),
    } as MockContext;

    (getGlobalContext as jest.Mock).mockReturnValue(mockContext);
  });

  describe('checkDiagnosticsServiceAvailability', () => {
    test('should return true when service is available', () => {
      const isAvailable = checkDiagnosticsServiceAvailability();

      expect(isAvailable).toBe(true);
      expect(mockContext.getService).toHaveBeenCalledWith('DiagnosticsWindowManager');
    });

    test('should return false when context is unavailable', () => {
      (getGlobalContext as jest.Mock).mockImplementation(() => {
        throw new Error('Context not available');
      });

      const isAvailable = checkDiagnosticsServiceAvailability();

      expect(isAvailable).toBe(false);
    });

    test('should return false when service is null', () => {
      mockContext.getService.mockReturnValue(null);

      const isAvailable = checkDiagnosticsServiceAvailability();

      expect(isAvailable).toBe(false);
    });

    test('should return false when service is undefined', () => {
      mockContext.getService.mockReturnValue(undefined);

      const isAvailable = checkDiagnosticsServiceAvailability();

      expect(isAvailable).toBe(false);
    });
  });

  describe('handleDiagnosticsMenuClick', () => {
    test('should open diagnostics window successfully', async () => {
      await handleDiagnosticsMenuClick();

      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalled();
      expect(dialog.showErrorBox).not.toHaveBeenCalled();
    });

    test('should handle service unavailable error', async () => {
      mockContext.getService.mockReturnValue(null);

      await handleDiagnosticsMenuClick();

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Diagnostics Unavailable',
        'Website diagnostics service is currently unavailable. Please try restarting the application.'
      );
    });

    test('should handle window creation failure', async () => {
      const error = new Error('Window creation failed');
      mockDiagnosticsWindowManager.createOrShowWindow.mockRejectedValue(error);

      await handleDiagnosticsMenuClick();

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Failed to Open Diagnostics',
        'Could not open diagnostics window: Window creation failed'
      );
    });

    test('should handle context unavailable error', async () => {
      (getGlobalContext as jest.Mock).mockImplementation(() => {
        throw new Error('Context not available');
      });

      await handleDiagnosticsMenuClick();

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Diagnostics Unavailable',
        'Website diagnostics service is currently unavailable. Please try restarting the application.'
      );
    });
  });

  describe('handleDiagnosticsKeyboardShortcut', () => {
    test('should toggle diagnostics window when available', async () => {
      await handleDiagnosticsKeyboardShortcut();

      expect(mockDiagnosticsWindowManager.toggleWindow).toHaveBeenCalled();
      expect(dialog.showErrorBox).not.toHaveBeenCalled();
    });

    test('should show error when service unavailable', async () => {
      mockContext.getService.mockReturnValue(null);

      await handleDiagnosticsKeyboardShortcut();

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Diagnostics Unavailable',
        'Website diagnostics service is currently unavailable. Please try restarting the application.'
      );
    });

    test('should handle toggle operation failure', async () => {
      const error = new Error('Toggle failed');
      mockDiagnosticsWindowManager.toggleWindow.mockImplementation(() => {
        throw error;
      });

      await handleDiagnosticsKeyboardShortcut();

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Diagnostics Error',
        'Could not toggle diagnostics window: Toggle failed'
      );
    });
  });

  describe('createDiagnosticsMenuHandler', () => {
    test('should return handler object with correct methods', () => {
      const handler = createDiagnosticsMenuHandler();

      expect(handler).toHaveProperty('openDiagnostics');
      expect(handler).toHaveProperty('toggleDiagnostics');
      expect(handler).toHaveProperty('isAvailable');
      expect(typeof handler.openDiagnostics).toBe('function');
      expect(typeof handler.toggleDiagnostics).toBe('function');
      expect(typeof handler.isAvailable).toBe('function');
    });

    test('should provide working openDiagnostics method', async () => {
      const handler = createDiagnosticsMenuHandler();

      await handler.openDiagnostics();

      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalled();
    });

    test('should provide working toggleDiagnostics method', async () => {
      const handler = createDiagnosticsMenuHandler();

      await handler.toggleDiagnostics();

      expect(mockDiagnosticsWindowManager.toggleWindow).toHaveBeenCalled();
    });

    test('should provide working isAvailable method', () => {
      const handler = createDiagnosticsMenuHandler();

      const isAvailable = handler.isAvailable();

      expect(isAvailable).toBe(true);
      expect(mockContext.getService).toHaveBeenCalledWith('DiagnosticsWindowManager');
    });
  });

  describe('Error logging', () => {
    test('should log errors for debugging', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Test error');
      mockDiagnosticsWindowManager.createOrShowWindow.mockRejectedValue(error);

      await handleDiagnosticsMenuClick();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to open diagnostics window:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('Service recovery', () => {
    test('should work after service becomes available', async () => {
      // Initially unavailable
      mockContext.getService.mockReturnValue(null);
      expect(checkDiagnosticsServiceAvailability()).toBe(false);

      // Service becomes available
      mockContext.getService.mockReturnValue(mockDiagnosticsWindowManager);
      expect(checkDiagnosticsServiceAvailability()).toBe(true);

      // Should now work
      await handleDiagnosticsMenuClick();
      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalled();
    });
  });

  describe('Concurrent operations', () => {
    test('should handle multiple simultaneous menu clicks', async () => {
      const promises = Array(3)
        .fill(0)
        .map(() => handleDiagnosticsMenuClick());
      await Promise.all(promises);

      // Should call the service multiple times but not fail
      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalledTimes(3);
    });

    test('should handle mixed menu and keyboard operations', async () => {
      await Promise.all([
        handleDiagnosticsMenuClick(),
        handleDiagnosticsKeyboardShortcut(),
        handleDiagnosticsMenuClick(),
      ]);

      expect(mockDiagnosticsWindowManager.createOrShowWindow).toHaveBeenCalledTimes(2);
      expect(mockDiagnosticsWindowManager.toggleWindow).toHaveBeenCalledTimes(1);
    });
  });
});
