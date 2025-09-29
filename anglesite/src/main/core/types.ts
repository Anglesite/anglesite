/**
 * @file Type definitions for Anglesite application
 *
 * Contains core type definitions used across the application,
 * particularly for settings and window state management, including
 * multi-monitor support for window state persistence.
 */

/**
 * Represents a rectangle with x, y coordinates and dimensions.
 */
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Information about a physical monitor/display.
 */
export interface MonitorInfo {
  /** Unique display identifier from Electron */
  id: number;
  /** Physical bounds of the monitor */
  bounds: Rectangle;
  /** Available work area (excluding taskbars, docks, etc.) */
  workAreaBounds: Rectangle;
  /** DPI scaling factor (1.0 = 100%, 1.25 = 125%, etc.) */
  scaleFactor: number;
  /** Whether this is the primary/main monitor */
  primary: boolean;
  /** Optional monitor model/name when available */
  label?: string;
}

/**
 * Complete monitor configuration snapshot.
 */
export interface MonitorConfiguration {
  /** All available monitors at the time of capture */
  monitors: MonitorInfo[];
  /** ID of the primary monitor */
  primaryMonitorId: number;
  /** When this configuration was captured */
  timestamp: number;
}

/**
 * Window position and size as percentages relative to a monitor.
 * Enables graceful handling of resolution changes.
 */
export interface RelativePosition {
  /** Horizontal position as percentage of monitor width (0.0-1.0+) */
  percentX: number;
  /** Vertical position as percentage of monitor height (0.0-1.0+) */
  percentY: number;
  /** Window width as percentage of monitor width (0.0-1.0+) */
  percentWidth: number;
  /** Window height as percentage of monitor height (0.0-1.0+) */
  percentHeight: number;
}

/**
 * Interface for persisting website window state with multi-monitor support.
 * Maintains backward compatibility with existing window states.
 */
export interface WindowState {
  /** Name of the website */
  websiteName: string;
  /** Path to the website directory */
  websitePath?: string;
  /** Window bounds (absolute coordinates) */
  bounds?: Rectangle;
  /** Whether the window was maximized */
  isMaximized?: boolean;
  /** Type of window: 'preview' (default) or 'editor' */
  windowType?: 'preview' | 'editor';

  // Multi-monitor enhancement fields (all optional for backward compatibility)
  /** Preferred monitor ID for window restoration */
  targetMonitorId?: number;
  /** Position and size relative to the target monitor */
  relativePosition?: RelativePosition;
  /** Monitor configuration when the window state was saved */
  monitorConfig?: MonitorConfiguration;
}

/**
 * Application settings interface defining all configurable options.
 */
export interface AppSettings {
  /** Whether automatic DNS configuration is enabled */
  autoDnsEnabled: boolean;
  /** HTTPS mode preference: 'https', 'http', or null if not yet configured */
  httpsMode: 'https' | 'http' | null;
  /** Whether the first launch setup assistant has been completed */
  firstLaunchCompleted: boolean;
  /** Theme preference: 'system', 'light', 'dark' */
  theme: 'system' | 'light' | 'dark';
  /** List of website windows to restore on startup */
  openWebsiteWindows: WindowState[];
  /** List of recently opened websites (up to 10, most recent first) */
  recentWebsites: string[];
  /** Whether telemetry for component error tracking is enabled */
  telemetryEnabled?: boolean;
  /** Telemetry configuration */
  telemetryConfig?: {
    enabled: boolean;
    samplingRate: number;
    maxBatchSize: number;
    batchIntervalMs: number;
    maxStorageMb: number;
    retentionDays: number;
    anonymizeErrors: boolean;
  };
  // Add more settings here as needed
}

// Validation functions for monitor-related types

/**
 * Validates a MonitorInfo object for correctness.
 */
export function validateMonitorInfo(monitor: MonitorInfo): boolean {
  return (
    typeof monitor.id === 'number' &&
    monitor.id >= 0 &&
    validateRectangle(monitor.bounds) &&
    validateRectangle(monitor.workAreaBounds) &&
    typeof monitor.scaleFactor === 'number' &&
    monitor.scaleFactor > 0 &&
    monitor.scaleFactor <= 10 && // Reasonable upper limit
    typeof monitor.primary === 'boolean' &&
    (monitor.label === undefined || typeof monitor.label === 'string')
  );
}

/**
 * Validates a Rectangle object for correctness.
 */
export function validateRectangle(rect: Rectangle): boolean {
  return (
    typeof rect.x === 'number' &&
    typeof rect.y === 'number' &&
    typeof rect.width === 'number' &&
    typeof rect.height === 'number' &&
    rect.width > 0 &&
    rect.height > 0 &&
    isFinite(rect.x) &&
    isFinite(rect.y) &&
    isFinite(rect.width) &&
    isFinite(rect.height)
  );
}

/**
 * Validates a RelativePosition object for correctness.
 */
export function validateRelativePosition(position: RelativePosition): boolean {
  return (
    typeof position.percentX === 'number' &&
    typeof position.percentY === 'number' &&
    typeof position.percentWidth === 'number' &&
    typeof position.percentHeight === 'number' &&
    position.percentX >= 0 &&
    position.percentY >= 0 &&
    position.percentWidth > 0 &&
    position.percentHeight > 0 &&
    position.percentWidth <= 3.0 && // Allow windows larger than monitor for edge cases
    position.percentHeight <= 3.0 &&
    isFinite(position.percentX) &&
    isFinite(position.percentY) &&
    isFinite(position.percentWidth) &&
    isFinite(position.percentHeight)
  );
}

/**
 * Validates a MonitorConfiguration object for correctness.
 */
export function validateMonitorConfiguration(config: MonitorConfiguration): boolean {
  if (!Array.isArray(config.monitors) || config.monitors.length === 0) {
    return false;
  }

  // Validate all monitors
  if (!config.monitors.every(validateMonitorInfo)) {
    return false;
  }

  // Ensure monitor IDs are unique
  const monitorIds = config.monitors.map((m) => m.id);
  if (new Set(monitorIds).size !== monitorIds.length) {
    return false;
  }

  // Ensure exactly one primary monitor
  const primaryMonitors = config.monitors.filter((m) => m.primary);
  if (primaryMonitors.length !== 1) {
    return false;
  }

  // Ensure primary monitor ID matches
  if (config.primaryMonitorId !== primaryMonitors[0].id) {
    return false;
  }

  // Validate timestamp
  if (typeof config.timestamp !== 'number' || config.timestamp <= 0) {
    return false;
  }

  return true;
}
