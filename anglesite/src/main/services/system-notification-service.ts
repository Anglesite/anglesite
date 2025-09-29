/**
 * @file SystemNotificationService - Native OS notifications for critical errors
 * @description Manages native system notifications, badges, and coordinates with ErrorDiagnosticsService
 */

import { Notification, app, BrowserWindow, nativeImage } from 'electron';
import * as path from 'path';
import { IDisposable, IInitializable, IStore } from '../core/interfaces';
import { ErrorDiagnosticsService, ErrorNotification } from './error-diagnostics-service';
import { DiagnosticsWindowManager } from '../ui/diagnostics-window-manager';
import { logger, sanitize } from '../utils/logging';
import { AngleError, ErrorSeverity } from '../core/errors';

/**
 * Platform-specific notification capabilities
 */
interface NotificationCapabilities {
  nativeNotifications: boolean;
  badgeCount: boolean;
  clickActions: boolean;
  soundSupport: boolean;
}

/**
 * System notification preferences
 */
export interface SystemNotificationPreferences {
  enableCriticalNotifications: boolean;
  enableHighNotifications: boolean;
  notificationDuration: number; // 0 = no auto-dismiss
  enableSound: boolean;
  enableBadgeCount: boolean;
  maxConcurrentNotifications: number;
}

/**
 * Active system notification tracking
 */
interface SystemNotification {
  id: string;
  electronNotification: Notification;
  errorNotification: ErrorNotification;
  timestamp: Date;
  dismissed: boolean;
}

/**
 * Service for managing native OS notifications for critical errors
 */
export class SystemNotificationService implements IDisposable, IInitializable {
  private initialized = false;
  private capabilities: NotificationCapabilities;
  private activeNotifications = new Map<string, SystemNotification>();
  private errorSubscriptionCleanup?: () => void;
  private badgeUpdateDebounceTimer?: NodeJS.Timeout;

  constructor(
    private errorDiagnosticsService: ErrorDiagnosticsService,
    private diagnosticsWindowManager: DiagnosticsWindowManager,
    private storeService: IStore
  ) {
    this.capabilities = this.detectCapabilities();
  }

  /**
   * Initialize the system notification service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Request notification permissions
      if (this.capabilities.nativeNotifications) {
        await this.requestNotificationPermission();
      }

      // Subscribe to critical error notifications
      this.setupErrorSubscription();

      // Restore badge count from any existing notifications
      this.updateBadgeCount();

      this.initialized = true;
      logger.info('SystemNotificationService initialized', {
        capabilities: this.capabilities,
        platform: process.platform,
      });
    } catch (error) {
      logger.error('Failed to initialize SystemNotificationService', {
        error: sanitize.error(error),
      });
      // Don't throw - service should continue with reduced functionality
    }
  }

  /**
   * Show a critical error as a native system notification
   */
  async showCriticalNotification(notification: ErrorNotification): Promise<void> {
    if (!this.initialized || notification.dismissed) {
      return;
    }

    const preferences = this.getNotificationPreferences();

    // Check if notifications are enabled for this severity
    if (!this.shouldShowNotification(notification.error.severity, preferences)) {
      return;
    }

    // Check for rate limiting
    if (this.activeNotifications.size >= preferences.maxConcurrentNotifications) {
      logger.debug('System notification rate limit exceeded', {
        active: this.activeNotifications.size,
        max: preferences.maxConcurrentNotifications,
      });
      return;
    }

    try {
      // Check for duplicate notifications
      const existingNotification = this.findExistingNotification(notification.error);
      if (existingNotification && !existingNotification.dismissed) {
        logger.debug('Duplicate notification prevented', {
          errorCode: notification.error.code,
          message: sanitize.message(notification.error.message),
        });
        return;
      }

      if (this.capabilities.nativeNotifications) {
        await this.createNativeNotification(notification, preferences);
      }

      // Always update badge count, even if native notifications unavailable
      if (this.capabilities.badgeCount) {
        this.debouncedBadgeUpdate();
      }

      logger.info('System notification created', {
        notificationId: notification.id,
        errorCode: notification.error.code,
        severity: notification.error.severity,
      });
    } catch (error) {
      logger.error('Failed to show system notification', {
        error: sanitize.error(error),
        notificationId: notification.id,
      });
    }
  }

  /**
   * Dismiss a system notification
   */
  async dismissSystemNotification(notificationId: string): Promise<void> {
    const systemNotification = this.activeNotifications.get(notificationId);
    if (!systemNotification || systemNotification.dismissed) {
      return;
    }

    try {
      // Close the native notification
      if (systemNotification.electronNotification) {
        try {
          systemNotification.electronNotification.close();
        } catch (error) {
          // Notification may already be closed/destroyed
          logger.debug('Error closing notification', { error: sanitize.error(error) });
        }
      }

      // Mark as dismissed
      systemNotification.dismissed = true;
      this.activeNotifications.delete(notificationId);

      // Update badge count
      if (this.capabilities.badgeCount) {
        this.debouncedBadgeUpdate();
      }

      // Coordinate with ErrorDiagnosticsService
      this.errorDiagnosticsService.dismissNotification(notificationId);

      logger.debug('System notification dismissed', { notificationId });
    } catch (error) {
      logger.error('Failed to dismiss system notification', {
        error: sanitize.error(error),
        notificationId,
      });
    }
  }

  /**
   * Dismiss all active system notifications
   */
  async dismissAllSystemNotifications(): Promise<void> {
    const activeNotificationIds = Array.from(this.activeNotifications.keys());

    await Promise.all(activeNotificationIds.map((id) => this.dismissSystemNotification(id)));

    logger.info('All system notifications dismissed', {
      count: activeNotificationIds.length,
    });
  }

  /**
   * Update dock/taskbar badge count
   */
  updateBadgeCount(): void {
    if (!this.capabilities.badgeCount) {
      return;
    }

    const pendingCount = this.getPendingNotificationCount();

    try {
      if (process.platform === 'darwin' && app.dock) {
        // macOS dock badge
        app.dock.setBadge(pendingCount > 0 ? pendingCount.toString() : '');
      } else {
        // Windows taskbar, Linux (if supported)
        app.setBadgeCount(pendingCount);
      }

      logger.debug('Badge count updated', { count: pendingCount });
    } catch (error) {
      logger.error('Failed to update badge count', { error: sanitize.error(error) });
    }
  }

  /**
   * Clear badge count
   */
  clearBadgeCount(): void {
    if (!this.capabilities.badgeCount) {
      return;
    }

    try {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge('');
      } else {
        app.setBadgeCount(0);
      }
    } catch (error) {
      logger.error('Failed to clear badge count', { error: sanitize.error(error) });
    }
  }

  /**
   * Get active system notifications
   */
  getActiveNotifications(): SystemNotification[] {
    return Array.from(this.activeNotifications.values())
      .filter((n) => !n.dismissed)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Check if a notification is active
   */
  isNotificationActive(notificationId: string): boolean {
    const notification = this.activeNotifications.get(notificationId);
    return notification !== undefined && !notification.dismissed;
  }

  /**
   * Get notification preferences
   */
  getNotificationPreferences(): SystemNotificationPreferences {
    const diagnosticsPrefs = this.errorDiagnosticsService.getNotificationPreferences();
    const settings = this.storeService.getAll();
    const systemSettings = (settings as any)?.systemNotifications || {};

    return {
      enableCriticalNotifications: diagnosticsPrefs.enableCriticalNotifications,
      enableHighNotifications: diagnosticsPrefs.enableHighNotifications,
      notificationDuration: diagnosticsPrefs.notificationDuration,
      enableSound: systemSettings.enableSound ?? true,
      enableBadgeCount: systemSettings.enableBadgeCount ?? true,
      maxConcurrentNotifications: systemSettings.maxConcurrentNotifications ?? 5,
    };
  }

  /**
   * Set system notification preferences
   */
  setNotificationPreferences(prefs: Partial<SystemNotificationPreferences>): void {
    // Update ErrorDiagnosticsService preferences
    if (
      prefs.enableCriticalNotifications !== undefined ||
      prefs.enableHighNotifications !== undefined ||
      prefs.notificationDuration !== undefined
    ) {
      this.errorDiagnosticsService.setNotificationPreferences({
        enableCriticalNotifications: prefs.enableCriticalNotifications,
        enableHighNotifications: prefs.enableHighNotifications,
        notificationDuration: prefs.notificationDuration,
      });
    }

    // Update system-specific preferences
    const settings = this.storeService.getAll();
    const updatedSettings = {
      ...settings,
      systemNotifications: {
        ...(settings as any)?.systemNotifications,
        enableSound: prefs.enableSound,
        enableBadgeCount: prefs.enableBadgeCount,
        maxConcurrentNotifications: prefs.maxConcurrentNotifications,
      },
    };

    this.storeService.setAll(updatedSettings as any);

    // Update badge count visibility immediately
    if (prefs.enableBadgeCount === false) {
      this.clearBadgeCount();
    } else if (prefs.enableBadgeCount === true) {
      this.updateBadgeCount();
    }
  }

  /**
   * Get service capabilities
   */
  getCapabilities(): NotificationCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Check if the service is healthy
   */
  isHealthy(): boolean {
    return this.initialized;
  }

  /**
   * Dispose of the service
   */
  async dispose(): Promise<void> {
    try {
      // Clean up error subscription
      if (this.errorSubscriptionCleanup) {
        this.errorSubscriptionCleanup();
        this.errorSubscriptionCleanup = undefined;
      }

      // Clear badge update timer
      if (this.badgeUpdateDebounceTimer) {
        clearTimeout(this.badgeUpdateDebounceTimer);
        this.badgeUpdateDebounceTimer = undefined;
      }

      // Close all active notifications
      await this.dismissAllSystemNotifications();

      // Clear badge count
      this.clearBadgeCount();

      this.initialized = false;
      logger.info('SystemNotificationService disposed');
    } catch (error) {
      logger.error('Failed to dispose SystemNotificationService', {
        error: sanitize.error(error),
      });
    }
  }

  /**
   * Detect platform notification capabilities
   */
  private detectCapabilities(): NotificationCapabilities {
    const isSupported = Notification.isSupported();
    const hasDockAPI = process.platform === 'darwin' && !!app.dock;
    const hasBadgeAPI = hasDockAPI || process.platform === 'win32';

    return {
      nativeNotifications: isSupported,
      badgeCount: hasBadgeAPI,
      clickActions: isSupported,
      soundSupport: isSupported && process.platform !== 'linux', // Linux notification sound is inconsistent
    };
  }

  /**
   * Request notification permission from OS
   */
  private async requestNotificationPermission(): Promise<void> {
    try {
      // In Electron main process, notifications don't require explicit permission requests
      // The OS will show permission dialogs automatically when needed
      logger.debug('Notification permissions handled by OS');
    } catch (error) {
      logger.error('Failed to request notification permission', {
        error: sanitize.error(error),
      });
      this.capabilities.nativeNotifications = false;
    }
  }

  /**
   * Setup subscription to ErrorDiagnosticsService critical notifications
   */
  private setupErrorSubscription(): void {
    this.errorSubscriptionCleanup = this.errorDiagnosticsService.subscribeToErrors((error: AngleError) => {
      // Only handle critical errors for system notifications
      if (error.severity === ErrorSeverity.CRITICAL) {
        const pendingNotifications = this.errorDiagnosticsService.getPendingNotifications();
        const relatedNotification = pendingNotifications.find(
          (n) => n.error.code === error.code && n.error.message === error.message && !n.dismissed
        );

        if (relatedNotification) {
          this.showCriticalNotification(relatedNotification).catch((err) => {
            logger.error('Failed to show notification from error subscription', {
              error: sanitize.error(err),
            });
          });
        }
      }
    });
  }

  /**
   * Create native Electron notification
   */
  private async createNativeNotification(
    notification: ErrorNotification,
    preferences: SystemNotificationPreferences
  ): Promise<void> {
    const error = notification.error;

    // Truncate message for notification display
    const maxLength = process.platform === 'darwin' ? 256 : 200;
    const message =
      error.message.length > maxLength ? `${error.message.substring(0, maxLength - 3)}...` : error.message;

    const electronNotification = new Notification({
      title: 'Anglesite - Critical Error',
      body: message,
      silent: !preferences.enableSound || !this.capabilities.soundSupport,
      timeoutType: preferences.notificationDuration > 0 ? 'default' : 'never',
      actions: this.capabilities.clickActions
        ? [
            { type: 'button', text: 'View Details' },
            { type: 'button', text: 'Dismiss' },
          ]
        : [],
      icon: this.getNotificationIcon(),
    });

    // Handle notification click
    electronNotification.on('click', () => {
      this.handleNotificationClick(notification.id).catch((err) => {
        logger.error('Failed to handle notification click', { error: sanitize.error(err) });
      });
    });

    // Handle notification actions
    electronNotification.on('action', (event, index) => {
      if (index === 0) {
        // View Details
        this.handleNotificationClick(notification.id);
      } else if (index === 1) {
        // Dismiss
        this.dismissSystemNotification(notification.id);
      }
    });

    // Handle notification close
    electronNotification.on('close', () => {
      this.activeNotifications.delete(notification.id);
    });

    // Auto-dismiss if configured
    if (preferences.notificationDuration > 0) {
      setTimeout(() => {
        this.dismissSystemNotification(notification.id);
      }, preferences.notificationDuration);
    }

    // Show the notification
    electronNotification.show();

    // Track the notification
    const systemNotification: SystemNotification = {
      id: notification.id,
      electronNotification,
      errorNotification: notification,
      timestamp: new Date(),
      dismissed: false,
    };

    this.activeNotifications.set(notification.id, systemNotification);
  }

  /**
   * Handle notification click action
   */
  private async handleNotificationClick(notificationId: string): Promise<void> {
    try {
      // Open or focus the diagnostics window
      await this.diagnosticsWindowManager.createOrShowWindow();

      // Focus the specific error in the diagnostics window
      const window = this.diagnosticsWindowManager.getWindow();
      if (window) {
        window.webContents.send('diagnostics:focus-notification', notificationId);
      }

      logger.debug('Notification clicked, diagnostics window opened', { notificationId });
    } catch (error) {
      logger.error('Failed to handle notification click', {
        error: sanitize.error(error),
        notificationId,
      });
    }
  }

  /**
   * Get notification icon path
   */
  private getNotificationIcon(): string {
    try {
      // Use a simple path to icon - Electron will handle loading
      const iconPath = path.join(__dirname, '../../assets/notification-icon.png');
      return iconPath;
    } catch {
      // Fallback to empty string
      return '';
    }
  }

  /**
   * Check if notification should be shown for given severity
   */
  private shouldShowNotification(severity: ErrorSeverity, preferences: SystemNotificationPreferences): boolean {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return preferences.enableCriticalNotifications;
      case ErrorSeverity.HIGH:
        return preferences.enableHighNotifications;
      default:
        return false;
    }
  }

  /**
   * Find existing notification for the same error
   */
  private findExistingNotification(error: AngleError): SystemNotification | undefined {
    return Array.from(this.activeNotifications.values()).find(
      (notification) =>
        notification.errorNotification.error.code === error.code &&
        notification.errorNotification.error.message === error.message &&
        !notification.dismissed
    );
  }

  /**
   * Get count of pending notifications
   */
  private getPendingNotificationCount(): number {
    // Count both active system notifications and pending notifications from diagnostics service
    const activeSystemCount = this.getActiveNotifications().length;
    const pendingDiagnosticsCount = this.errorDiagnosticsService.getPendingNotifications().length;

    // Return the maximum to ensure badge count reflects all pending notifications
    return Math.max(activeSystemCount, pendingDiagnosticsCount);
  }

  /**
   * Debounced badge count update to prevent excessive OS API calls
   */
  private debouncedBadgeUpdate(): void {
    if (this.badgeUpdateDebounceTimer) {
      clearTimeout(this.badgeUpdateDebounceTimer);
    }

    this.badgeUpdateDebounceTimer = setTimeout(() => {
      this.updateBadgeCount();
    }, 1000); // 1 second debounce
  }
}
