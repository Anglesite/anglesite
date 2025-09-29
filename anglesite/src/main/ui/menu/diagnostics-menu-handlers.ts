/**
 * @file Diagnostics menu handlers
 * @description Provides menu action handlers for diagnostics functionality
 */
import { dialog } from 'electron';
import { getGlobalContext } from '../../core/service-registry';
import { DiagnosticsWindowManager } from '../diagnostics-window-manager';

/**
 * Handler interface for diagnostics menu operations
 */
export interface DiagnosticsMenuHandler {
  openDiagnostics: () => Promise<void>;
  toggleDiagnostics: () => Promise<void>;
  isAvailable: () => boolean;
}

/**
 * Check if the diagnostics service is available.
 */
export function checkDiagnosticsServiceAvailability(): boolean {
  try {
    const appContext = getGlobalContext();
    const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');
    return windowManager !== null && windowManager !== undefined;
  } catch {
    // Context or service not available
    return false;
  }
}

/**
 * Handle diagnostics menu click action.
 */
export async function handleDiagnosticsMenuClick(): Promise<void> {
  try {
    const appContext = getGlobalContext();
    const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

    if (!windowManager) {
      throw new Error('Diagnostics service not available');
    }

    await windowManager.createOrShowWindow();
  } catch (error) {
    console.error('Failed to open diagnostics window:', error);

    if (error instanceof Error && error.message.includes('not available')) {
      dialog.showErrorBox(
        'Diagnostics Unavailable',
        'Website diagnostics service is currently unavailable. Please try restarting the application.'
      );
    } else {
      dialog.showErrorBox(
        'Failed to Open Diagnostics',
        `Could not open diagnostics window: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Handle diagnostics keyboard shortcut action.
 */
export async function handleDiagnosticsKeyboardShortcut(): Promise<void> {
  try {
    const appContext = getGlobalContext();
    const windowManager = appContext.getService<DiagnosticsWindowManager>('DiagnosticsWindowManager');

    if (!windowManager) {
      throw new Error('Diagnostics service not available');
    }

    windowManager.toggleWindow();
  } catch (error) {
    console.error('Failed to toggle diagnostics window:', error);

    if (error instanceof Error && error.message.includes('not available')) {
      dialog.showErrorBox(
        'Diagnostics Unavailable',
        'Website diagnostics service is currently unavailable. Please try restarting the application.'
      );
    } else {
      dialog.showErrorBox(
        'Diagnostics Error',
        `Could not toggle diagnostics window: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Create a diagnostics menu handler object.
 */
export function createDiagnosticsMenuHandler(): DiagnosticsMenuHandler {
  return {
    openDiagnostics: handleDiagnosticsMenuClick,
    toggleDiagnostics: handleDiagnosticsKeyboardShortcut,
    isAvailable: checkDiagnosticsServiceAvailability,
  };
}
