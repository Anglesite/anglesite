/**
 * @file DI-compatible IPC handlers for website management operations
 */
import { ipcMain, BrowserWindow, dialog, Menu, MenuItem } from 'electron';
import * as fs from 'fs';
import { promisify } from 'util';
import { getNativeInput, openWebsiteSelectionWindow } from '../ui/window-manager';
import {
  createWebsiteWindow,
  startWebsiteServerAndUpdateWindow,
  getAllWebsiteWindows,
  getWebsiteWindow,
  hideWebsitePreview,
  showWebsitePreview,
} from '../ui/multi-window-manager';
import { updateApplicationMenu } from '../ui/menu';
import { getGlobalContext } from '../core/service-registry';
import { logger, sanitize } from '../utils/logging';
import { ServiceKeys } from '../core/container';
import { IWebsiteManager, IStore } from '../core/interfaces';

// Safe fs.promises.rm fallback for Node.js compatibility
const rm =
  fs.promises && fs.promises.rm ? fs.promises.rm : fs.rmdir ? promisify(fs.rmdir.bind(fs)) : () => Promise.resolve();

// Helper to check if file exists using fs.stat instead of fs.access
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup website management IPC handlers.
 * Registers handlers for all website-related IPC channels including
 * creation, listing, opening, renaming, deletion, validation, and menu interactions.
 */
export function setupWebsiteHandlers(): void {
  // Website creation handler
  ipcMain.on('new-website', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      console.error('No window found for new-website IPC message');
      return;
    }

    try {
      let websiteName: string | null = null;
      let validationError = '';

      // Keep asking until user provides valid name or cancels
      do {
        let prompt = 'Enter a name for your new website:';
        if (validationError) {
          prompt = `${validationError}\n\nPlease enter a valid website name:`;
        }

        websiteName = await getNativeInput('New Website', prompt);

        if (!websiteName) {
          return;
        }

        // Validate website name (including duplicate check)
        try {
          // Use DI-based website manager
          const appContext = getGlobalContext();
          const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
          const validation = await websiteManager.validateWebsiteNameAsync(websiteName);
          if (!validation.valid) {
            validationError = validation.error || 'Invalid website name';
            websiteName = null; // Reset to continue the loop
          } else {
            validationError = ''; // Clear any previous error
          }
        } catch (error) {
          console.error('Validation error:', error);
          // Fallback to legacy method if DI fails
          try {
            const { validateWebsiteNameAsync } = await import('../utils/website-manager');
            const validation = await validateWebsiteNameAsync(websiteName!);
            if (!validation.valid) {
              validationError = validation.error || 'Invalid website name';
              websiteName = null;
            } else {
              validationError = '';
            }
          } catch (fallbackError) {
            console.error('Fallback validation error:', fallbackError);
            validationError = 'Unable to validate website name';
            websiteName = null;
          }
        }
      } while (!websiteName);

      await createNewWebsite(websiteName);
    } catch (error) {
      logger.error('Failed to create new website', {
        error: sanitize.error(error),
      });
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Creation Failed',
        message: 'Failed to create website',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['OK'],
      });
    }
  });

  // Website listing handler
  ipcMain.handle('list-websites', async () => {
    try {
      // Use DI-based website manager
      const appContext = getGlobalContext();
      const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      const allWebsites = await websiteManager.listWebsites();
      const openWebsiteWindows = getAllWebsiteWindows();
      const openWebsiteNames = Array.from(openWebsiteWindows.keys());

      // Filter out websites that are already open
      const availableWebsites = allWebsites.filter((websiteName: string) => !openWebsiteNames.includes(websiteName));

      return availableWebsites;
    } catch (error) {
      console.error('Failed to list websites via DI:', error);
      // Fallback to legacy method if DI fails
      try {
        const { listWebsites } = await import('../utils/website-manager');
        const allWebsites = await listWebsites();
        const openWebsiteWindows = getAllWebsiteWindows();
        const openWebsiteNames = Array.from(openWebsiteWindows.keys());
        const availableWebsites = allWebsites.filter((websiteName: string) => !openWebsiteNames.includes(websiteName));
        return availableWebsites;
      } catch (fallbackError) {
        console.error('Fallback failed to list websites:', fallbackError);
        throw fallbackError;
      }
    }
  });

  // Website opening handler
  ipcMain.on('open-website', async (_, websiteName: string) => {
    try {
      await openWebsiteInNewWindow(websiteName);
    } catch (error) {
      logger.error('Failed to open website', {
        error: sanitize.error(error),
        websiteName,
      });
      dialog.showErrorBox('Open Failed', `Failed to open website "${websiteName}": ${sanitize.error(error)}`);
    }
  });

  // Website context menu handler
  ipcMain.on('show-website-context-menu', (event, websiteName: string, position: { x: number; y: number }) => {
    const contextMenu = new Menu();
    const window = BrowserWindow.fromWebContents(event.sender);

    contextMenu.append(
      new MenuItem({
        label: 'Rename',
        click: () => {
          event.sender.send('website-context-menu-action', 'rename', websiteName);
        },
      })
    );

    contextMenu.append(
      new MenuItem({
        label: 'Delete',
        click: () => {
          event.sender.send('website-context-menu-action', 'delete', websiteName);
        },
      })
    );

    // Show context menu - let Electron position it automatically if window is provided
    if (window) {
      contextMenu.popup({ window });
    } else {
      contextMenu.popup({
        x: Math.round(position.x),
        y: Math.round(position.y),
      });
    }
  });

  // Website name validation handler
  ipcMain.handle('validate-website-name', async (_, name: string) => {
    try {
      // Use DI-based website manager
      const appContext = getGlobalContext();
      const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      return websiteManager.validateWebsiteName(name);
    } catch (error) {
      console.error('Failed to validate website name via DI:', error);
      // Fallback to legacy method if DI fails
      try {
        const { validateWebsiteName } = await import('../utils/website-manager');
        return validateWebsiteName(name);
      } catch (fallbackError) {
        console.error('Fallback failed to validate website name:', fallbackError);
        return { valid: false, error: 'Unable to validate website name' };
      }
    }
  });

  // Website rename handler
  ipcMain.handle('rename-website', async (event, oldName: string, newName: string) => {
    try {
      // Use DI-based website manager
      const appContext = getGlobalContext();
      const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      const success = await websiteManager.renameWebsite(oldName, newName);
      event.sender.send('website-operation-completed');
      return success;
    } catch (error) {
      console.error('Failed to rename website via DI:', error);
      // Fallback to legacy method if DI fails
      try {
        const { renameWebsite } = await import('../utils/website-manager');
        const success = await renameWebsite(oldName, newName);
        event.sender.send('website-operation-completed');
        return success;
      } catch (fallbackError) {
        console.error('Fallback failed to rename website:', fallbackError);
        throw fallbackError; // Let the frontend handle the error display
      }
    }
  });

  // Website delete handler
  ipcMain.on('delete-website', async (event, websiteName: string) => {
    try {
      // Use DI-based website manager
      const appContext = getGlobalContext();
      const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      const deleted = await websiteManager.deleteWebsite(websiteName);

      if (deleted) {
        event.sender.send('website-operation-completed');
      }
    } catch (error) {
      console.error('Failed to delete website:', error);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        dialog.showMessageBox(window, {
          type: 'error',
          title: 'Delete Failed',
          message: 'Failed to delete website',
          detail: error instanceof Error ? error.message : String(error),
          buttons: ['OK'],
        });
      }
    }
  });

  // Website selection window handler
  ipcMain.on('open-website-selection', () => {
    try {
      openWebsiteSelectionWindow();
    } catch (error) {
      console.error('Failed to open website selection window:', error);
    }
  });

  // View mode control handlers
  ipcMain.handle('set-edit-mode', async (event, websiteName: string) => {
    try {
      hideWebsitePreview(websiteName);
      return true;
    } catch (error) {
      console.error('Failed to set edit mode:', error);
      return false;
    }
  });

  ipcMain.handle('set-preview-mode', async (event, websiteName: string) => {
    try {
      showWebsitePreview(websiteName);
      return true;
    } catch (error) {
      console.error('Failed to set preview mode:', error);
      return false;
    }
  });
}

/**
 * Create a new website with the given name and open it in a new window.
 */
async function createNewWebsite(websiteName: string): Promise<void> {
  let websiteCreated = false;
  let newWebsitePath = '';

  try {
    // Step 1: Create the website files (this validates name and creates directory)
    // Use DI-based website manager
    try {
      console.log('Attempting to get global context...');
      const appContext = getGlobalContext();
      if (!appContext) {
        throw new Error('Global context not initialized');
      }
      console.log('Global context obtained, getting WebsiteManager service...');
      const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      if (!websiteManager) {
        throw new Error('WebsiteManager service not available');
      }
      console.log('WebsiteManager service obtained, creating website:', websiteName);
      newWebsitePath = await websiteManager.createWebsite(websiteName);
      websiteCreated = true;
      console.log('Website created successfully via DI:', newWebsitePath);
    } catch (diError) {
      console.error('Failed to create website via DI:', diError);
      console.error('DI Error details:', {
        message: diError instanceof Error ? diError.message : String(diError),
        stack: diError instanceof Error ? diError.stack : 'No stack trace',
      });
      console.log('Falling back to deprecated createWebsiteWithName - DI not available');
      // Fallback to legacy method if DI fails
      const { createWebsiteWithName } = await import('../utils/website-manager');
      console.log('Using deprecated createWebsiteWithName - DI not available');
      newWebsitePath = await createWebsiteWithName(websiteName);
      websiteCreated = true;
    }

    // Step 2: Open the new website in a new window (with isNewWebsite = true)
    await openWebsiteInNewWindow(websiteName, newWebsitePath, true);

    // Step 3: Add to recent websites and update menu using DI store service
    try {
      const appContext = getGlobalContext();
      const store = appContext.getService<IStore>(ServiceKeys.STORE);
      store.addRecentWebsite(websiteName);
      updateApplicationMenu();
    } catch (error) {
      console.error('Failed to update recent websites - DI system required:', error);
      // DI system is now required, no fallback available
      updateApplicationMenu();
    }
  } catch (error) {
    console.error('Failed to create new website:', error);

    // If we created the website directory but failed to open it, clean up
    if (websiteCreated && newWebsitePath) {
      try {
        if (await exists(newWebsitePath)) {
          await rm(newWebsitePath, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        logger.error('Failed to clean up website directory', {
          error: sanitize.error(cleanupError),
        });
        // Don't throw cleanup error, let the original error be thrown
      }
    }

    // If the error is about website already existing, provide a helpful message
    if (error instanceof Error && error.message.includes('already exists')) {
      // Check if the website actually exists and is valid
      try {
        // Try DI first, then fallback
        let existingPath: string;
        try {
          const appContext = getGlobalContext();
          const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
          existingPath = websiteManager.getWebsitePath(websiteName);
        } catch {
          const { getWebsitePath } = await import('../utils/website-manager');
          existingPath = getWebsitePath(websiteName);
        }
        if (fs.existsSync(existingPath)) {
          // Website exists, try to open it instead
          await openWebsiteInNewWindow(websiteName, existingPath, false);
          return; // Success - exit without throwing
        }
      } catch (openError) {
        console.error('Failed to open existing website:', openError);
        // Fall through to throw original error
      }
    }

    throw error;
  }
}

/**
 * Open a website in a new website window using multi-window-manager.
 */
export async function openWebsiteInNewWindow(
  websiteName: string,
  websitePath?: string,
  isNewWebsite: boolean = false
): Promise<void> {
  try {
    // Step 1: Get website path if not provided
    let actualWebsitePath: string;
    if (websitePath) {
      actualWebsitePath = websitePath;
    } else {
      // Use DI-based website manager
      try {
        const appContext = getGlobalContext();
        const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
        actualWebsitePath = websiteManager.getWebsitePath(websiteName);
      } catch (diError) {
        console.error('Failed to get website path via DI:', diError);
        // Fallback to legacy method if DI fails
        const { getWebsitePath } = await import('../utils/website-manager');
        actualWebsitePath = getWebsitePath(websiteName);
      }
    }

    // Verify the website directory exists
    if (!(await exists(actualWebsitePath))) {
      throw new Error(`Website directory does not exist: ${actualWebsitePath}`);
    }

    // Step 2: Create website window using multi-window manager
    createWebsiteWindow(websiteName, actualWebsitePath);

    // Step 3: Start the website server for this window
    await startWebsiteServerAndUpdateWindow(websiteName, actualWebsitePath);

    // Step 4: Add to recent websites (but only if not a new website) using DI store service
    if (!isNewWebsite) {
      try {
        const appContext = getGlobalContext();
        const store = appContext.getService<IStore>(ServiceKeys.STORE);
        store.addRecentWebsite(websiteName);
        updateApplicationMenu();
      } catch (error) {
        console.error('Failed to update recent websites - DI system required:', error);
        // DI system is now required, no fallback available
        updateApplicationMenu();
      }
    }
  } catch (error) {
    logger.error(`Failed to open website in website window`, {
      error: sanitize.error(error),
      websiteName,
    });
    throw new Error(`Failed to open website "${websiteName}": ${sanitize.error(error)}`);
  }
}
