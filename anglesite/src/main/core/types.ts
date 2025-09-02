/**
 * @file Type definitions for Anglesite application
 *
 * Contains core type definitions used across the application,
 * particularly for settings and window state management.
 */

/**
 * Interface for persisting website window state.
 */
export interface WindowState {
  /** Name of the website */
  websiteName: string;
  /** Path to the website directory */
  websitePath?: string;
  /** Window bounds */
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Whether the window was maximized */
  isMaximized?: boolean;
  /** Type of window: 'preview' (default) or 'editor' */
  windowType?: 'preview' | 'editor';
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
  // Add more settings here as needed
}
