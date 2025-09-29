/**
 * @file IPC handlers for debugging and error reporting
 * @description Handles error logging from renderer processes for better debugging
 */
import { ipcMain } from 'electron';
import { getGlobalContext } from '../core/service-registry';
import { createIPCErrorReporter } from '../utils/error-handler-integration';

/**
 * Get error reporter for debugging IPC operations
 */
function getErrorReporter() {
  try {
    const context = getGlobalContext();
    return createIPCErrorReporter(context, 'renderer-error');
  } catch {
    return null; // Graceful degradation when DI not available
  }
}

/**
 * Setup debugging IPC handlers.
 */
export function setupDebuggingHandlers(): void {
  /**
   * Handle errors from renderer processes.
   */
  ipcMain.on('renderer-error', (event, errorData) => {
    const errorReporter = getErrorReporter();
    const rendererError = new Error(`Renderer component error: ${errorData.component}`);

    if (errorReporter) {
      errorReporter('renderer-component-error', rendererError, {
        timestamp: new Date().toISOString(),
        component: errorData.component,
        error: errorData.error,
        errorInfo: errorData.errorInfo,
        webContentsId: event.sender.id,
        fullErrorData: errorData,
      }).catch(() => {});
    } else {
      console.error('🔥 [Renderer Error]', 'Component crashed in renderer process:', {
        timestamp: new Date().toISOString(),
        component: errorData.component,
        error: errorData.error,
        errorInfo: errorData.errorInfo,
        webContentsId: event.sender.id,
      });

      // Log the full error details for debugging
      console.error('🔥 [Renderer Error Details]', JSON.stringify(errorData, null, 2));
    }
  });

  /**
   * Handle general debugging logs from renderer.
   */
  ipcMain.on('renderer-debug', (event, debugData) => {
    console.log('🐛 [Renderer Debug]', debugData.message, debugData.data || '');
  });

  /**
   * Handle performance/timing logs from renderer.
   */
  ipcMain.on('renderer-timing', (event, timingData) => {
    console.log('⏱️ [Renderer Timing]', timingData.operation, `${timingData.duration}ms`, timingData.details || '');
  });
}
