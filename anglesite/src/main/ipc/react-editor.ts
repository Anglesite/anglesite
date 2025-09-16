/**
 * @file IPC handlers for React website editor
 */
import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getWebsitePath } from '../utils/website-manager';
import { getAllWebsiteWindows } from '../ui/multi-window-manager';

/**
 * Setup React website editor IPC handlers.
 */
export function setupReactEditorHandlers(): void {
  /**
   * Get current website name for the active window.
   */
  ipcMain.handle('get-current-website-name', async (event: IpcMainInvokeEvent) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        const websiteName = getWebsiteNameForWindow(window);
        console.log('Current website name for window:', websiteName);
        return websiteName;
      }
      return null;
    } catch (error) {
      console.error('Error getting current website name:', error);
      return null;
    }
  });

  /**
   * Get website files for file explorer.
   */
  ipcMain.handle('get-website-files', async (event: IpcMainInvokeEvent, websiteName: string) => {
    try {
      console.log('Getting website files for:', websiteName);

      if (!websiteName) {
        throw new Error('Website name is required');
      }

      const websitePath = getWebsitePath(websiteName);
      const srcPath = path.join(websitePath, 'src');

      // Check if src directory exists
      try {
        await fs.access(srcPath);
      } catch {
        console.log('No src directory found for website:', websiteName);
        return [];
      }

      const files = await getFilesRecursively(srcPath, srcPath, websiteName);
      console.log(`Found ${files.length} files for website:`, websiteName);

      return files;
    } catch (error) {
      console.error('Error getting website files:', error);
      throw error;
    }
  });

  /**
   * Get file content.
   */
  ipcMain.handle('get-file-content', async (event: IpcMainInvokeEvent, websiteName: string, relativePath: string) => {
    try {
      console.log('Getting file content:', websiteName, relativePath);

      if (!websiteName || !relativePath) {
        throw new Error('Website name and file path are required');
      }

      if (typeof websiteName !== 'string' || typeof relativePath !== 'string') {
        throw new Error('Website name and relative path must be strings');
      }

      const websitePath = getWebsitePath(websiteName);
      if (!websitePath) {
        throw new Error(`Unable to get website path for: ${websiteName}`);
      }

      const fullPath = path.join(websitePath, relativePath);

      // Security check: ensure the path is within the website directory
      const resolvedPath = path.resolve(fullPath);
      const resolvedWebsitePath = path.resolve(websitePath);

      if (!resolvedPath.startsWith(resolvedWebsitePath)) {
        throw new Error('Access denied: path is outside website directory');
      }

      try {
        const content = await fs.readFile(resolvedPath, 'utf-8');
        console.log(`Read ${content.length} characters from:`, relativePath);
        return content;
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
          console.log('File not found:', relativePath);
          return null; // File doesn't exist
        }
        throw error;
      }
    } catch (error) {
      console.error('Error getting file content:', error);
      throw error;
    }
  });

  /**
   * Save file content.
   */
  ipcMain.handle(
    'save-file-content',
    async (event: IpcMainInvokeEvent, websiteName: string, relativePath: string, content: string) => {
      try {
        console.log('Saving file content:', websiteName, relativePath);

        if (!websiteName || !relativePath || content === undefined) {
          throw new Error('Website name, file path, and content are required');
        }

        if (typeof websiteName !== 'string' || typeof relativePath !== 'string' || typeof content !== 'string') {
          throw new Error('Website name, relative path, and content must be strings');
        }

        const websitePath = getWebsitePath(websiteName);
        if (!websitePath) {
          throw new Error(`Unable to get website path for: ${websiteName}`);
        }

        const fullPath = path.join(websitePath, relativePath);

        // Security check: ensure the path is within the website directory
        const resolvedPath = path.resolve(fullPath);
        const resolvedWebsitePath = path.resolve(websitePath);

        if (!resolvedPath.startsWith(resolvedWebsitePath)) {
          throw new Error('Access denied: path is outside website directory');
        }

        // Ensure directory exists
        const dirPath = path.dirname(resolvedPath);
        await fs.mkdir(dirPath, { recursive: true });

        // Write the file
        await fs.writeFile(resolvedPath, content, 'utf-8');
        console.log(`Saved ${content.length} characters to:`, relativePath);

        return true;
      } catch (error) {
        console.error('Error saving file content:', error);
        throw error;
      }
    }
  );
}

/**
 * Recursively get all files in a directory.
 */
interface FileInfo {
  name: string;
  filePath: string;
  isDirectory: boolean;
  relativePath: string;
  url?: string;
}

async function getFilesRecursively(dirPath: string, basePath: string, websiteName: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      // Skip hidden files, underscore files, and node_modules
      if (entry.name.startsWith('.') || entry.name.startsWith('_') || entry.name === 'node_modules') {
        continue;
      }

      const fileInfo: FileInfo = {
        name: entry.name,
        filePath: fullPath,
        isDirectory: entry.isDirectory(),
        relativePath,
      };

      // For files, try to determine if they have a URL (for HTML/MD files)
      if (!entry.isDirectory()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.html' || ext === '.md') {
          // Calculate the fallback URL first (always needed)
          let url = '/' + relativePath.replace(/\\/g, '/');
          if (ext === '.md') {
            url = url.replace(/\.md$/, '.html');
          } else if (ext === '.html') {
            // For HTML files, use pretty URLs (remove .html extension)
            url = url.replace(/\.html$/, '');
          }
          if (url.endsWith('/index')) {
            url = url.replace('/index', '/');
          } else if (url === '/index') {
            url = '/';
          }

          // Try to use the proper URL resolver for enhanced accuracy
          try {
            const { getWebsiteServer } = await import('../ui/multi-window-manager');
            const websiteServer = getWebsiteServer(websiteName);

            if (websiteServer?.urlResolver) {
              const resolvedUrl = websiteServer.urlResolver.getUrlForFile(fullPath);
              if (resolvedUrl) {
                url = resolvedUrl; // Use the enhanced resolver result
                if (process.env.NODE_ENV === 'development') {
                  console.log(`Enhanced URL resolution for ${relativePath}: ${resolvedUrl}`);
                }
              }
            }
          } catch (error) {
            console.warn('Could not use enhanced URL resolver for file:', fullPath, error);
            // Continue with the fallback URL calculated above
          }

          fileInfo.url = url;
        }
      }

      files.push(fileInfo);

      // If it's a directory, recursively get its contents
      if (entry.isDirectory()) {
        const subFiles = await getFilesRecursively(fullPath, basePath, websiteName);
        files.push(...subFiles);
      }
    }
  } catch (error) {
    console.error('Error reading directory:', dirPath, error);
  }

  return files;
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
