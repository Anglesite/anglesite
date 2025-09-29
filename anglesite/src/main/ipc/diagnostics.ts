/**
 * @file IPC handlers for Error Diagnostics UI
 * @description Bridges ErrorDiagnosticsService and DiagnosticsWindowManager with renderer process
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getGlobalContext } from '../core/service-registry';
import { ErrorDiagnosticsService } from '../services/error-diagnostics-service';
import { DiagnosticsWindowManager } from '../ui/diagnostics-window-manager';
import { SystemNotificationService } from '../services/system-notification-service';
import { AngleError } from '../core/errors';
import { logger, sanitize } from '../utils/logging';
import { ErrorFilter, ErrorNotification } from '../services/error-diagnostics-service';
import { ServiceKeys } from '../core/container';
import { ISystemNotificationService } from '../core/interfaces';

// Track subscriptions per window for cleanup
const errorSubscriptions = new Map<number, () => void>();

/**
 * Setup diagnostics IPC handlers
 */
export function setupDiagnosticsHandlers(): void {
  // Error data retrieval
  ipcMain.handle('diagnostics:get-errors', async (event, filter?: ErrorFilter) => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');

      return await diagnosticsService.getFilteredErrors(filter);
    } catch (error) {
      logger.error(`Failed to get filtered errors: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:get-statistics', async (event, filter?: ErrorFilter) => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');

      return await diagnosticsService.getErrorStatistics(filter);
    } catch (error) {
      logger.error(`Failed to get error statistics: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Real-time error subscriptions
  ipcMain.on('diagnostics:subscribe-errors', (event) => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');
      const windowId = event.sender.id;

      // Clean up any existing subscription for this window
      if (errorSubscriptions.has(windowId)) {
        const unsubscribe = errorSubscriptions.get(windowId);
        if (unsubscribe) unsubscribe();
      }

      // Create new subscription
      const unsubscribe = diagnosticsService.subscribeToErrors((error: AngleError) => {
        // Check if window still exists before sending
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window && !window.isDestroyed()) {
          event.sender.send('diagnostics:error-update', error);
        } else {
          // Window is gone, clean up subscription
          if (errorSubscriptions.get(windowId) === unsubscribe) {
            unsubscribe();
            errorSubscriptions.delete(windowId);
          }
        }
      });

      // Store subscription for cleanup
      errorSubscriptions.set(windowId, unsubscribe);

      // Confirm subscription
      event.sender.send('diagnostics:subscription-confirmed', { subscribed: true });

      logger.info(`Window ${windowId} subscribed to error updates`);
    } catch (error) {
      logger.error(`Failed to subscribe to errors: ${sanitize.error(error)}`);
      event.sender.send('diagnostics:subscription-error', { error: sanitize.error(error) });
    }
  });

  ipcMain.on('diagnostics:unsubscribe-errors', (event) => {
    try {
      const windowId = event.sender.id;
      const unsubscribe = errorSubscriptions.get(windowId);

      if (unsubscribe) {
        unsubscribe();
        errorSubscriptions.delete(windowId);
        logger.info(`Window ${windowId} unsubscribed from error updates`);
      }

      event.sender.send('diagnostics:subscription-confirmed', { subscribed: false });
    } catch (error) {
      logger.error(`Failed to unsubscribe from errors: ${sanitize.error(error)}`);
    }
  });

  // Notification management
  ipcMain.handle('diagnostics:get-notifications', async () => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');

      return diagnosticsService.getPendingNotifications();
    } catch (error) {
      logger.error(`Failed to get notifications: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:dismiss-notification', async (event, notificationId: string) => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');

      diagnosticsService.dismissNotification(notificationId);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to dismiss notification: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Error management operations
  ipcMain.handle('diagnostics:clear-errors', async (event, errorIds?: string[]) => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');

      await diagnosticsService.clearErrors(errorIds);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to clear errors: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:export-errors', async (event, filter?: ErrorFilter) => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');

      return await diagnosticsService.exportErrors(filter);
    } catch (error) {
      logger.error(`Failed to export errors: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Window management
  ipcMain.handle('diagnostics:show-window', async () => {
    try {
      const appContext = getGlobalContext();
      const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

      await windowManager.createOrShowWindow();
      return { success: true };
    } catch (error) {
      logger.error(`Failed to show diagnostics window: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:close-window', async () => {
    try {
      const appContext = getGlobalContext();
      const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

      windowManager.closeWindow();
      return { success: true };
    } catch (error) {
      logger.error(`Failed to close diagnostics window: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:toggle-window', async () => {
    try {
      const appContext = getGlobalContext();
      const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

      windowManager.toggleWindow();
      return { success: true };
    } catch (error) {
      logger.error(`Failed to toggle diagnostics window: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:get-window-state', async () => {
    try {
      const appContext = getGlobalContext();
      const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

      return windowManager.getWindowStats();
    } catch (error) {
      logger.error(`Failed to get window state: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Preferences management
  ipcMain.handle('diagnostics:get-preferences', async () => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');
      const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

      return {
        notifications: diagnosticsService.getNotificationPreferences(),
        window: windowManager.getWindowPreferences(),
      };
    } catch (error) {
      logger.error(`Failed to get preferences: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle(
    'diagnostics:set-preferences',
    async (
      event,
      preferences: {
        notifications?: Partial<ReturnType<ErrorDiagnosticsService['getNotificationPreferences']>>;
        window?: Partial<ReturnType<DiagnosticsWindowManager['getWindowPreferences']>>;
      }
    ) => {
      try {
        const appContext = getGlobalContext();
        const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');
        const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

        if (preferences.notifications) {
          diagnosticsService.setNotificationPreferences(preferences.notifications);
        }

        if (preferences.window) {
          windowManager.updateWindowPreferences(preferences.window);
        }

        return { success: true };
      } catch (error) {
        logger.error(`Failed to set preferences: ${sanitize.error(error)}`);
        throw error;
      }
    }
  );

  // Service health
  ipcMain.handle('diagnostics:get-service-health', async () => {
    try {
      const appContext = getGlobalContext();
      const diagnosticsService = appContext.getService<ErrorDiagnosticsService>('ErrorDiagnosticsService');

      return diagnosticsService.getServiceHealth();
    } catch (error) {
      logger.error(`Failed to get service health: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // System notification management
  ipcMain.handle('diagnostics:get-system-notifications', async () => {
    try {
      const appContext = getGlobalContext();
      const systemNotificationService = appContext.getService<ISystemNotificationService>(
        ServiceKeys.SYSTEM_NOTIFICATION
      );

      return systemNotificationService.getActiveNotifications();
    } catch (error) {
      logger.error(`Failed to get system notifications: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:dismiss-system-notification', async (event, notificationId: string) => {
    try {
      const appContext = getGlobalContext();
      const systemNotificationService = appContext.getService<ISystemNotificationService>(
        ServiceKeys.SYSTEM_NOTIFICATION
      );

      await systemNotificationService.dismissSystemNotification(notificationId);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to dismiss system notification: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:dismiss-all-system-notifications', async () => {
    try {
      const appContext = getGlobalContext();
      const systemNotificationService = appContext.getService<ISystemNotificationService>(
        ServiceKeys.SYSTEM_NOTIFICATION
      );

      await systemNotificationService.dismissAllSystemNotifications();
      return { success: true };
    } catch (error) {
      logger.error(`Failed to dismiss all system notifications: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:get-system-notification-preferences', async () => {
    try {
      const appContext = getGlobalContext();
      const systemNotificationService = appContext.getService<ISystemNotificationService>(
        ServiceKeys.SYSTEM_NOTIFICATION
      );

      return systemNotificationService.getNotificationPreferences();
    } catch (error) {
      logger.error(`Failed to get system notification preferences: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:set-system-notification-preferences', async (event, preferences: unknown) => {
    try {
      const appContext = getGlobalContext();
      const systemNotificationService = appContext.getService<ISystemNotificationService>(
        ServiceKeys.SYSTEM_NOTIFICATION
      );

      systemNotificationService.setNotificationPreferences(preferences);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to set system notification preferences: ${sanitize.error(error)}`);
      throw error;
    }
  });

  ipcMain.handle('diagnostics:get-notification-capabilities', async () => {
    try {
      const appContext = getGlobalContext();
      const systemNotificationService = appContext.getService<ISystemNotificationService>(
        ServiceKeys.SYSTEM_NOTIFICATION
      );

      return systemNotificationService.getCapabilities();
    } catch (error) {
      logger.error(`Failed to get notification capabilities: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Handle focus notification request from system notification click
  ipcMain.on('diagnostics:focus-notification', (event, notificationId: string) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window && !window.isDestroyed()) {
        // Send to renderer to focus the specific notification
        event.sender.send('diagnostics:focus-notification', notificationId);
        logger.debug('Focus notification request forwarded to renderer', { notificationId });
      }
    } catch (error) {
      logger.error(`Failed to handle focus notification request: ${sanitize.error(error)}`);
    }
  });

  logger.info('Diagnostics IPC handlers registered');
}

/**
 * Cleanup diagnostics IPC handlers
 */
export function cleanupDiagnosticsHandlers(): void {
  // Unsubscribe all error subscriptions
  errorSubscriptions.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      logger.error(`Error during subscription cleanup: ${sanitize.error(error)}`);
    }
  });
  errorSubscriptions.clear();

  // Remove IPC handlers
  const channels = [
    'diagnostics:get-errors',
    'diagnostics:get-statistics',
    'diagnostics:get-notifications',
    'diagnostics:dismiss-notification',
    'diagnostics:clear-errors',
    'diagnostics:export-errors',
    'diagnostics:show-window',
    'diagnostics:close-window',
    'diagnostics:toggle-window',
    'diagnostics:get-window-state',
    'diagnostics:get-preferences',
    'diagnostics:set-preferences',
    'diagnostics:get-service-health',
    'diagnostics:get-system-notifications',
    'diagnostics:dismiss-system-notification',
    'diagnostics:dismiss-all-system-notifications',
    'diagnostics:get-system-notification-preferences',
    'diagnostics:set-system-notification-preferences',
    'diagnostics:get-notification-capabilities',
  ];

  channels.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  ipcMain.removeAllListeners('diagnostics:subscribe-errors');
  ipcMain.removeAllListeners('diagnostics:unsubscribe-errors');
  ipcMain.removeAllListeners('diagnostics:focus-notification');

  logger.info('Diagnostics IPC handlers cleaned up');
}
