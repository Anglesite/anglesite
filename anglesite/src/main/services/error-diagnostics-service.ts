/**
 * @file ErrorDiagnosticsService - Core service for error diagnostics UI
 * @description Manages error data, filtering, statistics, and real-time updates for the diagnostics interface
 */
import { AngleError, ErrorSeverity, ErrorCategory } from '../core/errors';
import { IErrorReportingService, IStore } from '../core/interfaces';
// Simple UUID alternative for generating notification IDs
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Filter criteria for error queries
 */
export interface ErrorFilter {
  severity?: ErrorSeverity[];
  category?: ErrorCategory[];
  dateRange?: { start: Date; end: Date };
  searchText?: string;
}

/**
 * Error statistics aggregation
 */
export interface ErrorStatistics {
  total: number;
  bySeverity: Record<ErrorSeverity, number>;
  byCategory: Record<ErrorCategory, number>;
  hourlyTrends: Array<{ timestamp: Date; count: number }>;
}

/**
 * Critical error notification
 */
export interface ErrorNotification {
  id: string;
  error: AngleError;
  timestamp: Date;
  dismissed: boolean;
}

/**
 * Error diagnostics service for managing diagnostic UI data and operations
 */
export class ErrorDiagnosticsService {
  private errorSubscriptions: Set<(error: AngleError) => void> = new Set();
  private criticalNotifications: Map<string, ErrorNotification> = new Map();

  constructor(
    private errorReportingService: IErrorReportingService,
    private storeService: IStore
  ) {
    this.setupErrorSubscription();
  }

  /**
   * Setup subscription to error reporting service for real-time updates
   * Note: Using polling approach since the current interface doesn't support subscriptions
   */
  private setupErrorSubscription(): void {
    // Start polling for new errors every 5 seconds
    setInterval(async () => {
      try {
        const recentErrors = await this.errorReportingService.getRecentErrors(10);

        // Process recent errors and notify subscribers
        recentErrors.forEach((errorData) => {
          // Convert to AngleError if needed
          const error = errorData instanceof AngleError ? errorData : this.convertToAngleError(errorData);

          if (error) {
            this.errorSubscriptions.forEach((callback) => {
              callback(error);
            });

            // Handle critical error notifications
            if (error.severity === ErrorSeverity.CRITICAL) {
              this.addCriticalNotification(error);
            }
          }
        });
      } catch (error) {
        // Silently handle polling errors to avoid disrupting the app
      }
    }, 5000);
  }

  /**
   * Convert unknown error data to AngleError
   */
  private convertToAngleError(errorData: unknown): AngleError | null {
    try {
      if (errorData && typeof errorData === 'object') {
        const data = errorData as any;
        return new AngleError(
          data.message || 'Unknown error',
          data.code || 'UNKNOWN_ERROR',
          data.category || ErrorCategory.SYSTEM,
          data.severity || ErrorSeverity.MEDIUM,
          data.metadata || {}
        );
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get filtered errors based on criteria
   */
  async getFilteredErrors(filter?: ErrorFilter): Promise<AngleError[]> {
    // Get errors using the available interface method
    const recentErrors = await this.errorReportingService.getRecentErrors();

    // Convert to AngleError array
    const allErrors: AngleError[] = recentErrors
      .map((errorData) => (errorData instanceof AngleError ? errorData : this.convertToAngleError(errorData)))
      .filter((error): error is AngleError => error !== null);

    if (!filter) {
      return allErrors;
    }

    return allErrors.filter((error) => {
      // Filter by severity
      if (filter.severity?.length && !filter.severity.includes(error.severity)) {
        return false;
      }

      // Filter by category
      if (filter.category?.length && !filter.category.includes(error.category)) {
        return false;
      }

      // Filter by date range
      if (filter.dateRange) {
        const errorTime = error.timestamp.getTime();
        const startTime = filter.dateRange.start.getTime();
        const endTime = filter.dateRange.end.getTime();

        if (errorTime < startTime || errorTime > endTime) {
          return false;
        }
      }

      // Filter by search text
      if (filter.searchText) {
        const searchText = filter.searchText.toLowerCase();
        const searchableText = [
          error.message,
          error.code,
          error.metadata.operation,
          JSON.stringify(error.metadata.context),
        ]
          .join(' ')
          .toLowerCase();

        if (!searchableText.includes(searchText)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get error statistics and trends
   */
  async getErrorStatistics(filter?: ErrorFilter): Promise<ErrorStatistics> {
    const errors = await this.getFilteredErrors(filter);

    // Initialize statistics
    const stats: ErrorStatistics = {
      total: errors.length,
      bySeverity: {
        [ErrorSeverity.LOW]: 0,
        [ErrorSeverity.MEDIUM]: 0,
        [ErrorSeverity.HIGH]: 0,
        [ErrorSeverity.CRITICAL]: 0,
      },
      byCategory: {
        [ErrorCategory.SYSTEM]: 0,
        [ErrorCategory.NETWORK]: 0,
        [ErrorCategory.FILE_SYSTEM]: 0,
        [ErrorCategory.BUSINESS_LOGIC]: 0,
        [ErrorCategory.VALIDATION]: 0,
        [ErrorCategory.ATOMIC_OPERATION]: 0,
        [ErrorCategory.SECURITY]: 0,
        [ErrorCategory.USER_INPUT]: 0,
        [ErrorCategory.SERVICE_MANAGEMENT]: 0,
        [ErrorCategory.IPC_COMMUNICATION]: 0,
        [ErrorCategory.UI_COMPONENT]: 0,
        [ErrorCategory.FILE_OPERATION]: 0,
        [ErrorCategory.WEBSITE_MANAGEMENT]: 0,
        [ErrorCategory.EXPORT_OPERATION]: 0,
      },
      hourlyTrends: [],
    };

    // Count by severity and category
    errors.forEach((error) => {
      stats.bySeverity[error.severity]++;
      stats.byCategory[error.category]++;
    });

    // Generate hourly trends for last 24 hours
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now);
      hourStart.setHours(now.getHours() - i, 0, 0, 0);

      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourStart.getHours() + 1);

      const hourErrors = errors.filter((error) => error.timestamp >= hourStart && error.timestamp < hourEnd);

      stats.hourlyTrends.push({
        timestamp: hourStart,
        count: hourErrors.length,
      });
    }

    return stats;
  }

  /**
   * Subscribe to real-time error updates
   */
  subscribeToErrors(callback: (error: AngleError) => void): () => void {
    this.errorSubscriptions.add(callback);

    return () => {
      this.errorSubscriptions.delete(callback);
    };
  }

  /**
   * Add a critical error notification
   */
  addCriticalNotification(error: AngleError): void {
    // Check for duplicate notifications (same error code and message)
    const existingNotification = Array.from(this.criticalNotifications.values()).find(
      (notification) =>
        notification.error.code === error.code &&
        notification.error.message === error.message &&
        !notification.dismissed
    );

    if (existingNotification) {
      return; // Don't create duplicate notifications
    }

    const notification: ErrorNotification = {
      id: generateId(),
      error,
      timestamp: new Date(),
      dismissed: false,
    };

    this.criticalNotifications.set(notification.id, notification);

    // Store notification preferences
    this.updateNotificationPreferences();
  }

  /**
   * Get pending (undismissed) notifications
   */
  getPendingNotifications(): ErrorNotification[] {
    return Array.from(this.criticalNotifications.values())
      .filter((notification) => !notification.dismissed)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Dismiss a notification
   */
  dismissNotification(notificationId: string): void {
    const notification = this.criticalNotifications.get(notificationId);
    if (notification) {
      notification.dismissed = true;
      this.updateNotificationPreferences();
    }
  }

  /**
   * Clear errors from the system
   */
  async clearErrors(errorIds?: string[]): Promise<void> {
    // Use the available clearHistory method
    await this.errorReportingService.clearHistory();

    // Clear related notifications
    if (errorIds) {
      this.criticalNotifications.forEach((notification, id) => {
        if (errorIds.includes(notification.error.code)) {
          this.criticalNotifications.delete(id);
        }
      });
    } else {
      // Clear all notifications if all errors are cleared
      this.criticalNotifications.clear();
    }

    this.updateNotificationPreferences();
  }

  /**
   * Export filtered errors
   */
  async exportErrors(filter?: ErrorFilter): Promise<string> {
    const filteredErrors = await this.getFilteredErrors(filter);

    // Create a temporary file path for export
    const path = require('path');
    const os = require('os');
    const fs = require('fs').promises;

    const exportPath = path.join(os.tmpdir(), `error-export-${Date.now()}.json`);

    // Export filtered errors to the file
    const exportData = filteredErrors.map((error) => ({
      timestamp: error.timestamp,
      severity: error.severity,
      category: error.category,
      code: error.code,
      message: error.message,
      metadata: error.metadata,
      stack: error.stack,
    }));

    await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
    return exportPath;
  }

  /**
   * Get notification preferences from store
   */
  getNotificationPreferences(): {
    enableCriticalNotifications: boolean;
    enableHighNotifications: boolean;
    notificationDuration: number;
  } {
    // Use a simple approach with a generic store interface
    const settings = this.storeService.getAll();
    const diagnosticsSettings = (settings as any)?.diagnostics?.notifications || {};

    return {
      enableCriticalNotifications: diagnosticsSettings.enableCriticalNotifications ?? true,
      enableHighNotifications: diagnosticsSettings.enableHighNotifications ?? false,
      notificationDuration: diagnosticsSettings.notificationDuration ?? 0,
    };
  }

  /**
   * Update notification preferences in store
   */
  setNotificationPreferences(preferences: {
    enableCriticalNotifications?: boolean;
    enableHighNotifications?: boolean;
    notificationDuration?: number;
  }): void {
    const current = this.getNotificationPreferences();
    const settings = this.storeService.getAll();

    const updatedSettings = {
      ...settings,
      diagnostics: {
        ...(settings as any)?.diagnostics,
        notifications: {
          ...current,
          ...preferences,
        },
      },
    };

    this.storeService.setAll(updatedSettings as any);
  }

  /**
   * Update notification state in store
   */
  private updateNotificationPreferences(): void {
    const dismissedNotifications = Array.from(this.criticalNotifications.values())
      .filter((n) => n.dismissed)
      .map((n) => ({ id: n.id, errorCode: n.error.code, timestamp: n.timestamp }));

    const settings = this.storeService.getAll();
    const updatedSettings = {
      ...settings,
      diagnostics: {
        ...(settings as any)?.diagnostics,
        dismissedNotifications,
      },
    };

    this.storeService.setAll(updatedSettings as any);
  }

  /**
   * Load previously dismissed notifications from store
   */
  private loadDismissedNotifications(): void {
    const settings = this.storeService.getAll();
    const dismissed = (settings as any)?.diagnostics?.dismissedNotifications || [];

    // Mark notifications as dismissed if they were previously dismissed
    dismissed.forEach((dismissedNotif: any) => {
      const notification = Array.from(this.criticalNotifications.values()).find(
        (n) => n.error.code === dismissedNotif.errorCode
      );

      if (notification) {
        notification.dismissed = true;
      }
    });
  }

  /**
   * Get service health information
   */
  getServiceHealth(): {
    isHealthy: boolean;
    errorReportingConnected: boolean;
    activeSubscriptions: number;
    pendingNotifications: number;
  } {
    return {
      isHealthy: true,
      errorReportingConnected: !!this.errorReportingService,
      activeSubscriptions: this.errorSubscriptions.size,
      pendingNotifications: this.getPendingNotifications().length,
    };
  }
}
