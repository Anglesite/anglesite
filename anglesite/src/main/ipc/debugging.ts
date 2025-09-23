/**
 * @file IPC handlers for debugging and error reporting
 * @description Handles error logging from renderer processes for better debugging
 */
import { ipcMain } from 'electron';

/**
 * Setup debugging IPC handlers.
 */
export function setupDebuggingHandlers(): void {
  /**
   * Handle errors from renderer processes.
   */
  ipcMain.on('renderer-error', (event, errorData) => {
    console.error('🔥 [Renderer Error]', 'Component crashed in renderer process:', {
      timestamp: new Date().toISOString(),
      component: errorData.component,
      error: errorData.error,
      errorInfo: errorData.errorInfo,
      webContentsId: event.sender.id,
    });

    // Log the full error details for debugging
    console.error('🔥 [Renderer Error Details]', JSON.stringify(errorData, null, 2));
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
