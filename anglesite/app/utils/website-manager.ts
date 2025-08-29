/**
 * @file DI-compatible Website Management Service
 *
 * Refactored version of website management utilities that implements IWebsiteManager.
 * interface and uses dependency injection for better testability and maintainability.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
// BufferEncoding is a built-in Node.js type alias
type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';
import { dialog, BrowserWindow, app } from 'electron';
import { createAtomicTransaction, atomicWriteFile, atomicCopyDirectory, atomicRename } from './atomic-operations';
import { IWebsiteManager, ILogger, IFileSystem, IAtomicOperations } from '../core/interfaces';
import { ErrorUtils, AtomicOperationError } from '../core/errors';

// Helper classes for fallback functionality
class FileSystemService implements IFileSystem {
  async exists(path: string): Promise<boolean> {
    try {
      await fs.promises.stat(path);
      return true;
    } catch {
      return false;
    }
  }
  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    return fs.promises.readFile(path, encoding);
  }
  async writeFile(path: string, data: string | Buffer, encoding?: BufferEncoding): Promise<void> {
    return fs.promises.writeFile(path, data, encoding);
  }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.promises.mkdir(path, options);
  }
  async readdir(path: string): Promise<string[]> {
    return fs.promises.readdir(path);
  }
  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.promises.rm(path, { recursive: options?.recursive, force: true });
  }
  async copyFile(src: string, dest: string): Promise<void> {
    return fs.promises.copyFile(src, dest);
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    return fs.promises.rename(oldPath, newPath);
  }
  async stat(path: string) {
    const stats = await fs.promises.stat(path);
    return {
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
      size: stats.size,
      mtime: stats.mtime,
    };
  }
}

function createStubAtomicOperations(fileSystem: IFileSystem): IAtomicOperations {
  return {
    writeFileAtomic: (path: string, content: string | Buffer) => {
      return fileSystem.writeFile(path, content, 'utf-8').then(
        () => ({
          success: true,
          rollbackPerformed: false,
          temporaryPaths: [],
        }),
        (error) => ({
          success: false,
          error: ErrorUtils.wrap(error) as AtomicOperationError,
          rollbackPerformed: false,
          temporaryPaths: [],
        })
      );
    },
    copyDirectoryAtomic: () => {
      const error = new AtomicOperationError(
        'copyDirectoryAtomic not implemented yet',
        'NOT_IMPLEMENTED',
        'copyDirectoryAtomic'
      );
      return Promise.resolve({
        success: false,
        error: error,
        rollbackPerformed: false,
        temporaryPaths: [],
      });
    },
    renameAtomic: (oldPath: string, newPath: string) => {
      return fileSystem.rename(oldPath, newPath).then(
        () => ({
          success: true,
          rollbackPerformed: false,
          temporaryPaths: [],
        }),
        (error) => ({
          success: false,
          error: ErrorUtils.wrap(error) as AtomicOperationError,
          rollbackPerformed: false,
          temporaryPaths: [],
        })
      );
    },
    createTransaction: () => {
      throw new AtomicOperationError('createTransaction not implemented yet', 'NOT_IMPLEMENTED', 'createTransaction');
    },
  };
}

/**
 * DI-compatible WebsiteManager implementation.
 */
export class WebsiteManager implements IWebsiteManager {
  private readonly logger: ILogger;

  constructor(
    logger: ILogger,
    private readonly fileSystem: IFileSystem,
    private readonly atomicOperations: IAtomicOperations
  ) {
    this.logger = logger.child({ service: 'WebsiteManager' });
  }

  /**
   * Static factory method for DI container.
   */
  static create(logger: ILogger, fileSystem: IFileSystem, atomicOperations: IAtomicOperations): WebsiteManager {
    return new WebsiteManager(logger, fileSystem, atomicOperations);
  }

  /**
   * Get the platform-specific websites directory path.
   */
  private getWebsitesDirectory(): string {
    try {
      return path.join(app.getPath('userData'), 'websites');
    } catch {
      // Fallback for test environments
      const appDataPath =
        process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support', 'Anglesite')
          : process.platform === 'win32'
            ? path.join(process.env.APPDATA || '', 'Anglesite')
            : path.join(os.homedir(), '.config', 'anglesite');

      return path.join(appDataPath, 'websites');
    }
  }

  /**
   * Helper to check if file exists using the injected file system.
   */
  private async exists(filePath: string): Promise<boolean> {
    return await this.fileSystem.exists(filePath);
  }

  /**
   * Create a new website with the specified name and basic structure.
   *
   * This function uses atomic operations to ensure data integrity:
   * - Creates website in temporary location first
   * - Validates all files are correctly generated
   * - Atomically moves to final location
   * - Automatic rollback on any failure.
   * @param websiteName Unique name for the new website (used as directory name).
   * @returns Promise resolving to the absolute path of the created website directory.
   * @throws Error if a website with the same name already exists or creation fails.
   */
  async createWebsite(websiteName: string): Promise<string> {
    this.logger.info('Creating new website', { websiteName });

    const websitesDir = this.getWebsitesDirectory();
    const newWebsitePath = path.join(websitesDir, websiteName);

    // Pre-validation: Check if website already exists
    if (await this.exists(newWebsitePath)) {
      throw new Error(`Website "${websiteName}" already exists`);
    }

    // Ensure websites directory exists
    if (!(await this.exists(websitesDir))) {
      await this.fileSystem.mkdir(websitesDir, { recursive: true });
    }

    // Find template source path
    const templateSourcePath = await this.findTemplateSourcePath();
    if (!templateSourcePath) {
      throw new Error('Could not find @dwk/anglesite-starter template package');
    }

    // Create atomic transaction for website creation
    const transaction = createAtomicTransaction();

    try {
      // Step 1: Atomically copy template to target location
      const copyResult = await atomicCopyDirectory(templateSourcePath, newWebsitePath, {
        exclude: ['node_modules', '_site', '.git', 'dist'],
        validate: async (contents) => {
          // Validate that essential files are present
          const requiredFiles = ['src', 'package.json'];
          return requiredFiles.every((file) => contents.includes(file));
        },
      });

      if (!copyResult.success) {
        throw copyResult.error || new Error('Failed to copy template directory');
      }

      // Step 2: Atomically customize index.md with website name
      const indexPath = path.join(newWebsitePath, 'src', 'index.md');
      if (await this.exists(indexPath)) {
        transaction.addOperation(
          async () => {
            const indexContent = await this.customizeIndexContent(websiteName, indexPath);
            const writeResult = await atomicWriteFile(indexPath, indexContent, {
              validate: (content) => {
                // Validate that customization was applied
                const hasWelcome = content.includes(`Welcome to ${websiteName}!`);
                const hasAbout = content.includes(`About ${websiteName}`);
                const isValid = hasWelcome && hasAbout;

                if (!isValid) {
                  this.logger.error('Index.md validation failed', undefined, { websiteName, hasWelcome, hasAbout });
                  this.logger.debug('Content preview', { preview: content.substring(0, 300) });
                }

                return isValid;
              },
              backup: false, // No backup needed - this is a fresh template file
            });

            if (!writeResult.success) {
              throw writeResult.error || new Error('Failed to customize index.md');
            }
          },
          async () => {
            // Rollback: restore original index.md if it exists
            const backupPath = `${indexPath}.backup.${Date.now()}`;
            if (await this.exists(backupPath)) {
              await this.fileSystem.rename(backupPath, indexPath);
            }
          }
        );
      }

      // Step 3: Atomically update package.json
      const packageJsonPath = path.join(newWebsitePath, 'package.json');
      if (await this.exists(packageJsonPath)) {
        transaction.addOperation(
          async () => {
            const packageJsonContent = await this.customizePackageJson(websiteName, packageJsonPath);
            const writeResult = await atomicWriteFile(packageJsonPath, packageJsonContent, {
              validate: (content) => {
                try {
                  const parsed = JSON.parse(content);
                  // Validate that name is sanitized correctly
                  const expectedSanitizedName = this.sanitizePackageName(websiteName);
                  const isValid = parsed.name === expectedSanitizedName;
                  if (!isValid) {
                    this.logger.error('Package.json validation failed', undefined, {
                      expectedName: expectedSanitizedName,
                      actualName: parsed.name,
                      originalWebsiteName: websiteName,
                    });
                  }
                  return isValid;
                } catch (error) {
                  this.logger.error('Package.json parse error', error as Error, {
                    contentPreview: content.substring(0, 500),
                  });
                  return false;
                }
              },
              backup: false, // No backup needed - this is a fresh template file
            });

            if (!writeResult.success) {
              throw writeResult.error || new Error('Failed to customize package.json');
            }
          },
          async () => {
            // Rollback: restore original package.json if it exists
            const backupPath = `${packageJsonPath}.backup.${Date.now()}`;
            if (await this.exists(backupPath)) {
              await this.fileSystem.rename(backupPath, packageJsonPath);
            }
          }
        );
      }

      // Step 4: Run npm install if package.json exists
      if (await this.exists(packageJsonPath)) {
        transaction.addOperation(
          async () => {
            await this.runNpmInstall(newWebsitePath);
          },
          async () => {
            // Rollback: remove node_modules if created
            const nodeModulesPath = path.join(newWebsitePath, 'node_modules');
            if (await this.exists(nodeModulesPath)) {
              try {
                await this.fileSystem.rmdir(nodeModulesPath, { recursive: true });
              } catch (error) {
                this.logger.warn('Failed to remove node_modules during rollback', { error });
              }
            }
          }
        );
      }

      // Execute the transaction
      const result = await transaction.execute();

      if (!result.success) {
        throw result.error || new Error('Website creation transaction failed');
      }

      this.logger.info('Website created successfully', { websiteName, path: newWebsitePath });
      return newWebsitePath;
    } catch (error) {
      this.logger.error('Website creation failed', error as Error, { websiteName });

      // Clean up the entire website directory if it was created
      if (await this.exists(newWebsitePath)) {
        try {
          await this.fileSystem.rmdir(newWebsitePath, { recursive: true });
        } catch (cleanupError) {
          this.logger.error('Failed to cleanup website directory after error', cleanupError as Error);
        }
      }

      throw error;
    }
  }

  /**
   * Find the template source path from possible locations.
   */
  private async findTemplateSourcePath(): Promise<string | null> {
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'node_modules', '@dwk', 'anglesite-starter'),
      path.join(process.cwd(), 'node_modules', '@dwk', 'anglesite-starter'),
      // For development, also check the local path
      path.join(__dirname, '..', '..', '..', '..', 'anglesite-starter'),
    ];

    for (const starterPath of possiblePaths) {
      if (await this.exists(starterPath)) {
        this.logger.debug('Found template source', { path: starterPath });
        return starterPath;
      }
    }

    this.logger.warn('Template source path not found in any expected location');
    return null;
  }

  /**
   * Customize the index.md content with website name.
   */
  private async customizeIndexContent(websiteName: string, indexPath: string): Promise<string> {
    let indexContent = (await this.fileSystem.readFile(indexPath, 'utf8')) as string;

    // Replace the title in frontmatter
    indexContent = indexContent.replace(/title: Hello World!/, `title: Welcome to ${websiteName}!`);

    // Replace the main content line
    indexContent = indexContent.replace(
      'This is your new website! Edit this file to get started.',
      `Welcome to ${websiteName}! This is your new Anglesite-powered website.`
    );

    // Add a personalized welcome section
    const welcomeSection = `

## About ${websiteName}

Your new website is ready to go! ${websiteName} is powered by Anglesite and uses Eleventy for static site generation.

### Quick Tips

- This site was created from the Anglesite starter template
- All your content is stored locally on your computer  
- Changes are automatically detected and rebuilt
- You can preview your site instantly in the Anglesite app

## Getting Started

- Edit this markdown file to change the content
- Add more pages by creating new .md files
- Customize the layout in the _includes directory
- Add styles to style.css

Happy building! 🚀`;

    // Replace the existing getting started section
    indexContent = indexContent.replace(/## Getting Started[\s\S]*Happy building! 🚀/, welcomeSection.trim());

    return indexContent;
  }

  /**
   * Sanitize website name for package.json (follows npm naming conventions).
   */
  private sanitizePackageName(websiteName: string): string {
    return websiteName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') // Replace non-alphanumeric chars with dashes
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
      .replace(/-+/g, '-'); // Collapse multiple dashes
  }

  /**
   * Customize the package.json content with website name and dependencies.
   */
  private async customizePackageJson(websiteName: string, packageJsonPath: string): Promise<string> {
    const packageJsonContent = (await this.fileSystem.readFile(packageJsonPath, 'utf8')) as string;
    const packageJson = JSON.parse(packageJsonContent);

    // Sanitize website name for package.json (npm naming conventions)
    const sanitizedName = this.sanitizePackageName(websiteName);

    packageJson.name = sanitizedName;

    // Set up local file path dependencies for development
    if (packageJson.dependencies) {
      // Use file paths to local packages since they're not published to npm yet
      if (packageJson.dependencies['@dwk/anglesite-11ty']) {
        // Use absolute path to anglesite-11ty package
        // Navigate from dist/app/utils to the workspace root
        const workspaceRoot = path.resolve(__dirname, '../../../../');
        const anglesitePackagePath = path.join(workspaceRoot, 'anglesite-11ty');
        packageJson.dependencies['@dwk/anglesite-11ty'] = `file:${anglesitePackagePath}`;
      }
      if (packageJson.dependencies['@dwk/web-components']) {
        // Use absolute path to web-components package
        // Navigate from dist/app/utils to the workspace root
        const workspaceRoot = path.resolve(__dirname, '../../../../');
        const webComponentsPackagePath = path.join(workspaceRoot, 'web-components');
        packageJson.dependencies['@dwk/web-components'] = `file:${webComponentsPackagePath}`;
      }
    }

    return JSON.stringify(packageJson, null, 2);
  }

  /**
   * Run npm install in the website directory.
   */
  private async runNpmInstall(websitePath: string): Promise<void> {
    this.logger.info('Running npm install', { websitePath });

    return new Promise<void>((resolve, reject) => {
      const npmInstall = spawn('npm', ['install'], {
        cwd: websitePath,
        stdio: 'pipe',
      });

      npmInstall.on('close', (code) => {
        if (code === 0) {
          this.logger.debug('npm install completed successfully');
          resolve();
        } else {
          const error = new Error(`npm install failed with code ${code}`);
          this.logger.error('npm install failed', error);
          reject(error);
        }
      });

      npmInstall.on('error', (error) => {
        this.logger.error('npm install process error', error);
        reject(error);
      });
    });
  }

  /**
   * Checks if a website name is valid according to naming rules and character restrictions.
   */
  validateWebsiteName(name: string): {
    valid: boolean;
    error?: string;
  } {
    if (!name || name.trim().length === 0) {
      return { valid: false, error: 'Website name cannot be empty' };
    }

    // SECURITY: Prevent path traversal attacks
    // Check for directory traversal patterns before other validation
    if (name.includes('..')) {
      return {
        valid: false,
        error: 'Website name cannot contain directory traversal patterns (..)',
      };
    }

    // Additional path traversal security check using path resolution
    const websitesDir = this.getWebsitesDirectory();
    const resolvedPath = path.resolve(websitesDir, name);
    const expectedPath = path.join(websitesDir, name);

    // Ensure the resolved path is exactly what we expect (no traversal occurred)
    if (resolvedPath !== expectedPath) {
      return {
        valid: false,
        error: 'Website name contains invalid path characters that could access parent directories',
      };
    }

    // Ensure the resolved path is within the websites directory
    if (!resolvedPath.startsWith(websitesDir + path.sep) && resolvedPath !== websitesDir) {
      return {
        valid: false,
        error: 'Website name would create a path outside the allowed directory',
      };
    }

    // Forbidden characters that are invalid in filesystem folder names across platforms
    // Windows: < > : " | ? * \ /
    // Unix/macOS: / (and \0 null character)
    // Also avoid leading/trailing dots and spaces for consistency
    // eslint-disable-next-line no-control-regex
    const forbiddenChars = /[<>:"|?*\\/\x00]/;

    if (forbiddenChars.test(name)) {
      return {
        valid: false,
        error: 'Website name cannot contain: < > : " | ? * \\ / or null characters',
      };
    }

    // Check for leading/trailing spaces or dots (problematic on Windows)
    if (name !== name.trim()) {
      return {
        valid: false,
        error: 'Website name cannot start or end with spaces',
      };
    }

    if (name.startsWith('.') || name.endsWith('.')) {
      return {
        valid: false,
        error: 'Website name cannot start or end with dots',
      };
    }

    // Check for reserved names on Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reservedNames.test(name)) {
      return {
        valid: false,
        error: 'Website name cannot be a reserved system name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)',
      };
    }

    // Check reasonable length (filesystem dependent but 255 is common max)
    if (name.length > 100) {
      return {
        valid: false,
        error: 'Website name must be 100 characters or less',
      };
    }

    return { valid: true };
  }

  /**
   * Async version of validateWebsiteName that also checks for duplicates.
   * This should be used for website creation validation.
   */
  async validateWebsiteNameAsync(name: string): Promise<{
    valid: boolean;
    error?: string;
  }> {
    // First run the basic validation
    const basicValidation = this.validateWebsiteName(name);
    if (!basicValidation.valid) {
      return basicValidation;
    }

    // Check if website already exists
    const websitesDir = this.getWebsitesDirectory();
    const websitePath = path.join(websitesDir, name);

    if (await this.exists(websitePath)) {
      return {
        valid: false,
        error: `Website "${name}" already exists. Please choose a different name.`,
      };
    }

    return { valid: true };
  }

  /**
   * List all existing websites.
   */
  async listWebsites(): Promise<string[]> {
    const websitesDir = this.getWebsitesDirectory();

    if (!(await this.exists(websitesDir))) {
      return [];
    }

    try {
      const entries = await this.fileSystem.readdir(websitesDir);
      const directories: string[] = [];

      // Filter for directories using stat
      for (const entry of entries) {
        try {
          const entryPath = path.join(websitesDir, entry);
          const stats = await this.fileSystem.stat(entryPath);
          if (stats.isDirectory()) {
            directories.push(entry);
          }
        } catch (error) {
          // Skip entries we can't stat
          this.logger.warn('Failed to stat directory entry', { entry, error });
        }
      }

      return directories;
    } catch (error) {
      this.logger.error('Failed to list websites', error as Error);
      return [];
    }
  }

  /**
   * Delete a website with confirmation dialog.
   */
  async deleteWebsite(websiteName: string, parentWindow?: BrowserWindow): Promise<boolean> {
    this.logger.info('Attempting to delete website', { websiteName });

    const websitesDir = this.getWebsitesDirectory();
    const websitePath = path.join(websitesDir, websiteName);

    if (!(await this.exists(websitePath))) {
      throw new Error(`Website "${websiteName}" does not exist`);
    }

    const dialogOptions = {
      type: 'warning' as const,
      title: 'Delete Website',
      message: `Are you sure you want to delete "${websiteName}"?`,
      detail: 'This action cannot be undone.',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
    };

    // Use the parent window if provided for proper modal behavior
    const result = parentWindow
      ? dialog.showMessageBoxSync(parentWindow, dialogOptions)
      : dialog.showMessageBoxSync(dialogOptions);

    if (result === 1) {
      try {
        await this.fileSystem.rmdir(websitePath, { recursive: true });
        this.logger.info('Website deleted successfully', { websiteName });
        return true;
      } catch (error) {
        this.logger.error('Failed to delete website', error as Error, { websiteName });
        throw error;
      }
    }

    this.logger.debug('Website deletion cancelled by user', { websiteName });
    return false;
  }

  /**
   * Constructs the full file system path for a website given its name.
   */
  getWebsitePath(websiteName: string): string {
    return path.join(this.getWebsitesDirectory(), websiteName);
  }

  /**
   * Rename a website using atomic operations.
   *
   * This function ensures data integrity during the rename operation:
   * - Validates new name before any changes
   * - Creates backup of target if it exists.
   * - Validates successful rename
   * - Automatic rollback on failure
   * - Updates internal references (package.json name).
   */
  async renameWebsite(oldName: string, newName: string): Promise<boolean> {
    this.logger.info('Renaming website', { oldName, newName });

    // Validate the new name
    const validation = this.validateWebsiteName(newName);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid website name');
    }

    const websitesDir = this.getWebsitesDirectory();
    const oldPath = path.join(websitesDir, oldName);
    const newPath = path.join(websitesDir, newName);

    // Pre-validation checks
    if (!(await this.exists(oldPath))) {
      throw new Error(`Website "${oldName}" does not exist`);
    }

    if (await this.exists(newPath)) {
      throw new Error(`Website "${newName}" already exists`);
    }

    // Create atomic transaction for website rename
    const transaction = createAtomicTransaction();

    try {
      // Step 1: Atomically rename the directory
      transaction.addOperation(
        async () => {
          const renameResult = await atomicRename(oldPath, newPath, {
            validate: async (dirPath) => {
              // Validate that the renamed directory has expected structure
              const srcPath = path.join(dirPath, 'src');
              const packageJsonPath = path.join(dirPath, 'package.json');
              return (await this.exists(srcPath)) && (await this.exists(packageJsonPath));
            },
          });

          if (!renameResult.success) {
            throw renameResult.error || new Error('Failed to rename website directory');
          }
        },
        async () => {
          // Rollback: rename back to original if it exists
          if (await this.exists(newPath)) {
            try {
              await this.fileSystem.rename(newPath, oldPath);
            } catch (error) {
              this.logger.error('Failed to rollback directory rename', error as Error);
            }
          }
        }
      );

      // Step 2: Update package.json with new website name
      const packageJsonPath = path.join(newPath, 'package.json');
      if (await this.exists(packageJsonPath)) {
        transaction.addOperation(
          async () => {
            const packageJsonContent = (await this.fileSystem.readFile(packageJsonPath, 'utf8')) as string;
            const packageJson = JSON.parse(packageJsonContent);
            packageJson.name = this.sanitizePackageName(newName);

            const writeResult = await atomicWriteFile(packageJsonPath, JSON.stringify(packageJson, null, 2), {
              validate: (content) => {
                try {
                  const parsed = JSON.parse(content);
                  return parsed.name === this.sanitizePackageName(newName);
                } catch {
                  return false;
                }
              },
              backup: true,
            });

            if (!writeResult.success) {
              throw writeResult.error || new Error('Failed to update package.json with new name');
            }
          },
          async () => {
            // Rollback: restore original package.json
            const backupPath = `${packageJsonPath}.backup.${Date.now()}`;
            if (await this.exists(backupPath)) {
              try {
                await this.fileSystem.rename(backupPath, packageJsonPath);
              } catch (error) {
                this.logger.error('Failed to restore package.json backup', error as Error);
              }
            }
          }
        );
      }

      // Step 3: Update any internal file references to the old website name
      transaction.addOperation(
        async () => {
          await this.updateInternalReferences(newPath, oldName, newName);
        },
        async () => {
          // Rollback: restore original references
          try {
            await this.updateInternalReferences(newPath, newName, oldName);
          } catch (error) {
            this.logger.error('Failed to rollback internal references', error as Error);
          }
        }
      );

      // Execute the transaction
      const result = await transaction.execute();

      if (!result.success) {
        throw result.error || new Error('Website rename transaction failed');
      }

      this.logger.info('Website renamed successfully', { oldName, newName });
      return true;
    } catch (error) {
      this.logger.error('Failed to rename website', error as Error, { oldName, newName });
      throw error;
    }
  }

  /**
   * Update internal references to website name in files.
   */
  private async updateInternalReferences(websitePath: string, oldName: string, newName: string): Promise<void> {
    // Update title in index.md if it contains the old name
    const indexPath = path.join(websitePath, 'src', 'index.md');
    if (await this.exists(indexPath)) {
      const content = (await this.fileSystem.readFile(indexPath, 'utf8')) as string;
      if (content.includes(oldName)) {
        const updatedContent = content
          .replace(new RegExp(`Welcome to ${oldName}!`, 'g'), `Welcome to ${newName}!`)
          .replace(new RegExp(`About ${oldName}`, 'g'), `About ${newName}`)
          .replace(new RegExp(`${oldName} is powered by`, 'g'), `${newName} is powered by`);

        if (updatedContent !== content) {
          const writeResult = await atomicWriteFile(indexPath, updatedContent, { backup: true });
          if (!writeResult.success) {
            throw writeResult.error || new Error('Failed to update index.md references');
          }
        }
      }
    }
  }

  /**
   * Check if a website exists.
   */
  async websiteExists(websiteName: string): Promise<boolean> {
    const websitePath = this.getWebsitePath(websiteName);
    return await this.exists(websitePath);
  }

  /**
   * Dispose of the website manager service.
   */
  async dispose(): Promise<void> {
    this.logger.debug('Disposing WebsiteManager service');
    // No cleanup needed for this service currently
  }
}

/**
 * Factory function for creating WebsiteManager with proper dependencies.
 */
export function createWebsiteManager(
  logger: ILogger,
  fileSystem: IFileSystem,
  atomicOperations: IAtomicOperations
): IWebsiteManager {
  return WebsiteManager.create(logger, fileSystem, atomicOperations);
}

/**
 * Type guard to check if an object is a website manager.
 */
export function isWebsiteManager(obj: unknown): obj is WebsiteManager {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof (obj as WebsiteManager).createWebsite === 'function' &&
    typeof (obj as WebsiteManager).deleteWebsite === 'function' &&
    typeof (obj as WebsiteManager).listWebsites === 'function' &&
    typeof (obj as WebsiteManager).validateWebsiteName === 'function' &&
    typeof (obj as WebsiteManager).dispose === 'function'
  );
}

// Legacy exports for backward compatibility during transition period
// These should be removed once all consumers are updated to use DI

/**
 * @deprecated Use WebsiteManager service through DI container instead
 * This is kept as a fallback for when DI is not yet initialized.
 */
export async function createWebsiteWithName(websiteName: string): Promise<string> {
  console.warn('Using deprecated createWebsiteWithName - DI not available');
  // Create a temporary instance for fallback
  const logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    child: () => logger,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fileSystem = new FileSystemService();
  const atomicOps = createStubAtomicOperations(fileSystem);
  const manager = new WebsiteManager(logger, fileSystem, atomicOps);
  return manager.createWebsite(websiteName);
}

/**
 * @deprecated Use WebsiteManager service through DI container instead
 * This is kept as a fallback for when DI is not yet initialized.
 */
export function validateWebsiteName(name: string): { valid: boolean; error?: string } {
  console.warn('Using deprecated validateWebsiteName - DI not available');
  // Create a temporary instance for fallback
  const logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    child: () => logger,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fileSystem = new FileSystemService();
  const atomicOps = createStubAtomicOperations(fileSystem);
  const manager = new WebsiteManager(logger, fileSystem, atomicOps);
  return manager.validateWebsiteName(name);
}

/**
 * @deprecated Use WebsiteManager service through DI container instead
 * This is kept as a fallback for when DI is not yet initialized.
 */
export async function validateWebsiteNameAsync(name: string): Promise<{ valid: boolean; error?: string }> {
  console.warn('Using deprecated validateWebsiteNameAsync - DI not available');
  // Create a temporary instance for fallback
  const logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    child: () => logger,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fileSystem = new FileSystemService();
  const atomicOps = createStubAtomicOperations(fileSystem);
  const manager = new WebsiteManager(logger, fileSystem, atomicOps);
  return manager.validateWebsiteNameAsync(name);
}

/**
 * @deprecated Use WebsiteManager service through DI container instead
 * This is kept as a fallback for when DI is not yet initialized.
 */
export async function listWebsites(): Promise<string[]> {
  console.warn('Using deprecated listWebsites - DI not available');
  // Create a temporary instance for fallback
  const logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    child: () => logger,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fileSystem = new FileSystemService();
  const atomicOps = createStubAtomicOperations(fileSystem);
  const manager = new WebsiteManager(logger, fileSystem, atomicOps);
  return manager.listWebsites();
}

/**
 * @deprecated Use WebsiteManager service through DI container instead
 * This is kept as a fallback for when DI is not yet initialized.
 */
export function getWebsitePath(websiteName: string): string {
  console.warn('Using deprecated getWebsitePath - DI not available');
  // Create a temporary instance for fallback
  const logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    child: () => logger,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fileSystem = new FileSystemService();
  const atomicOps = createStubAtomicOperations(fileSystem);
  const manager = new WebsiteManager(logger, fileSystem, atomicOps);
  return manager.getWebsitePath(websiteName);
}

/**
 * @deprecated Use WebsiteManager service through DI container instead
 * This is kept as a fallback for when DI is not yet initialized.
 */
export async function renameWebsite(oldName: string, newName: string): Promise<boolean> {
  console.warn('Using deprecated renameWebsite - DI not available');
  // Create a temporary instance for fallback
  const logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    child: () => logger,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fileSystem = new FileSystemService();
  const atomicOps = createStubAtomicOperations(fileSystem);
  const manager = new WebsiteManager(logger, fileSystem, atomicOps);
  return manager.renameWebsite(oldName, newName);
}

/**
 * @deprecated Use WebsiteManager service through DI container instead
 * This is kept as a fallback for when DI is not yet initialized.
 */
export async function deleteWebsite(websiteName: string): Promise<boolean> {
  console.warn('Using deprecated deleteWebsite - DI not available');
  // Create a temporary instance for fallback
  const logger = {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
    child: () => logger,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fileSystem = new FileSystemService();
  const atomicOps = createStubAtomicOperations(fileSystem);
  const manager = new WebsiteManager(logger, fileSystem, atomicOps);
  return manager.deleteWebsite(websiteName);
}
