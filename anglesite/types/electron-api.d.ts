/**
 * @file Type definitions for the secure Electron API
 * @module electron-api
 * @description Provides TypeScript type definitions for the secure IPC bridge
 * between Electron's main and renderer processes, including theme management,
 * clipboard operations, and external URL handling.
 */

/**
 * @interface ThemeInfo
 * @description Information about the application's theme settings
 */
interface ThemeInfo {
  /**
   * @property {'system' | 'light' | 'dark'} userPreference
   * @description The user's theme preference setting
   */
  userPreference: 'system' | 'light' | 'dark';

  /**
   * @property {'light' | 'dark'} resolvedTheme
   * @description The actual theme being used after resolving system preferences
   */
  resolvedTheme: 'light' | 'dark';

  /**
   * @property {'light' | 'dark'} systemTheme
   * @description The operating system's current theme setting
   */
  systemTheme: 'light' | 'dark';
}

/**
 * @interface ElectronAPI
 * @description Secure API exposed to the renderer process via contextBridge
 * for communication with the main Electron process
 */
interface ElectronAPI {
  /**
   * @function send
   * @description Send a one-way IPC message to the main process
   * @param {string} channel The IPC channel name
   * @param {...unknown} args Arguments to send with the message
   */
  send: (channel: string, ...args: unknown[]) => void;

  /**
   * @function invoke
   * @description Send an IPC message and wait for a response from the main process
   * @param {string} channel The IPC channel name
   * @param {...unknown} args Arguments to send with the request
   * @returns {Promise<unknown>} Promise resolving to the response from the main process
   */
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;

  /**
   * @function on
   * @description Listen for IPC messages from the main process
   * @param {string} channel The IPC channel name to listen on
   * @param {Function} func Callback function to handle incoming messages
   */
  on: (channel: string, func: (...args: unknown[]) => void) => void;

  /**
   * @function removeAllListeners
   * @description Remove all listeners for a specific IPC channel
   * @param {string} channel The IPC channel name
   */
  removeAllListeners: (channel: string) => void;

  /**
   * @function off
   * @description Remove a specific listener for an IPC channel
   * @param {string} channel The IPC channel name
   * @param {Function} func The callback function to remove
   */
  off: (channel: string, func: (...args: unknown[]) => void) => void;

  /**
   * @function getCurrentTheme
   * @description Get the current theme information
   * @returns {Promise<ThemeInfo>} Promise resolving to current theme settings
   */
  getCurrentTheme: () => Promise<ThemeInfo>;

  /**
   * @function setTheme
   * @description Set the application theme preference
   * @param {'system' | 'light' | 'dark'} theme The theme preference to set
   * @returns {Promise<ThemeInfo>} Promise resolving to updated theme settings
   */
  setTheme: (theme: 'system' | 'light' | 'dark') => Promise<ThemeInfo>;

  /**
   * @function onThemeUpdated
   * @description Register a callback for theme change events
   * @param {Function} callback Function called when theme changes
   */
  onThemeUpdated: (callback: (themeInfo: ThemeInfo) => void) => void;

  /**
   * @function openExternal
   * @description Open a URL in the system's default browser
   * @param {string} url The URL to open externally
   */
  openExternal: (url: string) => void;

  /**
   * @property {object} clipboard
   * @description Clipboard operations API
   */
  clipboard: {
    /**
     * @function writeText
     * @description Write text to the system clipboard
     * @param {string} text Text to copy to clipboard
     */
    writeText: (text: string) => void;

    /**
     * @function readText
     * @description Read text from the system clipboard
     * @returns {string} Current clipboard text content
     */
    readText: () => string;
  };
}

/**
 * @global
 * @description Augment the global Window interface to include the Electron API
 */
declare global {
  /**
   * @interface Window
   * @description Extended Window interface for Electron renderer process
   */
  interface Window {
    /**
     * @property {ElectronAPI} electronAPI
     * @description The secure Electron API exposed via contextBridge
     */
    electronAPI?: ElectronAPI;
  }
}

export {};
