/**
 * @file IPC handlers for website bundling functionality
 */
import { ipcMain, BrowserWindow, dialog, IpcMainEvent } from 'electron';
import * as path from 'path';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';
import { logger, sanitize } from '../utils/logging';
import { WebsiteBundler, BundleCreationOptions, BundleExtractionOptions } from '../utils/website-bundler';
import {
  getAllWebsiteWindows,
  isWebsiteEditorFocused,
  getCurrentWebsiteEditorProject,
} from '../ui/multi-window-manager';

/**
 * Setup bundling functionality IPC handlers.
 */
export function setupBundleHandlers(): void {
  // Export website as bundle handler
  ipcMain.on('export-website-bundle', async (event) => {
    await exportWebsiteBundleHandler(event);
  });

  // Import website from bundle handler
  ipcMain.on('import-website-bundle', async (event) => {
    await importWebsiteBundleHandler(event);
  });

  // Validate bundle file handler
  ipcMain.handle('validate-bundle', async (_, bundlePath: string) => {
    try {
      const appContext = getGlobalContext();
      const bundler = appContext.getService<WebsiteBundler>(ServiceKeys.WEBSITE_BUNDLER);
      return await bundler.validateBundle(bundlePath);
    } catch (error) {
      logger.error('Bundle validation failed', { error: sanitize.error(error) });
      return { valid: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get bundle metadata handler
  ipcMain.handle('get-bundle-metadata', async (_, bundlePath: string) => {
    try {
      const appContext = getGlobalContext();
      const bundler = appContext.getService<WebsiteBundler>(ServiceKeys.WEBSITE_BUNDLER);
      const validation = await bundler.validateBundle(bundlePath);

      if (validation.valid && validation.metadata) {
        return { success: true, metadata: validation.metadata };
      } else {
        return { success: false, error: validation.error || 'Invalid bundle file' };
      }
    } catch (error) {
      logger.error('Failed to get bundle metadata', { error: sanitize.error(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

/**
 * Handle export website as bundle requests.
 */
export async function exportWebsiteBundleHandler(event: IpcMainEvent | null): Promise<void> {
  // Get window from event or focused window
  const win = event ? BrowserWindow.fromWebContents(event.sender) : BrowserWindow.getFocusedWindow();
  if (!win) {
    logger.warn('No window found for bundle export');
    return;
  }

  try {
    // Get the currently focused website to determine which website to export
    const focusedWindow = BrowserWindow.getFocusedWindow();
    let websiteToExport: string | null = null;

    // Check if any website window is focused
    if (isWebsiteEditorFocused()) {
      websiteToExport = getCurrentWebsiteEditorProject();
    } else {
      // Find which website window is focused from the website windows map
      const websiteWindows = getAllWebsiteWindows();
      for (const [websiteName, websiteWindow] of Array.from(websiteWindows)) {
        if (websiteWindow.window === focusedWindow) {
          websiteToExport = websiteName;
          break;
        }
      }
    }

    if (!websiteToExport) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'No Website Selected',
        message: 'Please open a website window first',
        detail: 'To export a website as a bundle, you need to have a website window open and focused.',
        buttons: ['OK'],
      });
      return;
    }

    // Show export options dialog
    const exportOptions = await showExportOptionsDialog(win, websiteToExport);
    if (!exportOptions) {
      return; // User cancelled
    }

    // Show save dialog
    const result = await dialog.showSaveDialog(win, {
      title: `Export ${websiteToExport} Bundle`,
      defaultPath: `${websiteToExport}.anglesite`,
      filters: [
        { name: 'Anglesite Bundle', extensions: ['anglesite'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return;
    }

    const exportPath = result.filePath;

    // Ensure .anglesite extension
    const finalPath = exportPath.endsWith('.anglesite') ? exportPath : `${exportPath}.anglesite`;

    // Get bundler service and create bundle
    const appContext = getGlobalContext();
    const bundler = appContext.getService<WebsiteBundler>(ServiceKeys.WEBSITE_BUNDLER);

    // Show progress to user
    win.webContents.send('bundle-export-progress', {
      stage: 'starting',
      message: 'Starting bundle creation...',
    });

    await bundler.createBundle(websiteToExport, finalPath, exportOptions);

    // Success feedback
    win.webContents.send('bundle-export-progress', {
      stage: 'completed',
      message: 'Bundle created successfully!',
    });

    // Show success dialog with option to open bundle location
    const successResult = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Export Successful',
      message: `Website "${websiteToExport}" exported successfully!`,
      detail: `Bundle saved as: ${path.basename(finalPath)}`,
      buttons: ['OK', 'Show in Folder'],
      defaultId: 0,
    });

    if (successResult.response === 1) {
      // Show in folder
      const { shell } = require('electron');
      shell.showItemInFolder(finalPath);
    }
  } catch (error) {
    logger.error('Failed to export website bundle', { error: sanitize.error(error) });

    win.webContents.send('bundle-export-progress', {
      stage: 'error',
      message: 'Bundle export failed',
    });

    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Export Failed',
      message: 'Failed to export website bundle',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['OK'],
    });
  }
}

/**
 * Handle import website from bundle requests.
 */
export async function importWebsiteBundleHandler(event: IpcMainEvent | null): Promise<void> {
  // Get window from event or focused window
  const win = event ? BrowserWindow.fromWebContents(event.sender) : BrowserWindow.getFocusedWindow();
  if (!win) {
    logger.warn('No window found for bundle import');
    return;
  }

  try {
    // Show open dialog for bundle file
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Website Bundle',
      filters: [
        { name: 'Anglesite Bundle', extensions: ['anglesite'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || !result.filePaths.length) {
      return;
    }

    const bundlePath = result.filePaths[0];

    // Get bundler service
    const appContext = getGlobalContext();
    const bundler = appContext.getService<WebsiteBundler>(ServiceKeys.WEBSITE_BUNDLER);

    // Validate bundle first
    const validation = await bundler.validateBundle(bundlePath);
    if (!validation.valid) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Invalid Bundle',
        message: 'The selected file is not a valid Anglesite bundle',
        detail: validation.error || 'Unknown validation error',
        buttons: ['OK'],
      });
      return;
    }

    // Show import options dialog
    const importOptions = await showImportOptionsDialog(win, bundlePath, validation.metadata);
    if (!importOptions) {
      return; // User cancelled
    }

    // Show progress to user
    win.webContents.send('bundle-import-progress', {
      stage: 'starting',
      message: 'Starting bundle import...',
    });

    // Extract the bundle
    const metadata = await bundler.extractBundle(bundlePath, importOptions);

    // Success feedback
    win.webContents.send('bundle-import-progress', {
      stage: 'completed',
      message: 'Bundle imported successfully!',
    });

    // Show success dialog
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Import Successful',
      message: `Website "${metadata.websiteName}" imported successfully!`,
      detail: `The website is now available in your projects.`,
      buttons: ['OK'],
    });

    // Notify UI to refresh website list
    win.webContents.send('website-operation-completed');
  } catch (error) {
    logger.error('Failed to import website bundle', { error: sanitize.error(error) });

    win.webContents.send('bundle-import-progress', {
      stage: 'error',
      message: 'Bundle import failed',
    });

    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Import Failed',
      message: 'Failed to import website bundle',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['OK'],
    });
  }
}

/**
 * Show export options dialog to user.
 */
async function showExportOptionsDialog(win: BrowserWindow, websiteName: string): Promise<BundleCreationOptions | null> {
  // For now, use a simple dialog. Could be enhanced with a custom UI later.
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Export Options',
    message: `Export options for "${websiteName}"`,
    detail: 'What would you like to include in the bundle?',
    buttons: ['Cancel', 'Source Only', 'Built Site Only', 'Source + Built Site'],
    defaultId: 1,
    cancelId: 0,
  });

  switch (result.response) {
    case 1: // Source Only
      return {
        includeSource: true,
        includeBuilt: false,
        buildBeforeBundling: false,
      };
    case 2: // Built Site Only
      return {
        includeSource: false,
        includeBuilt: true,
        buildBeforeBundling: true,
      };
    case 3: // Source + Built Site
      return {
        includeSource: true,
        includeBuilt: true,
        buildBeforeBundling: true,
      };
    default: // Cancel
      return null;
  }
}

/**
 * Show import options dialog to user.
 */
async function showImportOptionsDialog(
  win: BrowserWindow,
  bundlePath: string,
  metadata?: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<BundleExtractionOptions | null> {
  const appContext = getGlobalContext();
  const websiteManager = appContext.getService<any>(ServiceKeys.WEBSITE_MANAGER); // eslint-disable-line @typescript-eslint/no-explicit-any
  const websitesDir = websiteManager.getWebsitesDirectory();

  let websiteName = metadata?.websiteName || 'imported-website';

  // Check if website name already exists and suggest alternatives
  let targetName = websiteName;
  let counter = 1;
  while (await websiteManager.websiteExists(targetName)) {
    targetName = `${websiteName}-${counter}`;
    counter++;
  }

  if (targetName !== websiteName) {
    const conflictResult = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Name Conflict',
      message: `A website named "${websiteName}" already exists.`,
      detail: `Would you like to import as "${targetName}" instead?`,
      buttons: ['Cancel', 'Use New Name', 'Choose Custom Name'],
      defaultId: 1,
      cancelId: 0,
    });

    switch (conflictResult.response) {
      case 0: // Cancel
        return null;
      case 1: // Use new name
        websiteName = targetName;
        break;
      case 2: // Choose custom name
        // Could implement custom name input dialog here
        // For now, fall back to the suggested name
        websiteName = targetName;
        break;
    }
  }

  const targetDirectory = path.join(websitesDir, websiteName);

  return {
    targetDirectory,
    overwriteExisting: false,
    validateChecksum: true,
  };
}
