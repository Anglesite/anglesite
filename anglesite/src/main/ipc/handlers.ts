/**
 * @file IPC message routing and consolidated handlers
 * @description Consolidates IPC handlers and exports functions needed by tests and menu system
 */

// Import individual setup functions
import { setupWebsiteHandlers, openWebsiteInNewWindow } from './website';
import { setupFileHandlers } from './file';
import { setupPreviewHandlers } from './preview';
import { setupExportHandlers, exportSiteHandler } from './export';
import { setupReactEditorHandlers } from './react-editor';

/**
 * Setup all IPC main listeners.
 * Consolidates all IPC handler registrations in one place.
 */
export function setupIpcMainListeners(): void {
  setupWebsiteHandlers();
  setupFileHandlers();
  setupPreviewHandlers();
  setupExportHandlers();
  setupReactEditorHandlers();
}

// Export handler functions that are used by tests and menu system
export { exportSiteHandler, openWebsiteInNewWindow };
