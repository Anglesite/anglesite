/**
 * @file IPC handlers for file operations
 */
import { ipcMain, shell, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IWebsiteServerManager, IGitHistoryManager, IWebsiteManager } from '../core/interfaces';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';

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
  // Note: get-website-files handler is now in react-editor.ts to avoid conflicts

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

      // Remove 'src/' prefix from relativePath if present, since websiteServer.inputDir already includes /src/
      let cleanRelativePath = relativePath;
      if (relativePath.startsWith('src/')) {
        cleanRelativePath = relativePath.substring(4); // Remove 'src/' prefix
      }

      const absolutePath = path.join(websiteServer.inputDir, cleanRelativePath);

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

      // Remove 'src/' prefix from relativePath if present, since websiteServer.inputDir already includes /src/
      let cleanRelativePath = relativePath;
      if (relativePath.startsWith('src/')) {
        cleanRelativePath = relativePath.substring(4); // Remove 'src/' prefix
      }

      const absolutePath = path.join(websiteServer.inputDir, cleanRelativePath);

      console.log(`[IPC] Saving file to: ${absolutePath}`);
      fs.writeFileSync(absolutePath, content, 'utf8');

      // Auto-commit the change with git
      try {
        const appContext = getGlobalContext();
        const gitHistoryManager = appContext.getService<IGitHistoryManager>(ServiceKeys.GIT_HISTORY_MANAGER);

        // Get the website path (parent of src directory)
        const websitePath = path.dirname(websiteServer.inputDir);
        await gitHistoryManager.autoCommit(websitePath, 'save');
        console.log(`[IPC] Git auto-commit queued for website: ${websiteName}`);
      } catch (error) {
        console.warn('[IPC] Failed to auto-commit file save:', error);
      }

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

  // Helper function to validate page names
  function validatePageName(pageName: string): { valid: boolean; error?: string } {
    if (!pageName || !pageName.trim()) {
      return { valid: false, error: 'Page name is required' };
    }

    const trimmed = pageName.trim();

    // Check for path traversal attempts
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
      return { valid: false, error: 'Page name cannot contain path separators or ".."' };
    }

    // Check for filesystem unsafe characters (Windows and Unix)
    const invalidChars = /[<>:"|?*\x00-\x1f]/;
    if (invalidChars.test(trimmed)) {
      return { valid: false, error: 'Page name contains invalid characters' };
    }

    // Check for reserved names (Windows)
    const reservedNames = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9',
    ];
    const nameWithoutExt = trimmed.replace(/\.(html|md)$/i, '').toUpperCase();
    if (reservedNames.includes(nameWithoutExt)) {
      return { valid: false, error: 'Page name is a reserved system name' };
    }

    // Check length limits (255 chars for most filesystems)
    if (trimmed.length > 100) {
      return { valid: false, error: 'Page name is too long (maximum 100 characters)' };
    }

    // Check for leading/trailing dots or spaces (problematic on some systems)
    if (trimmed.startsWith('.') || trimmed.endsWith('.') || pageName.startsWith(' ') || pageName.endsWith(' ')) {
      return { valid: false, error: 'Page name cannot start or end with dots or spaces' };
    }

    return { valid: true };
  }

  // Helper function to escape HTML for safe insertion
  function escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  // Helper function to generate HTML template
  function generatePageTemplate(pageName: string): string {
    const safeName = escapeHtml(pageName);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName}</title>
</head>
<body>
  <h1>${safeName}</h1>
  <p>Welcome to your new page!</p>
</body>
</html>
`;
  }

  // Error types for page creation
  enum PageCreationErrorType {
    VALIDATION = 'VALIDATION',
    FILESYSTEM = 'FILESYSTEM',
    GIT = 'GIT',
    PERMISSION = 'PERMISSION',
    UNKNOWN = 'UNKNOWN',
  }

  interface PageCreationError {
    type: PageCreationErrorType;
    message: string;
    code: string;
    details?: any;
  }

  function createPageError(
    type: PageCreationErrorType,
    message: string,
    code: string,
    details?: any
  ): PageCreationError {
    return { type, message, code, details };
  }

  function getErrorType(error: any): PageCreationErrorType {
    if (!error) return PageCreationErrorType.UNKNOWN;

    const errorMessage = error.message || String(error);

    if (
      errorMessage.includes('Invalid') ||
      errorMessage.includes('cannot contain') ||
      errorMessage.includes('too long') ||
      errorMessage.includes('required')
    ) {
      return PageCreationErrorType.VALIDATION;
    }

    if (errorMessage.includes('EACCES') || errorMessage.includes('EPERM') || errorMessage.includes('Permission')) {
      return PageCreationErrorType.PERMISSION;
    }

    if (
      errorMessage.includes('ENOENT') ||
      errorMessage.includes('EEXIST') ||
      errorMessage.includes('already exists') ||
      errorMessage.includes('file')
    ) {
      return PageCreationErrorType.FILESYSTEM;
    }

    if (errorMessage.includes('git') || errorMessage.includes('commit')) {
      return PageCreationErrorType.GIT;
    }

    return PageCreationErrorType.UNKNOWN;
  }

  // Create new page handler with structured error handling
  ipcMain.handle('create-new-page', async (event, websiteName: string, pageName: string) => {
    const logger = console; // In production, use the actual logger service
    const startTime = Date.now();

    try {
      // Validate input parameters
      if (typeof websiteName !== 'string' || !websiteName.trim()) {
        const error = createPageError(
          PageCreationErrorType.VALIDATION,
          'Website name is required',
          'INVALID_WEBSITE_NAME'
        );
        logger.error('Page creation failed: Invalid website name', { error, websiteName });
        throw new Error(error.message);
      }

      if (typeof pageName !== 'string') {
        const error = createPageError(
          PageCreationErrorType.VALIDATION,
          'Page name must be a string',
          'INVALID_PAGE_NAME_TYPE'
        );
        logger.error('Page creation failed: Invalid page name type', { error, pageName });
        throw new Error(error.message);
      }

      // Validate page name
      const validation = validatePageName(pageName);
      if (!validation.valid) {
        const error = createPageError(
          PageCreationErrorType.VALIDATION,
          validation.error || 'Invalid page name',
          'INVALID_PAGE_NAME',
          { pageName }
        );
        throw new Error(error.message);
      }

      const sanitizedPageName = pageName.trim();

      // Get website path
      let websitePath: string;
      let usingFallback = false;
      try {
        const appContext = getGlobalContext();
        const websiteManager = appContext.getService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
        websitePath = websiteManager.getWebsitePath(websiteName);
        logger.debug('Got website path via DI', { websitePath });
      } catch (diError) {
        usingFallback = true;
        logger.warn('DI service unavailable, using fallback', { error: diError });
        const { getWebsitePath } = await import('../utils/website-manager');
        websitePath = getWebsitePath(websiteName);
        logger.debug('Got website path via fallback', { websitePath });
      }

      // Validate websitePath
      if (!websitePath || typeof websitePath !== 'string') {
        const error = createPageError(
          PageCreationErrorType.FILESYSTEM,
          'Could not determine website path',
          'WEBSITE_PATH_INVALID',
          { websiteName, websitePath }
        );
        throw new Error(error.message);
      }

      const srcPath = path.join(websitePath, 'src');

      // Safety check: if path.join returns undefined/null (e.g., in test environments), use fallback
      const finalSrcPath = srcPath || `${websitePath}/src`;

      // Ensure src directory exists
      try {
        if (!fs.existsSync(finalSrcPath)) {
          fs.mkdirSync(finalSrcPath, { recursive: true });
          logger.debug('Created src directory', { srcPath: finalSrcPath });
        }
      } catch (fsError) {
        const error = createPageError(
          PageCreationErrorType.FILESYSTEM,
          'Failed to create src directory',
          'MKDIR_FAILED',
          { srcPath: finalSrcPath, error: fsError }
        );
        throw new Error(error.message);
      }

      // Create the new HTML file
      const fileName = sanitizedPageName.endsWith('.html') ? sanitizedPageName : `${sanitizedPageName}.html`;

      const filePath = path.join(finalSrcPath, fileName);

      // Safety check: if path.join returns undefined/null (e.g., in test environments), use fallback
      const finalFilePath = filePath || `${finalSrcPath}/${fileName}`;

      // Use path.resolve to ensure we're writing to the correct directory
      // Only perform path traversal check if both paths are valid strings
      if (!finalFilePath || !finalSrcPath) {
        const error = createPageError(PageCreationErrorType.FILESYSTEM, 'Invalid file or source path', 'INVALID_PATH', {
          filePath: finalFilePath,
          srcPath: finalSrcPath,
        });
        throw new Error(error.message);
      }

      const resolvedPath = path.resolve(finalFilePath);
      const resolvedSrcPath = path.resolve(finalSrcPath);

      // Safety check: if path.resolve returns undefined/null (e.g., in test environments), use fallback
      const finalResolvedPath = resolvedPath || finalFilePath;
      const finalResolvedSrcPath = resolvedSrcPath || finalSrcPath;

      if (!finalResolvedPath || !finalResolvedSrcPath || !finalResolvedPath.startsWith(finalResolvedSrcPath)) {
        const error = createPageError(
          PageCreationErrorType.VALIDATION,
          'Path traversal attempt detected',
          'PATH_TRAVERSAL',
          { resolvedPath: finalResolvedPath, resolvedSrcPath: finalResolvedSrcPath }
        );
        throw new Error(error.message);
      }

      // Check if file already exists
      if (fs.existsSync(finalResolvedPath)) {
        const error = createPageError(
          PageCreationErrorType.FILESYSTEM,
          `A page named "${fileName}" already exists`,
          'FILE_EXISTS',
          { fileName, resolvedPath: finalResolvedPath }
        );
        throw new Error(error.message);
      }

      // Generate HTML content with escaped values
      const htmlContent = generatePageTemplate(sanitizedPageName.replace(/\.html$/i, ''));

      // Write the file
      try {
        fs.writeFileSync(finalResolvedPath, htmlContent, 'utf-8');
      } catch (writeError) {
        const error = createPageError(getErrorType(writeError), 'Failed to write page file', 'WRITE_FAILED', {
          resolvedPath: finalResolvedPath,
          error: writeError,
        });
        throw new Error(error.message);
      }

      // Auto-commit the new file using git history manager
      let gitCommitted = false;
      try {
        const appContext = getGlobalContext();
        const gitHistoryManager = appContext.getService<IGitHistoryManager>(ServiceKeys.GIT_HISTORY_MANAGER);
        await gitHistoryManager.autoCommit(websitePath, 'save');
        gitCommitted = true;
        logger.debug('Page auto-committed to git', { fileName });
      } catch (gitError) {
        logger.warn('Git auto-commit failed (non-fatal)', {
          fileName,
          error: gitError,
          message: gitError instanceof Error ? gitError.message : String(gitError),
        });
        // Don't fail the operation if git commit fails
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        filePath: finalResolvedPath,
        fileName: fileName,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorType = getErrorType(error);

      // Preserve validation error messages, only sanitize filesystem paths
      if (error instanceof Error) {
        const message = error.message;
        // Only sanitize paths in filesystem errors, preserve validation messages
        if (
          message.includes('Path traversal attempt detected') ||
          message.includes('Failed to write') ||
          message.includes('Directory')
        ) {
          const sanitizedMessage = message.replace(/\/[^\/]+\//g, '/***/');
          throw new Error(sanitizedMessage);
        } else {
          // Preserve validation and other business logic error messages
          throw new Error(message);
        }
      } else {
        throw new Error('Failed to create page');
      }
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
