/**
 * @file IPC handlers for website export functionality
 */
import { ipcMain, BrowserWindow, dialog, IpcMainEvent } from 'electron';
// Dynamic import for 11ty to avoid loading at module initialization
// import Eleventy from '@11ty/eleventy';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import archiver from 'archiver';
import BagIt from 'bagit-fs';
import type { BagItMetadata } from '../ui/window-manager';
import {
  getAllWebsiteWindows,
  isWebsiteEditorFocused,
  getCurrentWebsiteEditorProject,
} from '../ui/multi-window-manager';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';
import type { IWebsiteManager } from '../core/interfaces';
import { createIPCErrorReporter } from '../utils/error-handler-integration';

/**
 * Get error reporter for export IPC operations
 */
function getErrorReporter() {
  try {
    const context = getGlobalContext();
    return createIPCErrorReporter(context, 'export');
  } catch {
    return null; // Graceful degradation when DI not available
  }
}

/**
 * Setup export functionality IPC handlers.
 */
export function setupExportHandlers(): void {
  // Export site to folder handler
  ipcMain.on('menu-export-site-folder', async (event) => {
    await exportSiteHandler(event, false);
  });

  // Export site to zip handler
  ipcMain.on('menu-export-site-zip', async (event) => {
    await exportSiteHandler(event, true);
  });
}

/**
 * Handle export site requests for folder, zip, and bagit formats
 *
 * Exports the currently focused website in the requested format:
 * - false/undefined: Export as folder
 * - true: Export as ZIP archive
 * - 'bagit': Export as BagIt archival format with metadata collection
 *
 * The function automatically builds the site using Eleventy before export,
 * shows appropriate save dialogs, and handles progress feedback to the user.
 * @param event IPC main event (null when called directly)
 * @param exportFormat Export format: false (folder), true (ZIP), or 'bagit' (BagIt archive)
 * @returns Promise that resolves when export is complete
 * @throws Will show error dialogs to user on export failure
 * @example
 * ```typescript
 * // Export as ZIP
 * await exportSiteHandler(null, true);
 *
 * // Export as BagIt with metadata
 * await exportSiteHandler(null, 'bagit');
 * ```
 */
export async function exportSiteHandler(event: IpcMainEvent | null, exportFormat: boolean | 'bagit'): Promise<void> {
  // Get window from event or focused window
  const win = event ? BrowserWindow.fromWebContents(event.sender) : BrowserWindow.getFocusedWindow();
  if (!win) {
    return;
  }

  try {
    // Get the currently focused website window to determine which website to export
    const focusedWindow = BrowserWindow.getFocusedWindow();
    let websiteToExport: string | null = null;

    // First check if any website window is focused
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
        detail: 'To export a website, you need to have a website window open and focused.',
        buttons: ['OK'],
      });
      return;
    }

    // Determine export format details
    const isBagIt = exportFormat === 'bagit';
    const isZip = exportFormat === true;

    // For BagIt exports, collect metadata first
    let metadata: BagItMetadata | null = null;
    if (isBagIt) {
      const { getBagItMetadata } = await import('../ui/window-manager');
      metadata = await getBagItMetadata(websiteToExport);
      if (!metadata) {
        // User cancelled the metadata dialog
        return;
      }
    }

    let defaultExtension = '';
    let filters: { name: string; extensions: string[] }[] = [];

    if (isBagIt) {
      defaultExtension = '.bagit.zip';
      filters = [{ name: 'BagIt Archive', extensions: ['zip'] }];
    } else if (isZip) {
      defaultExtension = '.zip';
      filters = [{ name: 'Zip Archive', extensions: ['zip'] }];
    } else {
      defaultExtension = '';
      filters = [{ name: 'Folder', extensions: [] }];
    }

    // Show appropriate save dialog based on export type
    const result = await dialog.showSaveDialog(win, {
      title: `Export ${websiteToExport}`,
      defaultPath: websiteToExport + defaultExtension,
      filters,
    });

    if (result.canceled || !result.filePath) {
      return;
    }

    const exportPath = result.filePath;

    // Get the website source path
    const appContext = getGlobalContext();
    const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);

    const websitePath = await websiteManager.execute(async (service) => {
      return service.getWebsitePath(websiteToExport);
    });

    // Determine the build output directory
    let buildDir: string;
    if (isBagIt) {
      buildDir = exportPath.replace('.bagit.zip', '');
    } else if (isZip) {
      buildDir = exportPath.replace('.zip', '');
    } else {
      buildDir = exportPath;
    }

    // Build the current website in the target directory using Eleventy programmatic API
    try {
      // NOTE: We used to load eleventy.config.js here, but it's incompatible with Eleventy v3's ESM requirements.
      // Instead, we'll pass the config path to Eleventy and let it handle loading.
      // The config file at src/main/eleventy/eleventy.config.js will be auto-discovered by Eleventy.
      const eleventyConfig = undefined; // Let Eleventy auto-discover its config

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eleventyOptions: any = {
        quietMode: false,
      };

      if (eleventyConfig) {
        eleventyOptions.config = eleventyConfig;
      }

      // Account for the new src/ directory structure
      const actualInputDir = fs.existsSync(path.join(websitePath, 'src')) ? path.join(websitePath, 'src') : websitePath;

      // Dynamically import Eleventy to avoid loading at module initialization
      const { default: Eleventy } = await import('@11ty/eleventy');

      const elev = new Eleventy(actualInputDir, buildDir, eleventyOptions);

      await elev.write();

      // Handle different export formats
      if (isBagIt) {
        // Use metadata collected before save dialog
        if (!metadata) {
          // This should not happen since we check above, but add safety check
          fs.rmSync(buildDir, { recursive: true, force: true });
          return;
        }
        await createBagItArchive(buildDir, exportPath, websiteToExport, win, metadata);
      } else if (isZip) {
        await createZipArchive(buildDir, exportPath, win);
      }
    } catch (buildErr) {
      const errorReporter = getErrorReporter();
      if (errorReporter) {
        errorReporter('websiteBuild', buildErr, { operation: 'website-build', websitePath, exportPath }).catch(
          () => {}
        );
      } else {
        console.error('Build failed:', buildErr);
      }
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Export Failed',
        message: 'Failed to build website for export',
        detail: buildErr instanceof Error ? buildErr.message : String(buildErr),
        buttons: ['OK'],
      });
      return;
    }
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('websiteExport', error, { operation: 'website-export' }).catch(() => {});
    } else {
      console.error('Export failed:', error);
    }
    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Export Failed',
      message: 'Failed to export website',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['OK'],
    });
  }
}

/**
 * Create a zip archive from the build directory.
 */
async function createZipArchive(buildDir: string, exportPath: string, win: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(buildDir)) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Export Failed',
        message: 'Built website not found',
        detail: 'The build directory was not found after building.',
        buttons: ['OK'],
      });
      reject(new Error('Build directory not found'));
      return;
    }

    const output = fs.createWriteStream(exportPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      // Clean up the temporary build directory
      fs.rmSync(buildDir, { recursive: true, force: true });
      resolve();
    });

    archive.on('error', (err: Error) => {
      const errorReporter = getErrorReporter();
      if (errorReporter) {
        errorReporter('zipArchiveError', err, { operation: 'zip-archive', exportPath }).catch(() => {});
      } else {
        console.error('Zip archive error:', err);
      }
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Export Failed',
        message: 'Failed to create zip archive',
        detail: err.message,
        buttons: ['OK'],
      });
      reject(err);
    });

    archive.pipe(output);
    archive.directory(buildDir, false);
    archive.finalize();
  });
}

/**
 * Create a BagIt archive from the build directory using Gladstone.
 */
async function createBagItArchive(
  buildDir: string,
  exportPath: string,
  websiteName: string,
  win: BrowserWindow,
  metadata: BagItMetadata
): Promise<void> {
  try {
    if (!fs.existsSync(buildDir)) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Export Failed',
        message: 'Built website not found',
        detail: 'The build directory was not found after building.',
        buttons: ['OK'],
      });
      throw new Error('Build directory not found');
    }

    // Create a unique temporary directory in the OS tmp directory
    const tmpDir = os.tmpdir();
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const tempBagDir = path.join(tmpDir, `anglesite_bagit_${uniqueId}`);

    // Get package info for bag metadata
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    let bagSoftwareAgent = 'Anglesite';

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const version = packageJson.version || '0.1.0';
      const homepage = packageJson.homepage || 'https://github.com/anglesite/anglesite';
      bagSoftwareAgent = `Anglesite ${version} ${homepage}`;
    } catch (error) {
      console.warn('Could not read package.json for BagIt metadata:', error);
    }

    // Prepare BagIt metadata
    const bagMetadata: { [key: string]: string } = {
      'External-Description': metadata.externalDescription,
      'External-Identifier': metadata.externalIdentifier,
      'Source-Organization': metadata.sourceOrganization,
      'Bagging-Date': new Date().toISOString().split('T')[0],
      'Bag-Software-Agent': bagSoftwareAgent,
    };

    // Add optional fields only if provided
    if (metadata.organizationAddress.trim()) {
      bagMetadata['Organization-Address'] = metadata.organizationAddress;
    }
    if (metadata.contactName.trim()) {
      bagMetadata['Contact-Name'] = metadata.contactName;
    }
    if (metadata.contactPhone.trim()) {
      bagMetadata['Contact-Phone'] = metadata.contactPhone;
    }
    if (metadata.contactEmail.trim()) {
      bagMetadata['Contact-Email'] = metadata.contactEmail;
    }

    // Create the bag using bagit-fs
    const bag = BagIt(tempBagDir, 'sha256', bagMetadata);

    // Copy all files from build directory to bag
    await new Promise<void>((resolve, reject) => {
      // Track created directories to avoid redundant mkdir calls
      const createdDirs = new Set<string>();

      const copyFiles = (sourceDir: string, targetPrefix = '') => {
        const files = fs.readdirSync(sourceDir, { withFileTypes: true });
        let pending = files.length;

        if (pending === 0) {
          resolve();
          return;
        }

        files.forEach((file) => {
          const sourcePath = path.join(sourceDir, file.name);
          const targetPath = path.join(targetPrefix, file.name);

          if (file.isDirectory()) {
            // Create the directory in the bag if it has a path
            if (targetPath) {
              const bagDirPath = targetPath;
              if (!createdDirs.has(bagDirPath)) {
                createdDirs.add(bagDirPath);
                bag.mkdir(bagDirPath, (err) => {
                  if (err) {
                    console.warn(`Failed to create directory ${bagDirPath}:`, err);
                  }
                  // Recursively copy directory contents
                  copyFiles(sourcePath, targetPath);
                  pending--;
                  if (pending === 0) resolve();
                });
              } else {
                // Directory already created, just recurse
                copyFiles(sourcePath, targetPath);
                pending--;
                if (pending === 0) resolve();
              }
            } else {
              // Root level, just recurse
              copyFiles(sourcePath, targetPath);
              pending--;
              if (pending === 0) resolve();
            }
          } else {
            // Copy file to bag
            const readStream = fs.createReadStream(sourcePath);
            // Use relative path - BagIt library automatically handles /data/ prefix
            const bagPath = targetPath;
            const writeStream = bag.createWriteStream(bagPath);

            readStream.pipe(writeStream);
            writeStream.on('finish', () => {
              pending--;
              if (pending === 0) resolve();
            });
            writeStream.on('error', reject);
          }
        });
      };

      copyFiles(buildDir);
    });

    // Finalize the bag
    await new Promise<void>((resolve) => {
      bag.finalize(() => {
        resolve();
      });
    });

    // Create a temporary zip file from the bag
    const tempZipPath = path.join(tmpDir, `anglesite_bagit_${uniqueId}.zip`);
    await createZipArchiveFromDirectory(tempBagDir, tempZipPath);

    // Copy the completed archive to the user-selected location
    fs.copyFileSync(tempZipPath, exportPath);

    // Clean up temporary files and directories
    fs.rmSync(tempBagDir, { recursive: true, force: true });
    fs.rmSync(tempZipPath, { force: true });
    fs.rmSync(buildDir, { recursive: true, force: true });
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('bagItArchiveCreation', error, {
        operation: 'bagit-archive-creation',
        websiteName,
        exportPath,
      }).catch(() => {});
    } else {
      console.error('BagIt archive creation failed:', error);
    }

    // Clean up any temporary files on error
    const tmpDir = os.tmpdir();
    const tempDirs = fs.readdirSync(tmpDir).filter((name) => name.startsWith('anglesite_bagit_'));
    tempDirs.forEach((dir) => {
      try {
        const fullPath = path.join(tmpDir, dir);
        if (fs.existsSync(fullPath)) {
          if (fs.statSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.rmSync(fullPath, { force: true });
          }
        }
      } catch (cleanupError) {
        console.warn('Failed to clean up temporary file:', dir, cleanupError);
      }
    });

    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Export Failed',
      message: 'Failed to create BagIt archive',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['OK'],
    });
    throw error;
  }
}

/**
 * Helper function to create a zip archive from a directory.
 */
async function createZipArchiveFromDirectory(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve();
    });

    archive.on('error', (err: Error) => {
      const errorReporter = getErrorReporter();
      if (errorReporter) {
        errorReporter('bagItZipArchiveError', err, { operation: 'bagit-zip-archive', sourceDir, outputPath }).catch(
          () => {}
        );
      } else {
        console.error('BagIt zip archive error:', err);
      }
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
