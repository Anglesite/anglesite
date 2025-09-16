/**
 * @file Eleventy URL resolver for mapping files to their output URLs
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import * as chokidar from 'chokidar';

export interface FileUrlMapping {
  filePath: string;
  url: string;
  isDirectory: boolean;
}

export class EleventyUrlResolver {
  private urlMap = new Map<string, string>();
  private watcher: chokidar.FSWatcher | null = null;
  private inputDir: string;

  constructor(inputDir: string) {
    this.inputDir = path.resolve(inputDir);
  }

  /**
   * Initialize the URL resolver with file system watching functionality.
   */
  async initialize(): Promise<void> {
    console.log(`Initializing URL resolver for directory: ${this.inputDir}`);
    await this.buildUrlMap();
    this.setupWatcher();
    console.log(`URL resolver initialization complete for ${this.inputDir}`);
  }

  /**
   * Stop watching and clean up file system resources.
   */
  destroy(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Build initial URL mapping for all content files in the input directory.
   */
  private async buildUrlMap(): Promise<void> {
    try {
      // Find all content files that Eleventy would process
      const patterns = [
        '**/*.md',
        '**/*.html',
        '**/*.njk',
        '**/*.liquid',
        '**/*.hbs',
        '**/*.mustache',
        '**/*.ejs',
        '**/*.haml',
        '**/*.pug',
        '**/*.jstl',
      ];

      const files = await glob(patterns, {
        cwd: this.inputDir,
        ignore: ['node_modules/**', '_site/**', '.git/**'],
        absolute: true,
      });

      for (const file of files) {
        const url = this.calculateEleventyUrl(file);
        this.urlMap.set(file, url);
      }

      console.log(`Built URL map for ${files.length} files in ${this.inputDir}`);
    } catch (error) {
      console.error('Error building URL map:', error);
    }
  }

  /**
   * Set up file system watcher for real-time URL mapping updates.
   */
  private setupWatcher(): void {
    this.watcher = chokidar.watch(this.inputDir, {
      ignored: [/node_modules/, /_site/, /\.git/, /\.DS_Store/],
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', (filePath) => {
      if (this.isContentFile(filePath)) {
        const url = this.calculateEleventyUrl(filePath);
        this.urlMap.set(filePath, url);
        if (process.env.NODE_ENV === 'development') {
          console.log(`Added URL mapping: ${filePath} → ${url}`);
        }
      }
    });

    this.watcher.on('unlink', (filePath) => {
      if (this.urlMap.has(filePath)) {
        this.urlMap.delete(filePath);
        if (process.env.NODE_ENV === 'development') {
          console.log(`Removed URL mapping: ${filePath}`);
        }
      }
    });

    this.watcher.on('change', () => {
      // URL doesn't change on file content change, but we could emit events here
    });
  }

  /**
   * Check if a file is a content file that Eleventy would process.
   */
  isContentFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    const contentExtensions = [
      '.md',
      '.html',
      '.njk',
      '.liquid',
      '.hbs',
      '.mustache',
      '.ejs',
      '.haml',
      '.pug',
      '.jstl',
    ];
    return contentExtensions.includes(ext);
  }

  /**
   * Calculate the output URL for a given file path based on Eleventy's rules.
   */
  calculateEleventyUrl(filePath: string): string {
    // Make path relative to input directory
    let relativePath = path.relative(this.inputDir, filePath);
    // Normalize path separators for URLs
    relativePath = relativePath.replace(/\\/g, '/');

    // Remove file extension and replace with .html for content files
    const ext = path.extname(relativePath);
    const basePath = relativePath.slice(0, -ext.length);

    // Handle different file types
    let urlPath: string;
    if (['.md', '.njk', '.liquid', '.hbs', '.mustache', '.ejs', '.haml', '.pug', '.jstl'].includes(ext)) {
      urlPath = basePath + '.html';
    } else if (ext === '.html') {
      urlPath = relativePath; // Keep .html for now, handle index files first
    } else {
      // For other files, keep as-is (like assets)
      urlPath = relativePath;
    }

    // Handle index files first (before removing .html extension)
    if (urlPath.endsWith('/index.html')) {
      urlPath = urlPath.slice(0, -10); // Remove 'index.html'
    } else if (urlPath === 'index.html') {
      urlPath = '';
    } else if (ext === '.html') {
      // For non-index HTML files, use pretty URLs (remove .html extension)
      urlPath = urlPath.replace(/\.html$/, '');
    }

    // Ensure URL starts with /
    if (urlPath && !urlPath.startsWith('/')) {
      urlPath = '/' + urlPath;
    } else if (!urlPath) {
      urlPath = '/';
    }

    return urlPath;
  }

  /**
   * Manually add a file to the URL map for newly created files.
   */
  addFileMapping(filePath: string): string | null {
    if (this.isContentFile(filePath)) {
      const resolvedPath = path.resolve(filePath);
      const url = this.calculateEleventyUrl(filePath);
      this.urlMap.set(resolvedPath, url);
      if (process.env.NODE_ENV === 'development') {
        console.log(`Manually added URL mapping: ${filePath} → ${url}`);
      }
      return url;
    }
    return null;
  }

  /**
   * Get the URL for a specific file path.
   */
  getUrlForFile(filePath: string): string | null {
    const resolvedPath = path.resolve(filePath);
    const mappedUrl = this.urlMap.get(resolvedPath);

    if (mappedUrl) {
      return mappedUrl;
    }

    // If no mapping exists (e.g., for newly created files),
    // calculate the URL based on Eleventy's rules as a fallback
    if (this.isContentFile(filePath)) {
      const calculatedUrl = this.calculateEleventyUrl(filePath);
      if (process.env.NODE_ENV === 'development') {
        console.log(`Calculated fallback URL for ${filePath}: ${calculatedUrl}`);
      }
      return calculatedUrl;
    }

    return null;
  }

  /**
   * Get the file path for a specific URL.
   */
  getFileForUrl(url: string): string | null {
    for (const [filePath, fileUrl] of Array.from(this.urlMap.entries())) {
      if (fileUrl === url) {
        return filePath;
      }
    }
    return null;
  }

  /**
   * Get all file-to-URL mappings.
   */
  getAllMappings(): FileUrlMapping[] {
    const mappings: FileUrlMapping[] = [];

    for (const [filePath, url] of Array.from(this.urlMap.entries())) {
      mappings.push({
        filePath,
        url,
        isDirectory: false,
      });
    }

    return mappings.sort((a, b) => a.url.localeCompare(b.url));
  }

  /**
   * Get all files in the input directory with their URLs.
   */
  async getFileTree(): Promise<FileUrlMapping[]> {
    const allFiles: FileUrlMapping[] = [];

    try {
      console.log(`Building file tree for directory: ${this.inputDir}`);
      await this.addDirectoryToTree(this.inputDir, '', allFiles);
      console.log(`File tree built successfully. Found ${allFiles.length} files/directories.`);

      // Log a few example files for debugging
      if (allFiles.length > 0) {
        console.log(
          `Sample files:`,
          allFiles.slice(0, 5).map((f) => ({ path: f.filePath, url: f.url, isDir: f.isDirectory }))
        );
      }
    } catch (error) {
      console.error('Error building file tree:', error);
    }

    return allFiles;
  }

  /**
   * Recursively add directory contents to file tree.
   */
  private async addDirectoryToTree(dirPath: string, relativePath: string, allFiles: FileUrlMapping[]): Promise<void> {
    // Check if directory exists
    if (!fs.existsSync(dirPath)) {
      console.warn(`Directory does not exist: ${dirPath}`);
      return;
    }

    const items = fs.readdirSync(dirPath);
    console.log(`Scanning directory: ${dirPath}, found ${items.length} items: [${items.join(', ')}]`);

    for (const item of items) {
      // Skip hidden files, underscore files, and common ignore patterns
      if (item.startsWith('.') || item.startsWith('_') || item === 'node_modules' || item === '_site') {
        continue;
      }

      const fullPath = path.join(dirPath, item);
      const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        allFiles.push({
          filePath: fullPath,
          url: '/' + itemRelativePath.replace(/\\/g, '/') + '/',
          isDirectory: true,
        });
        await this.addDirectoryToTree(fullPath, itemRelativePath, allFiles);
      } else {
        const url = this.getUrlForFile(fullPath) || '/' + itemRelativePath.replace(/\\/g, '/');
        allFiles.push({
          filePath: fullPath,
          url,
          isDirectory: false,
        });
      }
    }
  }
}
