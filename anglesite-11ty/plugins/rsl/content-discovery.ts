/**
 * Content Discovery Module
 * Scans and catalogs digital assets for RSL generation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';
import type { RSLContentAsset, RSLContentDiscoveryConfig } from './types.js';

const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);

/**
 * MIME type mappings for common file extensions
 */
const MIME_TYPE_MAP: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',

  // Web files
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.rss': 'application/rss+xml',
  '.atom': 'application/atom+xml',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',

  // Video
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',

  // Archives
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',

  // Markdown and text
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
};

/**
 * Gets MIME type for a file based on its extension
 * @param filePath - The file path to determine MIME type for
 * @returns The MIME type string
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPE_MAP[ext] || 'application/octet-stream';
}

/**
 * Generates a checksum for file content
 * @param filePath - Path to the file
 * @param algorithm - Hashing algorithm to use
 * @returns Promise resolving to the checksum string
 */
async function generateChecksum(filePath: string, algorithm: 'md5' | 'sha1' | 'sha256' = 'sha256'): Promise<string> {
  try {
    const content = await readFile(filePath);
    const hash = crypto.createHash(algorithm);
    hash.update(content);
    return hash.digest('hex');
  } catch (error) {
    console.warn(`Failed to generate checksum for ${filePath}:`, error);
    return '';
  }
}

/**
 * Checks if a file should be included based on discovery configuration
 * @param filePath - Path to the file
 * @param config - Content discovery configuration
 * @returns Whether the file should be included
 */
function shouldIncludeFile(filePath: string, config: RSLContentDiscoveryConfig): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  // Check file extension inclusion/exclusion
  if (config.includeExtensions && config.includeExtensions.length > 0) {
    if (!config.includeExtensions.includes(ext)) {
      return false;
    }
  }

  if (config.excludeExtensions && config.excludeExtensions.includes(ext)) {
    return false;
  }

  // Skip hidden files and common temporary files
  if (fileName.startsWith('.') || fileName.startsWith('~') || fileName.endsWith('.tmp')) {
    return false;
  }

  return true;
}

/**
 * Checks if a directory should be explored based on discovery configuration
 * @param dirPath - Path to the directory
 * @param config - Content discovery configuration
 * @returns Whether the directory should be explored
 */
function shouldExploreDirectory(dirPath: string, config: RSLContentDiscoveryConfig): boolean {
  const dirName = path.basename(dirPath);

  // Check explicit exclusions
  if (config.excludeDirectories && config.excludeDirectories.includes(dirName)) {
    return false;
  }

  // Skip hidden directories and common build/cache directories
  if (dirName.startsWith('.') || dirName === '__pycache__' || dirName === 'tmp' || dirName === 'temp') {
    return false;
  }

  return true;
}

/**
 * Recursively scans a directory for assets
 * @param dirPath - Directory path to scan
 * @param config - Content discovery configuration
 * @param baseUrl - Base URL for generating asset URLs
 * @param currentDepth - Current recursion depth
 * @param maxDepth - Maximum recursion depth
 * @returns Promise resolving to array of discovered assets
 */
async function scanDirectory(
  dirPath: string,
  config: RSLContentDiscoveryConfig,
  baseUrl: string,
  currentDepth: number = 0,
  maxDepth: number = 10
): Promise<RSLContentAsset[]> {
  const assets: RSLContentAsset[] = [];

  if (currentDepth >= maxDepth) {
    return assets;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (shouldExploreDirectory(fullPath, config)) {
          const subAssets = await scanDirectory(fullPath, config, baseUrl, currentDepth + 1, maxDepth);
          assets.push(...subAssets);
        }
      } else if (entry.isFile()) {
        if (shouldIncludeFile(fullPath, config)) {
          try {
            const fileAsset = await createAssetFromFile(fullPath, config, baseUrl);
            if (fileAsset) {
              assets.push(fileAsset);
            }
          } catch (error) {
            console.warn(`Failed to process file ${fullPath}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to scan directory ${dirPath}:`, error);
  }

  return assets;
}

/**
 * Creates an RSL content asset from a file
 * @param filePath - Path to the file
 * @param config - Content discovery configuration
 * @param baseUrl - Base URL for generating asset URLs
 * @returns Promise resolving to the content asset or null if creation failed
 */
async function createAssetFromFile(
  filePath: string,
  config: RSLContentDiscoveryConfig,
  baseUrl: string
): Promise<RSLContentAsset | null> {
  try {
    const stats = await stat(filePath);

    if (!stats.isFile()) {
      return null;
    }

    // Generate relative URL from the file path
    // This assumes the file is within a web-accessible directory
    const relativePath = path.relative(process.cwd(), filePath);
    const url = new URL(relativePath.replace(/\\/g, '/'), baseUrl).toString();

    const asset: RSLContentAsset = {
      url,
      size: stats.size,
      type: getMimeType(filePath),
      lastmod: stats.mtime,
      localPath: filePath,
    };

    // Generate checksum if enabled
    if (config.generateChecksums) {
      asset.checksum = await generateChecksum(filePath, 'sha256');
      asset.checksumAlgorithm = 'sha256';
    }

    return asset;
  } catch (error) {
    console.warn(`Failed to create asset from file ${filePath}:`, error);
    return null;
  }
}

/**
 * Extracts referenced assets from markdown content
 * @param markdownContent - The markdown content to analyze
 * @param baseDirectory - Base directory for resolving relative paths
 * @param config - Content discovery configuration
 * @param baseUrl - Base URL for generating asset URLs
 * @returns Promise resolving to array of referenced assets
 */
async function extractMarkdownAssets(
  markdownContent: string,
  baseDirectory: string,
  config: RSLContentDiscoveryConfig,
  baseUrl: string
): Promise<RSLContentAsset[]> {
  const assets: RSLContentAsset[] = [];

  // Regular expressions for finding asset references
  const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
  const linkRegex = /\[.*?\]\(([^)]+)\)/g;

  const patterns = [imageRegex, linkRegex];

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0; // Reset regex state

    while ((match = pattern.exec(markdownContent)) !== null) {
      const assetPath = match[1];

      // Skip external URLs and anchors
      if (assetPath.startsWith('http') || assetPath.startsWith('mailto:') || assetPath.startsWith('#')) {
        continue;
      }

      // Resolve relative path
      const absolutePath = path.resolve(baseDirectory, assetPath);

      // Check if file exists and should be included
      try {
        if (fs.existsSync(absolutePath) && shouldIncludeFile(absolutePath, config)) {
          const asset = await createAssetFromFile(absolutePath, config, baseUrl);
          if (asset) {
            // Avoid duplicates
            if (!assets.some((existing) => existing.url === asset.url)) {
              assets.push(asset);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to process referenced asset ${absolutePath}:`, error);
      }
    }
  }

  return assets;
}

/**
 * Discovers content assets in a directory tree
 * @param inputDirectory - Root directory to scan
 * @param config - Content discovery configuration
 * @param baseUrl - Base URL for generating asset URLs
 * @returns Promise resolving to array of discovered content assets
 */
export async function discoverContentAssets(
  inputDirectory: string,
  config: RSLContentDiscoveryConfig,
  baseUrl: string
): Promise<RSLContentAsset[]> {
  const assets: RSLContentAsset[] = [];

  if (!config.enabled) {
    return assets;
  }

  try {
    // Scan directory tree for assets
    const directoryAssets = await scanDirectory(inputDirectory, config, baseUrl, 0, config.maxDepth || 10);

    assets.push(...directoryAssets);

    // Extract assets referenced in markdown files
    const markdownFiles = assets.filter((asset) => asset.type === 'text/markdown' && asset.localPath);

    for (const markdownFile of markdownFiles) {
      try {
        if (markdownFile.localPath) {
          const content = await readFile(markdownFile.localPath, 'utf-8');
          const referencedAssets = await extractMarkdownAssets(
            content,
            path.dirname(markdownFile.localPath),
            config,
            baseUrl
          );

          // Add referenced assets that aren't already included
          for (const referencedAsset of referencedAssets) {
            if (!assets.some((existing) => existing.url === referencedAsset.url)) {
              assets.push(referencedAsset);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to extract assets from markdown ${markdownFile.localPath}:`, error);
      }
    }

    // Remove duplicates by URL
    const uniqueAssets = assets.filter((asset, index) => assets.findIndex((a) => a.url === asset.url) === index);

    console.log(`Discovered ${uniqueAssets.length} content assets`);
    return uniqueAssets;
  } catch (error) {
    console.error('Failed to discover content assets:', error);
    return [];
  }
}

/**
 * Validates that discovered assets are accessible and have valid metadata
 * @param assets - Array of content assets to validate
 * @returns Array of validation warnings/errors
 */
export function validateDiscoveredAssets(assets: RSLContentAsset[]): Array<{
  asset: RSLContentAsset;
  issue: string;
  severity: 'warning' | 'error';
}> {
  const issues: Array<{ asset: RSLContentAsset; issue: string; severity: 'warning' | 'error' }> = [];

  for (const asset of assets) {
    // Check for required fields
    if (!asset.url) {
      issues.push({
        asset,
        issue: 'Asset missing URL',
        severity: 'error',
      });
    }

    if (!asset.type) {
      issues.push({
        asset,
        issue: 'Asset missing MIME type',
        severity: 'warning',
      });
    }

    if (asset.size === undefined || asset.size < 0) {
      issues.push({
        asset,
        issue: 'Asset has invalid size',
        severity: 'warning',
      });
    }

    // Check file accessibility if local path is available
    if (asset.localPath) {
      try {
        if (!fs.existsSync(asset.localPath)) {
          issues.push({
            asset,
            issue: 'Referenced file does not exist',
            severity: 'error',
          });
        }
      } catch {
        issues.push({
          asset,
          issue: 'Cannot access referenced file',
          severity: 'error',
        });
      }
    }

    // Check for suspiciously large files (>100MB)
    if (asset.size && asset.size > 100 * 1024 * 1024) {
      issues.push({
        asset,
        issue: 'Asset is very large (>100MB), may impact build performance',
        severity: 'warning',
      });
    }
  }

  return issues;
}
