/**
 * @file Website Bundling Service
 * 
 * Service for creating and extracting Anglesite website bundles (.anglesite files).
 * Bundles are ZIP archives with standardized structure and metadata that work
 * across all operating systems.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import * as crypto from 'crypto';
import { ILogger, IFileSystem, IWebsiteManager } from '../core/interfaces';
import { ErrorUtils } from '../core/errors';

export interface AnglesiteBundleMetadata {
  version: string;           // Bundle format version (e.g., "1.0.0")
  websiteName: string;       // Original website name
  createdAt: string;         // ISO timestamp
  createdBy: {
    anglesite: string;       // Anglesite version
    platform: string;       // Creator's OS
    user: string;           // System username
  };
  website: {
    title: string;           // Website title from metadata
    description?: string;    // Website description
    dependencies: {          // Package dependencies
      [key: string]: string;
    };
  };
  bundleType: 'source' | 'built' | 'both';  // What's included
  checksum: string;          // Bundle integrity check (SHA-256)
}

export interface BundleManifest {
  files: Array<{
    path: string;            // Relative path in bundle
    size: number;            // File size in bytes
    checksum: string;        // SHA-256 of file content
    lastModified: string;    // ISO timestamp
  }>;
  totalSize: number;         // Total bundle size
  fileCount: number;         // Total file count
}

export interface BundleCreationOptions {
  includeSource: boolean;    // Include source files
  includeBuilt: boolean;     // Include built files
  excludePatterns?: string[]; // Glob patterns to exclude
  buildBeforeBundling?: boolean; // Build the site first
}

export interface BundleExtractionOptions {
  targetDirectory: string;   // Where to extract the bundle
  overwriteExisting?: boolean; // Overwrite existing files
  validateChecksum?: boolean;  // Verify file integrity
}

/**
 * Service for creating and managing Anglesite website bundles.
 */
export class WebsiteBundler {
  private readonly logger: ILogger;
  private readonly BUNDLE_FORMAT_VERSION = '1.0.0';

  constructor(
    logger: ILogger,
    private readonly fileSystem: IFileSystem,
    private readonly websiteManager: IWebsiteManager
  ) {
    this.logger = logger.child({ service: 'WebsiteBundler' });
  }

  /**
   * Create a bundle from a website.
   */
  async createBundle(
    websiteName: string, 
    outputPath: string,
    options: BundleCreationOptions = { includeSource: true, includeBuilt: false }
  ): Promise<void> {
    this.logger.info('Creating website bundle', { websiteName, outputPath, options });

    const websitePath = this.websiteManager.getWebsitePath(websiteName);
    
    // Verify website exists
    if (!(await this.fileSystem.exists(websitePath))) {
      throw new Error(`Website "${websiteName}" not found at ${websitePath}`);
    }

    // Create temporary directory for bundle preparation
    const tempDir = await this.createTempDirectory();
    
    try {
      // Build the website if requested
      if (options.buildBeforeBundling && options.includeBuilt) {
        await this.buildWebsite(websitePath, tempDir);
      }

      // Prepare bundle contents
      const bundleContents = await this.prepareBundleContents(
        websitePath, 
        tempDir, 
        options
      );

      // Create manifest
      const manifest = await this.createManifest(bundleContents);

      // Create metadata with checksum
      const metadata = await this.createMetadata(websiteName, websitePath, options);
      metadata.checksum = this.calculateBundleChecksum(manifest);

      // Create the bundle archive
      await this.createBundleArchive(
        bundleContents,
        metadata,
        manifest,
        outputPath
      );

      this.logger.info('Bundle created successfully', { 
        websiteName, 
        outputPath,
        fileCount: manifest.fileCount,
        totalSize: manifest.totalSize 
      });

    } finally {
      // Clean up temporary directory
      await this.cleanupTempDirectory(tempDir);
    }
  }

  /**
   * Extract a bundle to a directory.
   */
  async extractBundle(
    bundlePath: string,
    options: BundleExtractionOptions
  ): Promise<AnglesiteBundleMetadata> {
    this.logger.info('Extracting website bundle', { bundlePath, options });

    if (!(await this.fileSystem.exists(bundlePath))) {
      throw new Error(`Bundle file not found: ${bundlePath}`);
    }

    // Create target directory if it doesn't exist
    if (!(await this.fileSystem.exists(options.targetDirectory))) {
      await this.fileSystem.mkdir(options.targetDirectory, { recursive: true });
    }

    // Extract bundle and validate
    const metadata = await this.extractBundleArchive(bundlePath, options);

    this.logger.info('Bundle extracted successfully', { 
      bundlePath,
      websiteName: metadata.websiteName,
      targetDirectory: options.targetDirectory 
    });

    return metadata;
  }

  /**
   * Validate a bundle file without extracting it.
   */
  async validateBundle(bundlePath: string): Promise<{
    valid: boolean;
    metadata?: AnglesiteBundleMetadata;
    error?: string;
  }> {
    try {
      this.logger.debug('Validating bundle', { bundlePath });

      if (!(await this.fileSystem.exists(bundlePath))) {
        return { valid: false, error: 'Bundle file not found' };
      }

      const stats = await this.fileSystem.stat(bundlePath);
      if (stats.size === 0) {
        return { valid: false, error: 'Bundle file is empty' };
      }

      // Validate ZIP structure and read metadata
      return new Promise((resolve) => {
        yauzl.open(bundlePath, { lazyEntries: true }, (err, zipfile) => {
          if (err) {
            resolve({ valid: false, error: `Invalid ZIP file: ${err.message}` });
            return;
          }

          if (!zipfile) {
            resolve({ valid: false, error: 'Failed to open ZIP file' });
            return;
          }

          let hasMetadata = false;
          let metadata: AnglesiteBundleMetadata | undefined;
          let hasManifest = false;
          let hasSourceOrBuilt = false;

          zipfile.readEntry();

          zipfile.on('entry', (entry: yauzl.Entry) => {
            const fileName = entry.fileName;

            if (fileName === 'metadata.json') {
              hasMetadata = true;
              // Try to read and parse metadata
              zipfile.openReadStream(entry, (streamErr, readStream) => {
                if (streamErr || !readStream) {
                  zipfile.readEntry();
                  return;
                }

                let metadataContent = '';
                readStream.on('data', (chunk) => {
                  metadataContent += chunk.toString();
                });

                readStream.on('end', () => {
                  try {
                    metadata = JSON.parse(metadataContent);
                    
                    // Validate metadata structure
                    if (!metadata?.version || !metadata?.websiteName || !metadata?.createdAt) {
                      resolve({ 
                        valid: false, 
                        error: 'Invalid bundle metadata - missing required fields' 
                      });
                      return;
                    }

                    // Check format version compatibility
                    if (metadata.version !== this.BUNDLE_FORMAT_VERSION) {
                      this.logger.warn('Bundle format version mismatch', {
                        expected: this.BUNDLE_FORMAT_VERSION,
                        actual: metadata.version
                      });
                      // For now, still accept it but log a warning
                    }
                  } catch (parseError) {
                    resolve({ 
                      valid: false, 
                      error: 'Invalid metadata JSON format' 
                    });
                    return;
                  }
                  zipfile.readEntry();
                });

                readStream.on('error', () => {
                  resolve({ 
                    valid: false, 
                    error: 'Failed to read metadata content' 
                  });
                });
              });
              return;
            }

            if (fileName === 'manifest.json') {
              hasManifest = true;
            }

            if (fileName.startsWith('source/') || fileName.startsWith('built/')) {
              hasSourceOrBuilt = true;
            }

            zipfile.readEntry();
          });

          zipfile.on('end', () => {
            if (!hasMetadata) {
              resolve({ valid: false, error: 'Bundle missing required metadata.json' });
              return;
            }

            if (!hasSourceOrBuilt) {
              resolve({ valid: false, error: 'Bundle contains no source or built files' });
              return;
            }

            resolve({ 
              valid: true, 
              metadata,
              ...(hasManifest ? {} : { error: 'Bundle missing manifest.json (non-fatal)' })
            });
          });

          zipfile.on('error', (zipError) => {
            resolve({ valid: false, error: `ZIP file error: ${zipError.message}` });
          });
        });
      });

    } catch (error) {
      this.logger.error('Bundle validation failed', error as Error);
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Unknown validation error' 
      };
    }
  }

  /**
   * Create a temporary directory for bundle operations.
   */
  private async createTempDirectory(): Promise<string> {
    const tempBase = os.tmpdir();
    const uniqueId = `anglesite-bundle-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const tempDir = path.join(tempBase, uniqueId);
    
    await this.fileSystem.mkdir(tempDir, { recursive: true });
    
    return tempDir;
  }

  /**
   * Clean up temporary directory.
   */
  private async cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
      if (await this.fileSystem.exists(tempDir)) {
        await this.fileSystem.rmdir(tempDir, { recursive: true });
      }
    } catch (error) {
      this.logger.warn('Failed to clean up temporary directory', { tempDir, error });
    }
  }

  /**
   * Build the website using Eleventy.
   */
  private async buildWebsite(websitePath: string, tempDir: string): Promise<void> {
    // This would integrate with the existing Eleventy build system
    // For now, this is a placeholder
    this.logger.debug('Building website', { websitePath, tempDir });
    
    // TODO: Implement Eleventy build integration
    // Could reuse code from src/main/ipc/export.ts
  }

  /**
   * Prepare bundle contents in temporary directory.
   */
  private async prepareBundleContents(
    websitePath: string,
    tempDir: string,
    options: BundleCreationOptions
  ): Promise<{
    sourceDir?: string;
    builtDir?: string;
  }> {
    const contents: { sourceDir?: string; builtDir?: string } = {};

    if (options.includeSource) {
      const sourceDir = path.join(tempDir, 'source');
      await this.copyWebsiteSource(websitePath, sourceDir, options.excludePatterns);
      contents.sourceDir = sourceDir;
    }

    if (options.includeBuilt) {
      // Built files would be in tempDir from buildWebsite step
      const builtDir = path.join(tempDir, 'built');
      if (await this.fileSystem.exists(builtDir)) {
        contents.builtDir = builtDir;
      }
    }

    return contents;
  }

  /**
   * Copy website source files to bundle directory.
   */
  private async copyWebsiteSource(
    sourcePath: string,
    targetPath: string,
    excludePatterns: string[] = []
  ): Promise<void> {
    await this.fileSystem.mkdir(targetPath, { recursive: true });

    const defaultExcludes = [
      'node_modules/**',
      '_site/**',
      'dist/**',
      '.git/**',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.tmp'
    ];

    const allExcludes = [...defaultExcludes, ...(excludePatterns || [])];

    await this.copyDirectoryRecursive(sourcePath, targetPath, allExcludes);
  }

  /**
   * Recursively copy directory with exclusion patterns.
   */
  private async copyDirectoryRecursive(
    source: string,
    target: string,
    excludePatterns: string[]
  ): Promise<void> {
    const entries = await this.fileSystem.readdir(source);

    for (const entry of entries) {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);
      
      // Check if this path should be excluded
      const relativePath = path.relative(source, sourcePath);
      const shouldExclude = excludePatterns.some(pattern => {
        // Simple pattern matching - could be enhanced with proper glob support
        if (pattern.endsWith('/**')) {
          const dirPattern = pattern.slice(0, -3);
          return relativePath.startsWith(dirPattern);
        }
        if (pattern.startsWith('**/')) {
          const filePattern = pattern.slice(3);
          return relativePath.includes(filePattern) || entry === filePattern;
        }
        return relativePath === pattern || entry === pattern;
      });

      if (shouldExclude) {
        continue;
      }

      const stats = await this.fileSystem.stat(sourcePath);
      
      if (stats.isDirectory()) {
        await this.fileSystem.mkdir(targetPath, { recursive: true });
        await this.copyDirectoryRecursive(sourcePath, targetPath, excludePatterns);
      } else {
        await this.fileSystem.copyFile(sourcePath, targetPath);
      }
    }
  }

  /**
   * Create bundle metadata.
   */
  private async createMetadata(
    websiteName: string,
    websitePath: string,
    options: BundleCreationOptions
  ): Promise<AnglesiteBundleMetadata> {
    // Read package.json for website info
    const packageJsonPath = path.join(websitePath, 'package.json');
    let websiteInfo = {
      title: websiteName,
      description: undefined as string | undefined,
      dependencies: {} as { [key: string]: string }
    };

    if (await this.fileSystem.exists(packageJsonPath)) {
      try {
        const packageContent = await this.fileSystem.readFile(packageJsonPath, 'utf8') as string;
        const packageData = JSON.parse(packageContent);
        
        websiteInfo = {
          title: packageData.name || websiteName,
          description: packageData.description,
          dependencies: packageData.dependencies || {}
        };
      } catch (error) {
        this.logger.warn('Failed to read website package.json', { websitePath, error });
      }
    }

    // Get Anglesite version
    let anglesiteVersion = '0.1.0';
    try {
      const appPackagePath = path.join(__dirname, '../../package.json');
      if (await this.fileSystem.exists(appPackagePath)) {
        const appPackageContent = await this.fileSystem.readFile(appPackagePath, 'utf8') as string;
        const appPackageData = JSON.parse(appPackageContent);
        anglesiteVersion = appPackageData.version || '0.1.0';
      }
    } catch (error) {
      this.logger.debug('Could not determine Anglesite version', { error });
    }

    const bundleType = options.includeSource && options.includeBuilt ? 'both' :
                      options.includeBuilt ? 'built' : 'source';

    const metadata: AnglesiteBundleMetadata = {
      version: this.BUNDLE_FORMAT_VERSION,
      websiteName,
      createdAt: new Date().toISOString(),
      createdBy: {
        anglesite: anglesiteVersion,
        platform: `${os.type()} ${os.release()}`,
        user: os.userInfo().username
      },
      website: websiteInfo,
      bundleType,
      checksum: '' // Will be calculated later
    };

    return metadata;
  }

  /**
   * Create bundle manifest with file information.
   */
  private async createManifest(
    bundleContents: { sourceDir?: string; builtDir?: string }
  ): Promise<BundleManifest> {
    const files: BundleManifest['files'] = [];
    let totalSize = 0;

    // Process source files
    if (bundleContents.sourceDir) {
      const sourceFiles = await this.getFileManifest(bundleContents.sourceDir, 'source');
      files.push(...sourceFiles);
    }

    // Process built files
    if (bundleContents.builtDir) {
      const builtFiles = await this.getFileManifest(bundleContents.builtDir, 'built');
      files.push(...builtFiles);
    }

    totalSize = files.reduce((sum, file) => sum + file.size, 0);

    return {
      files,
      totalSize,
      fileCount: files.length
    };
  }

  /**
   * Get file manifest for a directory.
   */
  private async getFileManifest(
    directory: string, 
    prefix: string
  ): Promise<BundleManifest['files']> {
    const files: BundleManifest['files'] = [];

    const processDirectory = async (dir: string, basePath: string = '') => {
      const entries = await this.fileSystem.readdir(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relativePath = path.join(basePath, entry);
        const bundlePath = path.join(prefix, relativePath).replace(/\\/g, '/'); // Normalize path separators
        
        const stats = await this.fileSystem.stat(fullPath);

        if (stats.isFile()) {
          const content = await this.fileSystem.readFile(fullPath);
          const checksum = crypto
            .createHash('sha256')
            .update(content)
            .digest('hex');

          files.push({
            path: bundlePath,
            size: stats.size,
            checksum,
            lastModified: stats.mtime.toISOString()
          });
        } else if (stats.isDirectory()) {
          await processDirectory(fullPath, relativePath);
        }
      }
    };

    await processDirectory(directory);
    return files;
  }

  /**
   * Create the final bundle archive.
   */
  private async createBundleArchive(
    bundleContents: { sourceDir?: string; builtDir?: string },
    metadata: AnglesiteBundleMetadata,
    manifest: BundleManifest,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { 
        zlib: { level: 9 }, // Best compression
        forceLocalTime: true
      });

      output.on('close', () => {
        this.logger.debug('Bundle archive created', { 
          outputPath, 
          size: archive.pointer() 
        });
        resolve();
      });

      archive.on('error', (err: Error) => {
        this.logger.error('Bundle archive creation failed', err);
        reject(err);
      });

      archive.pipe(output);

      // Add metadata and manifest
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // Add source files
      if (bundleContents.sourceDir) {
        archive.directory(bundleContents.sourceDir, 'source');
      }

      // Add built files
      if (bundleContents.builtDir) {
        archive.directory(bundleContents.builtDir, 'built');
      }

      archive.finalize();
    });
  }

  /**
   * Extract bundle archive using yauzl.
   */
  private async extractBundleArchive(
    bundlePath: string,
    options: BundleExtractionOptions
  ): Promise<AnglesiteBundleMetadata> {
    return new Promise((resolve, reject) => {
      yauzl.open(bundlePath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(new Error(`Failed to open bundle: ${err.message}`));
          return;
        }

        if (!zipfile) {
          reject(new Error('Failed to open bundle: Invalid ZIP file'));
          return;
        }

        let metadata: AnglesiteBundleMetadata | null = null;
        let manifest: BundleManifest | null = null;
        const extractedFiles: string[] = [];
        let pendingExtractions = 0;
        let finishedReading = false;

        const checkCompletion = () => {
          if (finishedReading && pendingExtractions === 0) {
            if (metadata) {
              this.logger.info('Bundle extraction completed', {
                websiteName: metadata.websiteName,
                fileCount: extractedFiles.length
              });
              resolve(metadata);
            } else {
              reject(new Error('Bundle metadata not found'));
            }
          }
        };

        zipfile.readEntry();

        zipfile.on('entry', (entry: yauzl.Entry) => {
          const fileName = entry.fileName;
          
          // Handle directory entries
          if (fileName.endsWith('/')) {
            // Create directory
            const dirPath = path.join(options.targetDirectory, fileName);
            fs.mkdirSync(dirPath, { recursive: true });
            zipfile.readEntry();
            return;
          }

          // Handle metadata.json
          if (fileName === 'metadata.json') {
            pendingExtractions++;
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                reject(new Error(`Failed to read metadata: ${err.message}`));
                return;
              }

              if (!readStream) {
                pendingExtractions--;
                checkCompletion();
                return;
              }

              let metadataContent = '';
              readStream.on('data', (chunk) => {
                metadataContent += chunk.toString();
              });

              readStream.on('end', () => {
                try {
                  metadata = JSON.parse(metadataContent);
                  this.logger.debug('Bundle metadata loaded', { websiteName: metadata?.websiteName });
                } catch (parseError) {
                  reject(new Error('Invalid bundle metadata format'));
                  return;
                }
                pendingExtractions--;
                checkCompletion();
              });

              readStream.on('error', (streamError) => {
                reject(new Error(`Failed to read metadata stream: ${streamError.message}`));
              });
            });
            zipfile.readEntry();
            return;
          }

          // Handle manifest.json
          if (fileName === 'manifest.json') {
            pendingExtractions++;
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                this.logger.warn('Failed to read manifest', { error: err.message });
                pendingExtractions--;
                checkCompletion();
                zipfile.readEntry();
                return;
              }

              if (!readStream) {
                pendingExtractions--;
                checkCompletion();
                zipfile.readEntry();
                return;
              }

              let manifestContent = '';
              readStream.on('data', (chunk) => {
                manifestContent += chunk.toString();
              });

              readStream.on('end', () => {
                try {
                  manifest = JSON.parse(manifestContent);
                  this.logger.debug('Bundle manifest loaded', { fileCount: manifest?.fileCount });
                } catch (parseError) {
                  this.logger.warn('Invalid manifest format', { error: parseError });
                }
                pendingExtractions--;
                checkCompletion();
              });

              readStream.on('error', (streamError) => {
                this.logger.warn('Failed to read manifest stream', { error: streamError.message });
                pendingExtractions--;
                checkCompletion();
              });
            });
            zipfile.readEntry();
            return;
          }

          // Handle regular files (source/ or built/ directories)
          if (fileName.startsWith('source/') || fileName.startsWith('built/')) {
            const relativePath = fileName.startsWith('source/') 
              ? fileName.substring('source/'.length) 
              : fileName.substring('built/'.length);
            
            const targetPath = path.join(options.targetDirectory, relativePath);
            const targetDir = path.dirname(targetPath);

            // Create target directory
            fs.mkdirSync(targetDir, { recursive: true });

            // Check if file exists and handle overwrite option
            if (fs.existsSync(targetPath) && !options.overwriteExisting) {
              this.logger.warn('File already exists, skipping', { targetPath });
              zipfile.readEntry();
              return;
            }

            pendingExtractions++;
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                this.logger.error('Failed to extract file', err, { fileName });
                pendingExtractions--;
                checkCompletion();
                zipfile.readEntry();
                return;
              }

              if (!readStream) {
                pendingExtractions--;
                checkCompletion();
                zipfile.readEntry();
                return;
              }

              const writeStream = fs.createWriteStream(targetPath);
              
              writeStream.on('finish', () => {
                extractedFiles.push(targetPath);
                
                // Validate checksum if requested and manifest is available
                if (options.validateChecksum && manifest) {
                  const expectedFile = manifest.files.find(f => 
                    f.path === fileName || f.path === `source/${relativePath}` || f.path === `built/${relativePath}`
                  );
                  
                  if (expectedFile) {
                    try {
                      const fileContent = fs.readFileSync(targetPath);
                      const actualChecksum = crypto
                        .createHash('sha256')
                        .update(fileContent)
                        .digest('hex');
                      
                      if (actualChecksum !== expectedFile.checksum) {
                        this.logger.warn('File checksum mismatch', { 
                          targetPath, 
                          expected: expectedFile.checksum, 
                          actual: actualChecksum 
                        });
                      }
                    } catch (checksumError) {
                      this.logger.warn('Failed to validate file checksum', { 
                        targetPath, 
                        error: checksumError 
                      });
                    }
                  }
                }

                pendingExtractions--;
                checkCompletion();
              });

              writeStream.on('error', (writeError) => {
                this.logger.error('Failed to write extracted file', writeError, { 
                  targetPath
                });
                pendingExtractions--;
                checkCompletion();
              });

              readStream.pipe(writeStream);
            });
          }

          zipfile.readEntry();
        });

        zipfile.on('end', () => {
          finishedReading = true;
          checkCompletion();
        });

        zipfile.on('error', (zipError) => {
          reject(new Error(`ZIP file error: ${zipError.message}`));
        });
      });
    });
  }

  /**
   * Calculate SHA-256 checksum of bundle contents.
   */
  private calculateBundleChecksum(manifest: BundleManifest): string {
    const checksumData = manifest.files
      .map(file => `${file.path}:${file.checksum}:${file.size}`)
      .sort()
      .join('\n');

    return crypto
      .createHash('sha256')
      .update(checksumData)
      .digest('hex');
  }

  /**
   * Dispose of the bundler service.
   */
  async dispose(): Promise<void> {
    this.logger.debug('Disposing WebsiteBundler service');
  }
}

/**
 * Factory function for creating WebsiteBundler with dependencies.
 */
export function createWebsiteBundler(
  logger: ILogger,
  fileSystem: IFileSystem,
  websiteManager: IWebsiteManager
): WebsiteBundler {
  return new WebsiteBundler(logger, fileSystem, websiteManager);
}