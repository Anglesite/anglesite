/**
 * @file WebContents cleanup utilities to prevent memory leaks
 */

import { WebContents, ipcMain } from 'electron';

/**
 * WeakMap to track event listeners for cleanup.
 */
const webContentsEventListeners = new WeakMap<
  WebContents,
  Set<{ event: string; listener: (...args: unknown[]) => void }>
>();
const ipcEventListeners = new Map<string, Set<(...args: unknown[]) => void>>();

/**
 * Register an event listener for a WebContents with automatic cleanup tracking.
 * @param webContents The WebContents instance
 * @param event The event name
 * @param listener The event listener function
 */
export function addWebContentsListener(
  webContents: WebContents,
  event: string,
  listener: (...args: unknown[]) => void
): void {
  // Add the listener
  webContents.on(event as any, listener);

  // Track for cleanup
  if (!webContentsEventListeners.has(webContents)) {
    webContentsEventListeners.set(webContents, new Set());
  }

  const listeners = webContentsEventListeners.get(webContents)!;
  listeners.add({ event, listener });

  // Auto-cleanup when WebContents is destroyed
  if (event !== 'destroyed') {
    webContents.once('destroyed', () => {
      cleanupWebContentsListeners(webContents);
    });
  }
}

/**
 * Register an IPC event listener with automatic cleanup tracking for proper memory management.
 * @param channel The IPC channel name to listen to
 * @param listener The event listener function that will be called when the channel receives messages
 */
export function addIpcListener(channel: string, listener: (...args: unknown[]) => void): void {
  // Add the listener
  ipcMain.on(channel, listener);

  // Track for cleanup
  if (!ipcEventListeners.has(channel)) {
    ipcEventListeners.set(channel, new Set());
  }

  const listeners = ipcEventListeners.get(channel)!;
  listeners.add(listener);
}

/**
 * Clean up all event listeners for a specific WebContents.
 * @param webContents The WebContents instance to clean up
 */
export function cleanupWebContentsListeners(webContents: WebContents): void {
  const listeners = webContentsEventListeners.get(webContents);
  if (!listeners) return;

  // Remove all tracked listeners
  for (const { event, listener } of listeners) {
    try {
      if (!webContents.isDestroyed()) {
        webContents.removeListener(event as any, listener);
      }
    } catch (error) {
      console.warn(`Failed to remove WebContents listener for event ${event}:`, error);
    }
  }

  // Clear the tracking
  webContentsEventListeners.delete(webContents);
}

/**
 * Remove a specific IPC listener from tracking and cleanup to prevent memory leaks.
 * @param channel The IPC channel name where the listener was registered
 * @param listener The specific listener function to unregister and remove from tracking
 */
export function removeIpcListener(channel: string, listener: (...args: unknown[]) => void): void {
  try {
    ipcMain.removeListener(channel, listener);

    // Remove from tracking
    const listeners = ipcEventListeners.get(channel);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        ipcEventListeners.delete(channel);
      }
    }
  } catch (error) {
    console.warn(`Failed to remove IPC listener for channel ${channel}:`, error);
  }
}

/**
 * Clean up all IPC listeners for a specific channel.
 * @param channel The IPC channel to clean up
 */
export function cleanupIpcChannel(channel: string): void {
  const listeners = ipcEventListeners.get(channel);
  if (!listeners) return;

  // Remove all listeners for this channel
  for (const listener of listeners) {
    try {
      ipcMain.removeListener(channel, listener);
    } catch (error) {
      console.warn(`Failed to remove IPC listener for channel ${channel}:`, error);
    }
  }

  // Clear the tracking
  ipcEventListeners.delete(channel);
}

/**
 * Clean up all tracked IPC listeners.
 */
export function cleanupAllIpcListeners(): void {
  for (const [channel, listeners] of ipcEventListeners) {
    for (const listener of listeners) {
      try {
        ipcMain.removeListener(channel, listener);
      } catch (error) {
        console.warn(`Failed to remove IPC listener for channel ${channel}:`, error);
      }
    }
  }

  ipcEventListeners.clear();
}

/**
 * Enhanced WebContents setup with automatic cleanup.
 * @param webContents The WebContents instance
 * @param setupCallback Callback to set up the WebContents
 */
export function setupWebContentsWithCleanup(
  webContents: WebContents,
  setupCallback: (webContents: WebContents) => void
): void {
  // Set up error handling
  addWebContentsListener(webContents, 'render-process-gone', (event, details) => {
    console.error('WebContents render process gone:', details);
  });

  addWebContentsListener(webContents, 'unresponsive', () => {
    console.warn('WebContents became unresponsive');
  });

  addWebContentsListener(webContents, 'responsive', () => {
    console.log('WebContents became responsive again');
  });

  // Run the setup callback
  setupCallback(webContents);

  // Ensure cleanup happens when destroyed
  addWebContentsListener(webContents, 'destroyed', () => {
    cleanupWebContentsListeners(webContents);
  });
}

/**
 * Create a cleanup function that can be called to remove specific listeners.
 * @param cleanupActions Array of cleanup functions
 * @returns A function that executes all cleanup actions
 */
export function createCleanupFunction(cleanupActions: (() => void)[]): () => void {
  return () => {
    for (const cleanup of cleanupActions) {
      try {
        cleanup();
      } catch (error) {
        console.warn('Cleanup action failed:', error);
      }
    }
  };
}

/**
 * Memory usage monitoring for WebContents.
 * @param webContents The WebContents instance to monitor
 * @param identifier A unique identifier for logging purposes
 */
export function monitorWebContentsMemory(webContents: WebContents, identifier: string): void {
  const checkMemory = () => {
    if (webContents.isDestroyed()) return;

    // Use process.memoryUsage() as a fallback since getProcessMemoryInfo may not be available
    try {
      const memoryInfo = process.memoryUsage();
      const { heapUsed, heapTotal } = memoryInfo;

      // Log warning if memory usage is high (>100MB)
      if (heapUsed > 100 * 1024 * 1024) {
        console.warn(`High memory usage for WebContents ${identifier}:`, {
          heapUsed: Math.round(heapUsed / (1024 * 1024)) + 'MB',
          heapTotal: Math.round(heapTotal / (1024 * 1024)) + 'MB',
        });
      }
    } catch (error) {
      console.warn(`Failed to get memory info for WebContents ${identifier}:`, error);
    }
  };

  // Check memory every 30 seconds
  const memoryCheckInterval = setInterval(checkMemory, 30000);

  // Clean up interval when WebContents is destroyed
  addWebContentsListener(webContents, 'destroyed', () => {
    clearInterval(memoryCheckInterval);
  });
}
