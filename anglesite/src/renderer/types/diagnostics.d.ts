/**
 * @file TypeScript declarations for Diagnostics API
 * @description Type definitions for the diagnostics API exposed through contextBridge
 */

// Error filter types
export interface ErrorFilter {
  severity?: string[];
  category?: string[];
  dateRange?: { start: Date; end: Date };
  searchText?: string;
}

// Error statistics types
export interface ErrorStatistics {
  total: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  hourlyTrends: Array<{ timestamp: Date; count: number }>;
}

// Error notification types
export interface ErrorNotification {
  id: string;
  error: {
    message: string;
    code: string;
    category: string;
    severity: string;
    timestamp: Date;
    stack?: string;
  };
  timestamp: Date;
  dismissed: boolean;
}

// Window state types
export interface WindowState {
  isOpen: boolean;
  isVisible: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  preferences: Record<string, unknown>;
}

// Preferences types
export interface DiagnosticsPreferences {
  notifications: {
    enableCriticalNotifications: boolean;
    enableHighNotifications: boolean;
    notificationDuration: number;
  };
  window: Record<string, unknown>;
}

// Service health types
export interface ServiceHealth {
  isHealthy: boolean;
  errorReportingConnected: boolean;
  activeSubscriptions: number;
  pendingNotifications: number;
}

// Diagnostics API interface
export interface DiagnosticsAPI {
  // Error data retrieval
  getErrors(filter?: ErrorFilter): Promise<unknown[]>;
  getStatistics(filter?: ErrorFilter): Promise<ErrorStatistics>;

  // Notifications
  getNotifications(): Promise<ErrorNotification[]>;
  dismissNotification(id: string): Promise<{ success: boolean }>;

  // Error management
  clearErrors(errorIds?: string[]): Promise<{ success: boolean }>;
  exportErrors(filter?: ErrorFilter): Promise<string>;

  // Window management
  showWindow(): Promise<{ success: boolean }>;
  closeWindow(): Promise<{ success: boolean }>;
  toggleWindow(): Promise<{ success: boolean }>;
  getWindowState(): Promise<WindowState>;

  // Preferences
  getPreferences(): Promise<DiagnosticsPreferences>;
  setPreferences(prefs: Partial<DiagnosticsPreferences>): Promise<{ success: boolean }>;

  // Service health
  getServiceHealth(): Promise<ServiceHealth>;

  // Real-time subscriptions
  subscribeToErrors(callback: (error: unknown) => void): () => void;

  // Event listeners
  onSubscriptionConfirmed(callback: (data: { subscribed: boolean }) => void): void;
  onSubscriptionError(callback: (data: { error: string }) => void): void;
}

// Extend the global electronAPI interface
declare global {
  interface Window {
    electronAPI: {
      // Core IPC methods
      send: (channel: string, ...args: unknown[]) => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, func: (...args: unknown[]) => void) => void;
      once: (channel: string, func: (...args: unknown[]) => void) => void;
      removeAllListeners: (channel: string) => void;
      off: (channel: string, func: (...args: unknown[]) => void) => void;

      // Theme API
      getCurrentTheme: () => Promise<string>;
      setTheme: (theme: string) => Promise<void>;
      onThemeUpdated: (callback: (...args: unknown[]) => void) => void;

      // External browser API
      openExternal: (url: string) => void;

      // App info API
      getAppInfo: () => Promise<unknown>;

      // Clipboard API
      clipboard: {
        writeText: (text: string) => void;
        readText: () => string;
      };

      // Diagnostics API
      diagnostics: DiagnosticsAPI;
    };
  }
}
