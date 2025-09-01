/**
 * @file IPC handlers for file operations
 */
import { ipcMain, shell, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IWebsiteServerManager } from '../core/interfaces';

interface WebsiteFile {
  name: string;
  type: 'directory' | 'file';
  path: string;
  extension: string | null;
  modified: Date;
  size: number | null;
}

/**
 * Setup file operations IPC handlers.
 */
export function setupFileHandlers(): void {
  // Website file content handlers
  ipcMain.handle('get-website-files', async (event, websiteName: string) => {
    try {
      console.log(`[IPC] get-website-files called for website: ${websiteName}`);
      const { getWebsiteServer } = await import('../ui/multi-window-manager');
      const websiteServer = getWebsiteServer(websiteName);
      if (!websiteServer?.urlResolver) {
        console.log(`[IPC] No website server or URL resolver found for: ${websiteName}`);
        return [];
      }

      console.log(`[IPC] Getting file tree from URL resolver for: ${websiteName}`);
      const fileTree = await websiteServer.urlResolver.getFileTree();
      console.log(`[IPC] File tree retrieved for ${websiteName}: ${fileTree.length} items`);
      return fileTree;
    } catch (error) {
      console.error('Error getting website files:', error);
      return [];
    }
  });

  ipcMain.handle('get-file-content', async (event, websiteName: string, relativePath: string) => {
    try {
      console.log(`[IPC] get-file-content called for website: ${websiteName}, file: ${relativePath}`);

      const { getWebsiteServer } = await import('../ui/multi-window-manager');
      const websiteServer = getWebsiteServer(websiteName);

      if (!websiteServer) {
        console.error(`[IPC] No website server found for: ${websiteName}`);
        return null;
      }

      // Resolve the absolute path using the website server's inputDir (which includes /src/)
      const fs = await import('fs');
      const path = await import('path');
      const absolutePath = path.join(websiteServer.inputDir, relativePath);

      console.log(`[IPC] Reading file from: ${absolutePath}`);
      const content = fs.readFileSync(absolutePath, 'utf8');
      return content;
    } catch (error) {
      console.error('Error reading file:', error);
      return null;
    }
  });

  ipcMain.handle('save-file-content', async (event, websiteName: string, relativePath: string, content: string) => {
    try {
      console.log(`[IPC] save-file-content called for website: ${websiteName}, file: ${relativePath}`);

      const { getWebsiteServer } = await import('../ui/multi-window-manager');
      const websiteServer = getWebsiteServer(websiteName);

      if (!websiteServer) {
        console.error(`[IPC] No website server found for: ${websiteName}`);
        return false;
      }

      // Resolve the absolute path using the website server's inputDir (which includes /src/)
      const fs = await import('fs');
      const path = await import('path');
      const absolutePath = path.join(websiteServer.inputDir, relativePath);

      console.log(`[IPC] Saving file to: ${absolutePath}`);
      fs.writeFileSync(absolutePath, content, 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving file:', error);
      return false;
    }
  });

  ipcMain.handle('get-file-url', async (event, websiteName: string, filePath: string) => {
    try {
      const { getWebsiteServer } = await import('../ui/multi-window-manager');
      const websiteServer = getWebsiteServer(websiteName);
      if (!websiteServer?.urlResolver) {
        return null;
      }

      return websiteServer.urlResolver.getUrlForFile(filePath);
    } catch (error) {
      console.error('Error getting file URL:', error);
      return null;
    }
  });

  ipcMain.handle('get-website-server-url', async (event, websiteName: string) => {
    try {
      const { getAllWebsiteWindows } = await import('../ui/multi-window-manager');
      const websiteWindows = getAllWebsiteWindows();
      const websiteWindow = websiteWindows.get(websiteName);

      if (!websiteWindow?.serverUrl) {
        return null;
      }

      return websiteWindow.serverUrl;
    } catch (error) {
      console.error('Error getting website server URL:', error);
      return null;
    }
  });

  ipcMain.on('load-file-preview', async (event, websiteName: string, fileUrl: string) => {
    try {
      const { getAllWebsiteWindows } = await import('../ui/multi-window-manager');
      const websiteWindows = getAllWebsiteWindows();
      const websiteWindow = websiteWindows.get(websiteName);

      if (!websiteWindow || websiteWindow.window.isDestroyed()) {
        console.error(`Website window not found for preview load: ${websiteName}`);
        return;
      }

      if (!websiteWindow.webContentsView || websiteWindow.webContentsView.webContents.isDestroyed()) {
        console.error(`WebContentsView not available for preview load: ${websiteName}`);
        return;
      }

      websiteWindow.webContentsView.webContents.loadURL(fileUrl);
    } catch (error) {
      console.error('Error loading file preview:', error);
    }
  });

  // File operations
  ipcMain.on('show-item-in-folder', async (_, filePath: string) => {
    if (filePath) {
      shell.showItemInFolder(filePath);
    }
  });

  // Website editor handlers
  ipcMain.handle('load-website-files', async (_event, websitePath: string) => {
    try {
      return await loadWebsiteFiles(websitePath);
    } catch (error) {
      console.error('Failed to load website files:', error);
      throw error;
    }
  });

  ipcMain.handle('start-website-dev-server', async (_event, websiteName: string, websitePath: string) => {
    try {
      // Use the DI-based WebsiteServerManager to start the server
      const { getGlobalContext } = await import('../core/service-registry');
      const { ServiceKeys } = await import('../core/container');

      const appContext = getGlobalContext();
      const websiteServerManager = appContext.getService<IWebsiteServerManager>(ServiceKeys.WEBSITE_SERVER_MANAGER);
      const serverInfo = await websiteServerManager.startServer(websiteName, websitePath);
      const serverUrl = serverInfo.url || `http://localhost:${serverInfo.port}`;
      return serverUrl;
    } catch (error) {
      console.error('Failed to start website dev server:', error);
      throw error;
    }
  });

  // Get current window title handler
  ipcMain.handle('get-current-window-title', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        return window.getTitle();
      }
      return null;
    } catch (error) {
      console.error('Error getting current window title:', error);
      return null;
    }
  });
}

/**
 * Load website files and directories for the file explorer.
 */
async function loadWebsiteFiles(websitePath: string): Promise<WebsiteFile[]> {
  const files: WebsiteFile[] = [];

  if (!fs.existsSync(websitePath)) {
    throw new Error(`Website path does not exist: ${websitePath}`);
  }

  const items = fs.readdirSync(websitePath, { withFileTypes: true });

  for (const item of items) {
    // Skip hidden files, node_modules, build output directories, and 11ty data files
    if (item.name.startsWith('.') || item.name.startsWith('_') || item.name.endsWith('.11tydata.json')) {
      continue;
    }

    const itemPath = path.join(websitePath, item.name);
    const stats = fs.statSync(itemPath);

    files.push({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: itemPath,
      extension: item.isFile() ? path.extname(item.name) : null,
      modified: stats.mtime,
      size: item.isFile() ? stats.size : null,
    });
  }

  // Sort files first, then directories
  files.sort((a, b) => {
    if (a.type === 'directory' && b.type === 'file') return 1;
    if (a.type === 'file' && b.type === 'directory') return -1;
    return a.name.localeCompare(b.name);
  });

  return files;
}
