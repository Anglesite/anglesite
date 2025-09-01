/**
 * @file IPC handlers for preview and development tools
 */
import { ipcMain, BrowserWindow, shell } from 'electron';
import { exec } from 'child_process';
import {
  getAllWebsiteWindows,
  togglePreviewDevTools,
  startWebsiteServerAndUpdateWindow,
} from '../ui/multi-window-manager';
import { getCurrentLiveServerUrl } from '../server/eleventy';
import { getWebsitePath } from '../utils/website-manager';

/**
 * Setup preview and development tools IPC handlers.
 *
 * Registers handlers for preview controls, development tools, and browser operations.
 */
export function setupPreviewHandlers(): void {
  // Build command handler
  ipcMain.on('build', () => {
    exec('npm run build', (err, stdout) => {
      if (err) {
        console.error(err);
        return;
      }
      console.log(stdout);
    });
  });

  ipcMain.on('toggle-devtools', () => {
    togglePreviewDevTools();
  });

  // Website Editor mode switching handlers
  ipcMain.on('website-editor-show-preview', async (event) => {
    const { showWebsitePreview } = await import('../ui/multi-window-manager');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      const websiteName = getWebsiteNameForWindow(window);
      if (websiteName) {
        showWebsitePreview(websiteName);
      }
    }
  });

  ipcMain.on('website-editor-show-edit', async (event) => {
    const { hideWebsitePreview } = await import('../ui/multi-window-manager');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      const websiteName = getWebsiteNameForWindow(window);
      if (websiteName) {
        hideWebsitePreview(websiteName);
      }
    }
  });

  // Reload preview handler
  ipcMain.on('reload-preview', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      const websiteName = getWebsiteNameForWindow(window);
      if (websiteName) {
        try {
          const websitePath = getWebsitePath(websiteName);
          if (websitePath) {
            await startWebsiteServerAndUpdateWindow(websiteName, websitePath);
          } else {
            console.error(`Could not find path for website: ${websiteName}`);
          }
        } catch (error) {
          console.error(`Failed to reload preview for ${websiteName}:`, error);
        }
      }
    }
  });

  // Browser handlers
  ipcMain.on('open-browser', async () => {
    try {
      await shell.openExternal(getCurrentLiveServerUrl());
    } catch {
      const localhostUrl = getCurrentLiveServerUrl().replace(/https:\/\/[^.]+\.test:/, 'https://localhost:');
      try {
        await shell.openExternal(localhostUrl);
      } catch (fallbackError) {
        console.error('Failed to open in browser:', fallbackError);
      }
    }
  });

  // Development tools
  ipcMain.on('clear-cache', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.webContents.session.clearCache();
    }
  });
}

/**
 * Helper function to get website name from a BrowserWindow.
 */
function getWebsiteNameForWindow(window: BrowserWindow): string | null {
  const websiteWindows = getAllWebsiteWindows();
  for (const [websiteName, websiteWindow] of Array.from(websiteWindows)) {
    if (websiteWindow.window === window) {
      return websiteName;
    }
  }
  return null;
}
