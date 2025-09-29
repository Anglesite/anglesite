/**
 * @file IPC handlers for error reporting from renderer process
 */

import { ipcMain } from 'electron';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';
import { IErrorReportingService } from '../core/interfaces';
import { logger, sanitize } from '../utils/logging';

/**
 * Setup error reporting IPC handlers
 */
export function setupErrorReportingHandlers(): void {
  // Handle error reports from renderer process
  ipcMain.on('renderer-error', async (event, data) => {
    try {
      const appContext = getGlobalContext();
      const errorReporting = appContext.getService<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);

      // Extract error information
      const { component, error: errorData, errorInfo } = data;

      // Create an error object
      const error = new Error(errorData.message || 'Unknown renderer error');
      if (errorData.stack) {
        error.stack = errorData.stack;
      }

      // Report the error with context
      await errorReporting.report(error, {
        type: 'renderer-error',
        component,
        errorInfo,
        process: 'renderer',
        windowId: event.sender.id,
      });

      logger.info(`Error reported from renderer component: ${component}`);
    } catch (reportError) {
      logger.error(`Failed to handle renderer error report: ${sanitize.error(reportError)}`);
    }
  });

  // Handle request for error statistics
  ipcMain.handle('error-statistics', async () => {
    try {
      const appContext = getGlobalContext();
      const errorReporting = appContext.getService<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);

      return await errorReporting.getStatistics();
    } catch (error) {
      logger.error(`Failed to get error statistics: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Handle request for recent errors
  ipcMain.handle('error-recent', async (_, limit?: number) => {
    try {
      const appContext = getGlobalContext();
      const errorReporting = appContext.getService<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);

      return await errorReporting.getRecentErrors(limit);
    } catch (error) {
      logger.error(`Failed to get recent errors: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Handle request to clear error history
  ipcMain.handle('error-clear-history', async () => {
    try {
      const appContext = getGlobalContext();
      const errorReporting = appContext.getService<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);

      await errorReporting.clearHistory();
      return { success: true };
    } catch (error) {
      logger.error(`Failed to clear error history: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Handle request to export errors
  ipcMain.handle('error-export', async (_, filePath: string, since?: string) => {
    try {
      const appContext = getGlobalContext();
      const errorReporting = appContext.getService<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);

      const sinceDate = since ? new Date(since) : undefined;
      await errorReporting.exportErrors(filePath, sinceDate);

      return { success: true, filePath };
    } catch (error) {
      logger.error(`Failed to export errors: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Handle toggling error reporting
  ipcMain.handle('error-set-enabled', async (_, enabled: boolean) => {
    try {
      const appContext = getGlobalContext();
      const errorReporting = appContext.getService<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);

      errorReporting.setEnabled(enabled);
      return { success: true, enabled };
    } catch (error) {
      logger.error(`Failed to set error reporting enabled state: ${sanitize.error(error)}`);
      throw error;
    }
  });

  // Handle checking if error reporting is enabled
  ipcMain.handle('error-is-enabled', async () => {
    try {
      const appContext = getGlobalContext();
      const errorReporting = appContext.getService<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);

      return errorReporting.isEnabled();
    } catch (error) {
      logger.error(`Failed to check error reporting enabled state: ${sanitize.error(error)}`);
      throw error;
    }
  });

  logger.info('Error reporting IPC handlers registered');
}
