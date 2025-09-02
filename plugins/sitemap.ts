import * as fs from 'fs';
import * as path from 'path';
import { create } from 'xmlbuilder2';
import type { EleventyConfig, EleventyCollectionApi, EleventyCollectionItem } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';
import type { PageData } from '../types/index.js';
import { filterSitemapPages } from './utils/page-filters.js';

// Constants for sitemap processing
const LARGE_SITE_THRESHOLD = 10000; // Pages threshold for switching to sync approach
const BATCH_SIZE = 1000; // Number of pages to process in each batch
const ASYNC_YIELD_INTERVAL = 10; // Frequency of async yields (every N batches)
const MEMORY_WARNING_THRESHOLD_MB = 512; // Memory usage threshold for warnings
const MEMORY_MONITORING_INTERVAL = 10; // Check memory every N batches (sync)
const MEMORY_MONITORING_CHUNK_INTERVAL = 5; // Check memory every N chunks (multi-file)
const BATCH_WRITE_SIZE = 10; // Number of concurrent file writes in multi-file generation
const MAX_PRIORITY = 1.0; // Maximum valid sitemap priority
const MIN_PRIORITY = 0.0; // Minimum valid sitemap priority

/**
 * Sanitizes a filename by removing or replacing potentially dangerous characters.
 * Prevents path traversal attacks and ensures filesystem safety.
 * @param filename The filename to sanitize.
 * @returns The sanitized filename.
 */
function sanitizeFilename(filename: string): string {
  if (typeof filename !== 'string' || filename.trim() === '') {
    throw new Error('Invalid filename provided');
  }

  // Replace dangerous characters with underscore
  let sanitized = '';
  for (let i = 0; i < filename.length; i++) {
    const char = filename[i];
    const code = char.charCodeAt(0);

    // Replace control chars (0-31) and dangerous filesystem chars
    if (code < 32 || '<>:"/\\|?*'.includes(char)) {
      sanitized += '_';
    } else {
      sanitized += char;
    }
  }

  return sanitized
    .replace(/^\.+/, '_') // Replace leading dots to prevent hidden files
    .replace(/\.+$/, '') // Remove trailing dots
    .trim();
}

/**
 * Safely constructs a file path within the output directory.
 * Prevents path traversal attacks by validating the resolved path.
 * @param outputDir The base output directory.
 * @param filename The filename to join.
 * @returns The safe file path.
 * @throws Error if path traversal is detected.
 */
function safeFilePath(outputDir: string, filename: string): string {
  const sanitizedFilename = sanitizeFilename(filename);

  // Check for path traversal attempts before joining
  if (sanitizedFilename.includes('..') || sanitizedFilename.includes(path.sep)) {
    throw new Error(`Path traversal detected in filename: ${filename}`);
  }

  const fullPath = path.resolve(outputDir, sanitizedFilename);
  const normalizedOutputDir = path.resolve(outputDir);

  // Ensure the resolved path is within the output directory
  if (!fullPath.startsWith(normalizedOutputDir + path.sep) && fullPath !== normalizedOutputDir) {
    throw new Error(`Path traversal detected: ${filename} resolves outside output directory`);
  }

  // Return relative path to maintain compatibility with existing tests
  return path.join(outputDir, sanitizedFilename);
}

interface MemoryUsage {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

interface MemoryMonitor {
  startMemory: MemoryUsage;
  peakMemory: MemoryUsage;
  currentMemory: MemoryUsage;
  warningThreshold: number;
}

/**
 * Gets current memory usage in MB
 * @returns Memory usage information in MB
 */
function getMemoryUsageMB(): MemoryUsage {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024),
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
  };
}

/**
 * Creates a memory monitor for tracking usage during sitemap generation.
 * @param warningThresholdMB Memory usage threshold in MB to trigger warnings (default: 512MB)
 * @returns Memory monitor object
 */
function createMemoryMonitor(warningThresholdMB: number = MEMORY_WARNING_THRESHOLD_MB): MemoryMonitor {
  const startMemory = getMemoryUsageMB();
  return {
    startMemory,
    peakMemory: { ...startMemory },
    currentMemory: { ...startMemory },
    warningThreshold: warningThresholdMB,
  };
}

/**
 * Updates memory monitor with current usage and checks for warnings.
 * @param monitor The memory monitor to update
 * @param context Context information for logging
 */
function updateMemoryMonitor(monitor: MemoryMonitor, context: string): void {
  monitor.currentMemory = getMemoryUsageMB();

  // Track peak memory usage
  if (monitor.currentMemory.heapUsed > monitor.peakMemory.heapUsed) {
    monitor.peakMemory = { ...monitor.currentMemory };
  }

  // Check for memory warnings
  if (monitor.currentMemory.heapUsed > monitor.warningThreshold) {
    const memoryIncrease = monitor.currentMemory.heapUsed - monitor.startMemory.heapUsed;
    console.warn(
      `[@dwk/anglesite-11ty] High memory usage detected during ${context}: ` +
        `${monitor.currentMemory.heapUsed}MB heap (${memoryIncrease > 0 ? '+' : ''}${memoryIncrease}MB from start). ` +
        `Consider reducing batch size or enabling chunked processing for large sites.`
    );
  }
}

/**
 * Logs final memory statistics for sitemap generation.
 * @param monitor The memory monitor with collected data
 * @param totalPages Total number of pages processed
 * @param totalFiles Total number of files written
 */
function logMemoryStats(monitor: MemoryMonitor, totalPages: number, totalFiles: number): void {
  const memoryIncrease = monitor.peakMemory.heapUsed - monitor.startMemory.heapUsed;
  const avgMemoryPerPage = totalPages > 0 ? (monitor.peakMemory.heapUsed / totalPages).toFixed(2) : '0';

  console.log(
    `[@dwk/anglesite-11ty] Sitemap memory stats: ` +
      `Peak: ${monitor.peakMemory.heapUsed}MB, ` +
      `Start: ${monitor.startMemory.heapUsed}MB, ` +
      `Increase: ${memoryIncrease > 0 ? '+' : ''}${memoryIncrease}MB, ` +
      `Avg/page: ${avgMemoryPerPage}MB, ` +
      `Files: ${totalFiles}, Pages: ${totalPages}`
  );

  // Provide optimization suggestions for memory-intensive operations
  if (memoryIncrease > 100) {
    console.warn(
      `[@dwk/anglesite-11ty] High memory increase (+${memoryIncrease}MB) detected. ` +
        `For sites with ${totalPages}+ pages, consider: ` +
        `reducing maxUrlsPerFile, enabling splitLargeSites, or processing in smaller batches.`
    );
  }
}

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

interface SitemapConfig {
  enabled?: boolean;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  maxUrlsPerFile?: number;
  splitLargeSites?: boolean;
  indexFilename?: string;
  chunkFilenamePattern?: string;
}

interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

interface TestResultItem {
  data?: {
    website?: AnglesiteWebsiteConfiguration;
    page?: {
      url?: string;
      date?: Date;
      inputPath?: string;
      outputPath?: string;
    };
    eleventyExcludeFromCollections?: boolean;
    sitemap?:
      | false
      | {
          exclude?: boolean;
          changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
          priority?: number;
          lastmod?: Date | string;
        };
    priority?: number;
  };
  url?: string;
  date?: Date;
  inputPath?: string;
  outputPath?: string;
}

/**
 * Formats a date to W3C datetime format (YYYY-MM-DD).
 * @param date The date to format.
 * @returns The formatted date string.
 * @throws Error if the date is invalid.
 */
function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date provided: ${date}`);
  }
  return d.toISOString().split('T')[0];
}

/**
 * Generator that yields chunks of an array without loading all chunks into memory.
 * Memory-efficient alternative to creating all chunks upfront.
 * @param array The array to chunk.
 * @param size The maximum size of each chunk.
 * @yields Individual chunks as needed.
 */
function* chunkArrayGenerator<T>(array: T[], size: number): Generator<T[], void, unknown> {
  for (let i = 0; i < array.length; i += size) {
    yield array.slice(i, i + size);
  }
}

/**
 * Generator that yields chunk metadata (index, chunk, isLast) for sitemap processing.
 * @param array The array to chunk.
 * @param size The maximum size of each chunk.
 * @yields Objects with chunk index, data, and completion status.
 */
function* chunkWithMetadata<T>(
  array: T[],
  size: number
): Generator<{ index: number; chunk: T[]; isLast: boolean }, void, unknown> {
  const totalChunks = Math.ceil(array.length / size);
  for (let i = 0; i < array.length; i += size) {
    const chunkIndex = Math.floor(i / size);
    const chunk = array.slice(i, i + size);
    const isLast = chunkIndex === totalChunks - 1;
    yield { index: chunkIndex, chunk, isLast };
  }
}

/**
 * Counts the total number of chunks without creating them in memory.
 * @param arrayLength The length of the array to chunk.
 * @param chunkSize The size of each chunk.
 * @returns The total number of chunks.
 */
function getChunkCount(arrayLength: number, chunkSize: number): number {
  return Math.ceil(arrayLength / chunkSize);
}

/**
 * Generates filename for a sitemap chunk.
 * @param pattern The filename pattern with {index} placeholder.
 * @param index The chunk index (1-based).
 * @returns The generated filename.
 */
function generateChunkFilename(pattern: string, index: number): string {
  return pattern.replace('{index}', index.toString());
}

/**
 * Gets sitemap configuration with defaults.
 * @param websiteConfig The website configuration.
 * @returns The sitemap configuration with defaults applied.
 */
function getSitemapConfig(websiteConfig: AnglesiteWebsiteConfiguration): SitemapConfig {
  const sitemapSetting = websiteConfig.sitemap;

  if (sitemapSetting === false) {
    return { enabled: false };
  }

  if (sitemapSetting === true || sitemapSetting === undefined) {
    return {
      enabled: true,
      changefreq: 'yearly',
      maxUrlsPerFile: 50000,
      splitLargeSites: true,
      indexFilename: 'sitemap.xml',
      chunkFilenamePattern: 'sitemap-{index}.xml',
    };
  }

  return {
    enabled: sitemapSetting.enabled !== false,
    changefreq: sitemapSetting.changefreq || 'yearly',
    priority: sitemapSetting.priority,
    maxUrlsPerFile: sitemapSetting.maxUrlsPerFile || 50000,
    splitLargeSites: sitemapSetting.splitLargeSites !== false,
    indexFilename: sitemapSetting.indexFilename || 'sitemap.xml',
    chunkFilenamePattern: sitemapSetting.chunkFilenamePattern || 'sitemap-{index}.xml',
  };
}

/**
 * Generates a sitemap index XML file using xmlbuilder2.
 * @see https://www.sitemaps.org/protocol.html#index
 * @param sitemapEntries Array of sitemap entries for the index.
 * @returns The contents of the sitemap index XML file.
 */
function generateSitemapIndexXml(sitemapEntries: SitemapIndexEntry[]): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const sitemapindex = doc.ele('sitemapindex', {
    xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9',
  });

  for (const entry of sitemapEntries) {
    const sitemap = sitemapindex.ele('sitemap');
    sitemap.ele('loc').txt(entry.loc);

    if (entry.lastmod) {
      sitemap.ele('lastmod').txt(entry.lastmod);
    }
  }

  return doc.end({ prettyPrint: true, indent: '  ' });
}

/**
 * Generates a sitemap.xml file based on the website configuration and pages.
 * Optimized for large datasets with batch processing and memory monitoring.
 * @see https://www.sitemaps.org/protocol.html
 * @param website The website configuration object.
 * @param pages Array of page data from 11ty.
 * @param baseUrl Optional cached base URL object to avoid re-parsing.
 * @param memoryMonitor Optional memory monitor for tracking usage.
 * @returns The contents of the sitemap.xml file.
 */
export function generateSitemapXml(
  website: AnglesiteWebsiteConfiguration,
  pages: PageData[],
  baseUrl?: URL,
  memoryMonitor?: MemoryMonitor
): string {
  if (!website || !website.url) {
    return '';
  }

  const config = getSitemapConfig(website);
  if (!config.enabled) {
    return '';
  }

  // Cache base URL to avoid repeated parsing
  const cachedBaseUrl = baseUrl || new URL(website.url);

  // Monitor memory usage during XML generation
  if (memoryMonitor) {
    updateMemoryMonitor(memoryMonitor, `XML generation (${pages.length} pages)`);
  }

  // For smaller datasets, use the synchronous approach for simplicity
  if (pages.length <= LARGE_SITE_THRESHOLD) {
    return generateSitemapXmlSync(website, pages, config, cachedBaseUrl, memoryMonitor);
  }

  // For larger datasets, we'll still use sync but with optimized processing
  // Note: The calling code can use generateSitemapXmlAsync for truly large datasets
  return generateSitemapXmlSync(website, pages, config, cachedBaseUrl, memoryMonitor);
}

/**
 * Synchronous XML generation optimized for performance with memory monitoring.
 * @param website The website configuration object.
 * @param pages Array of page data from 11ty.
 * @param config The sitemap configuration with defaults applied.
 * @param baseUrl Optional cached base URL object to avoid re-parsing.
 * @param memoryMonitor Optional memory monitor for tracking usage.
 * @returns The contents of the sitemap.xml file.
 */
function generateSitemapXmlSync(
  website: AnglesiteWebsiteConfiguration,
  pages: PageData[],
  config: SitemapConfig,
  baseUrl?: URL,
  memoryMonitor?: MemoryMonitor
): string {
  const cachedBaseUrl = baseUrl || new URL(website.url!);
  const defaultChangefreq = config.changefreq || 'yearly';
  const defaultPriority = config.priority;

  // Initialize XML document with xmlbuilder2
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const urlset = doc.ele('urlset', {
    xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9',
  });

  // Process pages in batches to improve performance
  // Filter pages once before processing
  const eligiblePages = filterSitemapPages(pages);

  // Use generator-based chunking to reduce memory allocation
  const batchSize = BATCH_SIZE;
  let batchCount = 0;
  for (const batch of chunkArrayGenerator(eligiblePages, batchSize)) {
    batchCount++;

    // Monitor memory usage every N batches for large datasets
    if (memoryMonitor && batchCount % MEMORY_MONITORING_INTERVAL === 0) {
      updateMemoryMonitor(memoryMonitor, `batch processing (batch ${batchCount})`);
    }
    const batchUrls = batch
      .map((page): SitemapUrl | null => {
        // Validate page structure before processing
        if (!page.page?.url) {
          console.warn(`[@dwk/anglesite-11ty] Page missing URL: ${page.page?.inputPath || 'unknown'}`);
          return null;
        }

        const loc = safeUrlConstruction(page.page.url, cachedBaseUrl, `page ${page.page.inputPath || 'unknown'}`);
        if (!loc) {
          return null; // Skip this page
        }

        const url: SitemapUrl = {
          loc,
        };

        // Add lastmod (use explicit lastmod, or fall back to page date)
        if (typeof page.sitemap === 'object' && page.sitemap?.lastmod) {
          url.lastmod = formatDate(page.sitemap.lastmod);
        } else if (page.page.date) {
          url.lastmod = formatDate(page.page.date);
        }

        // Add changefreq (check sitemap object, then default)
        const changefreq =
          (typeof page.sitemap === 'object' ? page.sitemap?.changefreq : undefined) || defaultChangefreq;
        if (changefreq) {
          url.changefreq = changefreq;
        }

        // Add priority (check sitemap object first, then page priority, then default)
        const priority =
          (typeof page.sitemap === 'object' ? page.sitemap?.priority : undefined) ?? page.priority ?? defaultPriority;
        if (priority !== undefined) {
          if (priority < MIN_PRIORITY || priority > MAX_PRIORITY) {
            console.warn(
              `[@dwk/anglesite-11ty] Invalid priority ${priority} for ${page.page.url}, must be between 0.0 and 1.0. Skipping priority.`
            );
          } else {
            url.priority = priority;
          }
        }

        return url;
      })
      .filter((url): url is SitemapUrl => url !== null);

    // Add batch URLs to XML document
    for (const url of batchUrls) {
      const urlElement = urlset.ele('url');
      urlElement.ele('loc').txt(url.loc);

      if (url.lastmod) {
        urlElement.ele('lastmod').txt(url.lastmod);
      }

      if (url.changefreq) {
        urlElement.ele('changefreq').txt(url.changefreq);
      }

      if (url.priority !== undefined) {
        urlElement.ele('priority').txt(url.priority.toString());
      }
    }
  }

  return doc.end({ prettyPrint: true, indent: '  ' });
}

/**
 * Asynchronous XML generation for very large datasets with streaming processing and memory monitoring.
 * @param website The website configuration object.
 * @param pages Array of page data from 11ty.
 * @param baseUrl Optional cached base URL object to avoid re-parsing.
 * @param memoryMonitor Optional memory monitor for tracking usage.
 * @returns Promise that resolves to the contents of the sitemap.xml file.
 */
export async function generateSitemapXmlAsync(
  website: AnglesiteWebsiteConfiguration,
  pages: PageData[],
  baseUrl?: URL,
  memoryMonitor?: MemoryMonitor
): Promise<string> {
  if (!website || !website.url) {
    return '';
  }

  const config = getSitemapConfig(website);
  if (!config.enabled) {
    return '';
  }

  const cachedBaseUrl = baseUrl || new URL(website.url);
  const defaultChangefreq = config.changefreq || 'yearly';
  const defaultPriority = config.priority;

  // Initialize XML document with xmlbuilder2
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const urlset = doc.ele('urlset', {
    xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9',
  });

  // Filter pages once before processing
  const eligiblePages = filterSitemapPages(pages);

  // Process in batches with async yields using generator for memory efficiency
  const batchSize = BATCH_SIZE;
  let batchCount = 0;
  for (const batch of chunkArrayGenerator(eligiblePages, batchSize)) {
    batchCount++;

    // Monitor memory usage for each batch in async processing
    if (memoryMonitor) {
      updateMemoryMonitor(memoryMonitor, `async batch processing (batch ${batchCount})`);
    }

    const batchUrls = batch
      .map((page): SitemapUrl | null => {
        // Validate page structure before processing
        if (!page.page?.url) {
          console.warn(`[@dwk/anglesite-11ty] Page missing URL: ${page.page?.inputPath || 'unknown'}`);
          return null;
        }

        const loc = safeUrlConstruction(page.page.url, cachedBaseUrl, `page ${page.page.inputPath || 'unknown'}`);
        if (!loc) {
          return null; // Skip this page
        }

        const url: SitemapUrl = {
          loc,
        };

        if (typeof page.sitemap === 'object' && page.sitemap?.lastmod) {
          url.lastmod = formatDate(page.sitemap.lastmod);
        } else if (page.page.date) {
          url.lastmod = formatDate(page.page.date);
        }

        const changefreq =
          (typeof page.sitemap === 'object' ? page.sitemap?.changefreq : undefined) || defaultChangefreq;
        if (changefreq) {
          url.changefreq = changefreq;
        }

        const priority =
          (typeof page.sitemap === 'object' ? page.sitemap?.priority : undefined) ?? page.priority ?? defaultPriority;
        if (priority !== undefined && priority >= MIN_PRIORITY && priority <= MAX_PRIORITY) {
          url.priority = priority;
        } else if (priority !== undefined) {
          console.warn(
            `[@dwk/anglesite-11ty] Invalid priority ${priority} for ${page.page.url}, must be between 0.0 and 1.0. Skipping priority.`
          );
        }

        return url;
      })
      .filter((url): url is SitemapUrl => url !== null);

    // Add batch URLs to XML document
    for (const url of batchUrls) {
      const urlElement = urlset.ele('url');
      urlElement.ele('loc').txt(url.loc);

      if (url.lastmod) {
        urlElement.ele('lastmod').txt(url.lastmod);
      }
      if (url.changefreq) {
        urlElement.ele('changefreq').txt(url.changefreq);
      }
      if (url.priority !== undefined) {
        urlElement.ele('priority').txt(url.priority.toString());
      }
    }

    // Yield control periodically for large datasets (every N batches)
    if (batchCount % ASYNC_YIELD_INTERVAL === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return doc.end({ prettyPrint: true, indent: '  ' });
}

/**
 * Creates a single sitemap chunk write promise with error handling and memory monitoring.
 * @param website The website configuration object.
 * @param chunk The pages for this chunk.
 * @param filename The filename for this chunk.
 * @param outputPath The full output path for this chunk.
 * @param baseUrl Cached base URL object to avoid re-parsing.
 * @param memoryMonitor Optional memory monitor for tracking usage.
 * @returns Promise that resolves to chunk write result.
 */
async function createChunkWritePromise(
  website: AnglesiteWebsiteConfiguration,
  chunk: PageData[],
  filename: string,
  outputPath: string,
  baseUrl: URL,
  memoryMonitor?: MemoryMonitor
): Promise<{ filename: string; urls: number }> {
  try {
    const sitemapXml = generateSitemapXml(website, chunk, baseUrl, memoryMonitor);
    const safeOutputPath = safeFilePath(path.dirname(outputPath), path.basename(outputPath));
    await fs.promises.writeFile(safeOutputPath, sitemapXml);
    console.log(`[@dwk/anglesite-11ty] Wrote ${outputPath} (${chunk.length} URLs)`);
    return { filename, urls: chunk.length };
  } catch (chunkError) {
    const errorMsg = chunkError instanceof Error ? chunkError.message : String(chunkError);
    console.error(`[@dwk/anglesite-11ty] Failed to write sitemap chunk ${filename}: ${errorMsg}`);
    console.error(`[@dwk/anglesite-11ty] Chunk context: ${chunk.length} URLs, path: ${outputPath}`);
    throw new Error(`Sitemap chunk ${filename} failed: ${errorMsg}`);
  }
}

/**
 * Processes a batch of sitemap write promises.
 * @param writePromises Array of write promises to process.
 * @param batchNumber The batch number for error context.
 * @returns Array of successful write results.
 */
async function processBatch(
  writePromises: Promise<{ filename: string; urls: number }>[],
  batchNumber: number
): Promise<{ filename: string; urls: number }[]> {
  try {
    const batchResults = await Promise.all(writePromises);
    const totalUrls = batchResults.reduce((sum, r) => sum + r.urls, 0);
    console.log(`[@dwk/anglesite-11ty] Completed batch: ${batchResults.length} files, ${totalUrls} URLs`);
    return batchResults;
  } catch (batchError) {
    const errorMsg = batchError instanceof Error ? batchError.message : String(batchError);
    console.error(`[@dwk/anglesite-11ty] Batch processing failed: ${errorMsg}`);
    console.error(`[@dwk/anglesite-11ty] Batch context: ${writePromises.length} files, batch ${batchNumber}`);
    throw batchError;
  }
}

/**
 * Generates a single sitemap file with memory monitoring.
 * @param website The website configuration object.
 * @param validPages The filtered pages to include.
 * @param config The sitemap configuration.
 * @param outputDir The output directory path.
 * @param baseUrl Cached base URL object to avoid re-parsing.
 * @param memoryMonitor Optional memory monitor for tracking usage.
 * @returns Information about the generated file.
 */
async function generateSingleSitemap(
  website: AnglesiteWebsiteConfiguration,
  validPages: PageData[],
  config: SitemapConfig,
  outputDir: string,
  baseUrl: URL,
  memoryMonitor?: MemoryMonitor
): Promise<{ filesWritten: string[]; totalUrls: number }> {
  const sitemapXml = generateSitemapXml(website, validPages, baseUrl, memoryMonitor);
  const indexFilename = config.indexFilename || 'sitemap.xml';
  const outputPath = safeFilePath(outputDir, indexFilename);

  await fs.promises.writeFile(outputPath, sitemapXml);
  console.log(`[@dwk/anglesite-11ty] Wrote ${outputPath}`);

  return {
    filesWritten: [indexFilename],
    totalUrls: validPages.length,
  };
}

/**
 * Generates the sitemap index file.
 * @param sitemapEntries Array of sitemap entries for the index.
 * @param config The sitemap configuration.
 * @param outputDir The output directory path.
 * @param chunksLength The number of chunks for logging.
 * @returns The index filename.
 */
async function generateSitemapIndex(
  sitemapEntries: SitemapIndexEntry[],
  config: SitemapConfig,
  outputDir: string,
  chunksLength: number
): Promise<string> {
  try {
    const indexXml = generateSitemapIndexXml(sitemapEntries);
    const indexFilename = config.indexFilename || 'sitemap.xml';
    const indexPath = safeFilePath(outputDir, indexFilename);

    await fs.promises.writeFile(indexPath, indexXml);
    console.log(`[@dwk/anglesite-11ty] Wrote sitemap index ${indexPath} (${chunksLength} sitemaps)`);
    return indexFilename;
  } catch (indexError) {
    const errorMsg = indexError instanceof Error ? indexError.message : String(indexError);
    console.error(`[@dwk/anglesite-11ty] Failed to write sitemap index: ${errorMsg}`);
    console.error(`[@dwk/anglesite-11ty] Index context: ${sitemapEntries.length} entries, chunks: ${chunksLength}`);
    throw new Error(`Sitemap index generation failed: ${errorMsg}`);
  }
}

/**
 * Generates multiple sitemap files with an index and memory monitoring.
 * @param website The website configuration object.
 * @param validPages The filtered pages to include.
 * @param config The sitemap configuration.
 * @param outputDir The output directory path.
 * @param baseUrl Cached base URL object to avoid re-parsing.
 * @param memoryMonitor Optional memory monitor for tracking usage.
 * @returns Information about the generated files.
 */
async function generateMultipleSitemaps(
  website: AnglesiteWebsiteConfiguration,
  validPages: PageData[],
  config: SitemapConfig,
  outputDir: string,
  baseUrl: URL,
  memoryMonitor?: MemoryMonitor
): Promise<{ filesWritten: string[]; totalUrls: number }> {
  const maxUrlsPerFile = config.maxUrlsPerFile || 50000;
  const sitemapEntries: SitemapIndexEntry[] = [];
  const chunkPattern = config.chunkFilenamePattern || 'sitemap-{index}.xml';
  const filesWritten: string[] = [];

  // Cache the current date for all sitemap entries
  const lastModified = formatDate(new Date());

  // Calculate total chunks for final index generation (without creating chunks in memory)
  const totalChunks = getChunkCount(validPages.length, maxUrlsPerFile);

  // Generate individual sitemap files in batches using generator for memory efficiency
  const batchSize = BATCH_WRITE_SIZE;
  let writePromises: Promise<{ filename: string; urls: number }>[] = [];

  for (const { index, chunk, isLast } of chunkWithMetadata(validPages, maxUrlsPerFile)) {
    const filename = generateChunkFilename(chunkPattern, index + 1);
    const outputPath = safeFilePath(outputDir, filename);

    // Monitor memory usage during chunk processing
    if ((index + 1) % MEMORY_MONITORING_CHUNK_INTERVAL === 0) {
      updateMemoryMonitor(memoryMonitor, `chunk processing (chunk ${index + 1}/${totalChunks})`);
    }

    const writePromise = createChunkWritePromise(website, chunk, filename, outputPath, baseUrl, memoryMonitor);
    writePromises.push(writePromise);

    // Add to index - use cached baseUrl instead of creating new URL object
    const indexEntryUrl = safeUrlConstruction(filename, baseUrl, `sitemap index entry ${filename}`);
    if (indexEntryUrl) {
      sitemapEntries.push({
        loc: indexEntryUrl,
        lastmod: lastModified,
      });
    }

    // Process in batches to avoid overwhelming the system
    if (writePromises.length >= batchSize || isLast) {
      const batchNumber = Math.ceil((index + 1) / batchSize);
      const batchResults = await processBatch(writePromises, batchNumber);
      filesWritten.push(...batchResults.map((r) => r.filename));
      writePromises = []; // Clear the array
    }
  }

  // Generate sitemap index
  const indexFilename = await generateSitemapIndex(sitemapEntries, config, outputDir, totalChunks);
  filesWritten.push(indexFilename);

  return { filesWritten, totalUrls: validPages.length };
}

/**
 * Generates sitemap files for a website, handling both single and indexed sitemaps.
 * @param website The website configuration object.
 * @param pages Array of page data from 11ty.
 * @param outputDir The output directory path.
 * @returns Information about the generated files.
 */
export async function generateSitemapFiles(
  website: AnglesiteWebsiteConfiguration,
  pages: PageData[],
  outputDir: string
): Promise<{ filesWritten: string[]; totalUrls: number }> {
  const config = getSitemapConfig(website);
  if (!config.enabled) {
    return { filesWritten: [], totalUrls: 0 };
  }

  // Initialize memory monitoring for sitemap generation
  const memoryMonitor = createMemoryMonitor(MEMORY_WARNING_THRESHOLD_MB);
  console.log(`[@dwk/anglesite-11ty] Starting sitemap generation with memory monitoring (${pages.length} pages)`);

  if (!website.url) {
    console.warn('[@dwk/anglesite-11ty] No website URL provided, skipping sitemap generation');
    return { filesWritten: [], totalUrls: 0 };
  }

  // Filter valid pages
  const validPages = filterSitemapPages(pages);
  const maxUrlsPerFile = config.maxUrlsPerFile || 50000;

  // Cache base URL once for all operations to avoid repeated URL parsing
  const baseUrl = new URL(website.url);

  try {
    // Ensure output directory exists
    await fs.promises.mkdir(outputDir, { recursive: true });

    let result: { filesWritten: string[]; totalUrls: number };

    if (validPages.length <= maxUrlsPerFile || !config.splitLargeSites) {
      updateMemoryMonitor(memoryMonitor, 'single sitemap generation start');
      result = await generateSingleSitemap(website, validPages, config, outputDir, baseUrl, memoryMonitor);
    } else {
      updateMemoryMonitor(memoryMonitor, 'multiple sitemaps generation start');
      result = await generateMultipleSitemaps(website, validPages, config, outputDir, baseUrl, memoryMonitor);
    }

    // Log final memory statistics
    logMemoryStats(memoryMonitor, result.totalUrls, result.filesWritten.length);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[@dwk/anglesite-11ty] Failed to write sitemap files: ${errorMessage}`);
    console.error(`[@dwk/anglesite-11ty] Site context: ${validPages.length} pages, output: ${outputDir}`);
    console.error(`[@dwk/anglesite-11ty] Config: maxUrls=${maxUrlsPerFile}, split=${config.splitLargeSites}`);

    if (error instanceof Error && error.stack) {
      console.error(`[@dwk/anglesite-11ty] Stack trace: ${error.stack}`);
    }

    return { filesWritten: [], totalUrls: 0 };
  }
}

/**
 * Safely constructs a URL for a page, with error handling.
 * @param pageUrl The page URL.
 * @param baseUrl The base URL.
 * @param context Context information for error reporting.
 * @returns The constructed URL or null if invalid.
 */
export function safeUrlConstruction(pageUrl: string, baseUrl: URL, context: string): string | null {
  try {
    return new URL(pageUrl, baseUrl).href;
  } catch (urlError) {
    const errorMsg = urlError instanceof Error ? urlError.message : String(urlError);
    console.warn(`[@dwk/anglesite-11ty] Invalid URL in ${context}: ${pageUrl} - ${errorMsg}`);
    return null;
  }
}

/**
 * Adds sitemap generation functionality to Eleventy configuration.
 * Creates a shortcode that can be used in templates to generate sitemap XML.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addSitemap(eleventyConfig: EleventyConfig): void {
  // Store collection data for use in eleventy.after
  let sitemapPages: PageData[] = [];

  // Add a collection to capture all pages with their full data
  eleventyConfig.addCollection('sitemapPages', function (collectionApi: EleventyCollectionApi) {
    const allPages = collectionApi.getAll();

    // Transform and store for later use
    sitemapPages = allPages.map((item: EleventyCollectionItem) => ({
      website: item.data.website || {},
      page: {
        url: item.url,
        date: item.date,
        inputPath: item.inputPath,
        outputPath: item.outputPath,
      },
      eleventyExcludeFromCollections: item.data.eleventyExcludeFromCollections,
      sitemap: item.data.sitemap,
      priority: item.data.priority,
    }));

    return allPages; // Return original for the collection
  });

  // Add a shortcode for generating sitemap XML from collections
  eleventyConfig.addShortcode(
    'generateSitemapXml',
    function (
      this: unknown,
      collections: { all?: EleventyCollectionItem[] } | unknown,
      website: AnglesiteWebsiteConfiguration | unknown
    ) {
      // Type guards for better type safety
      /**
       * Type guard to check if an object is a valid AnglesiteWebsiteConfiguration
       * @param obj The object to check
       * @returns True if the object is a valid AnglesiteWebsiteConfiguration
       */
      function isWebsiteConfig(obj: unknown): obj is AnglesiteWebsiteConfiguration {
        return (
          obj !== null &&
          typeof obj === 'object' &&
          obj !== undefined &&
          typeof (obj as AnglesiteWebsiteConfiguration).url === 'string'
        );
      }

      /**
       * Type guard to check if an object contains Eleventy collection data
       * @param obj The object to check
       * @returns True if the object contains valid Eleventy collection data
       */
      function isCollectionData(obj: unknown): obj is { all?: EleventyCollectionItem[] } {
        return (
          obj !== null &&
          typeof obj === 'object' &&
          obj !== undefined &&
          (Array.isArray((obj as { all?: unknown }).all) || (obj as { all?: unknown }).all === undefined)
        );
      }

      if (!isWebsiteConfig(website)) {
        return '';
      }

      if (!isCollectionData(collections)) {
        return '';
      }

      const config = getSitemapConfig(website);
      if (!config.enabled) {
        return '';
      }

      // Use collections.all to get all pages with frontmatter data
      const allPages = collections.all || [];

      // Transform collection items to PageData format
      const pages: PageData[] = allPages.map((item: EleventyCollectionItem) => ({
        website: website,
        page: {
          url: item.url,
          date: item.date,
          inputPath: item.inputPath,
          outputPath: item.outputPath,
        },
        eleventyExcludeFromCollections: item.data.eleventyExcludeFromCollections,
        sitemap: item.data.sitemap,
        priority: item.data.priority,
      }));

      return generateSitemapXml(website, pages);
    }
  );

  // Generate sitemap.xml file during the build process
  eleventyConfig.on('eleventy.after', async ({ dir, results }) => {
    try {
      // Get website configuration - try from results first (tests), then filesystem
      let websiteConfig: AnglesiteWebsiteConfiguration | undefined;

      // Check if the first result has data property (test scenario or pages with website data)
      if (results && results.length > 0) {
        const firstResult = results[0] as { data?: { website: AnglesiteWebsiteConfiguration } };
        if (firstResult?.data?.website) {
          websiteConfig = firstResult.data.website;
        }
      }

      // If no website config found in results, try reading from filesystem (real builds)
      if (!websiteConfig) {
        try {
          const websiteDataPath = path.resolve('src', '_data', 'website.json');
          const websiteData = await fs.promises.readFile(websiteDataPath, 'utf-8');
          websiteConfig = JSON.parse(websiteData) as AnglesiteWebsiteConfiguration;
        } catch {
          console.warn('[@dwk/anglesite-11ty] Sitemap plugin: Could not read website.json from _data directory');
          return;
        }
      }

      if (!websiteConfig || !websiteConfig.url) {
        console.warn('[@dwk/anglesite-11ty] Sitemap plugin: No website configuration with URL found');
        return;
      }

      const config = getSitemapConfig(websiteConfig);
      if (!config.enabled) {
        console.log('[@dwk/anglesite-11ty] Sitemap generation is disabled');
        return;
      }

      let pagesToProcess: PageData[];

      // For tests, use data from results if available and contains page data
      if (results && results.length > 0 && results[0] && 'data' in results[0] && (results[0] as TestResultItem).data) {
        // Transform results to PageData format (test scenario)
        pagesToProcess = results.map((item: TestResultItem) => ({
          website: websiteConfig,
          page: {
            url: item.data?.page?.url || item.url || '',
            date: item.data?.page?.date || item.date || new Date(),
            inputPath: item.data?.page?.inputPath || item.inputPath || '',
            outputPath: item.data?.page?.outputPath || item.outputPath || '',
          },
          eleventyExcludeFromCollections: item.data?.eleventyExcludeFromCollections,
          sitemap: item.data?.sitemap,
          priority: item.data?.priority,
        }));
      } else {
        // Use collection-based pages (real builds)
        pagesToProcess = sitemapPages.map((page) => ({
          ...page,
          website: websiteConfig,
        }));
      }

      const outputDir = dir.output || '_site';
      const sitemapResult = await generateSitemapFiles(websiteConfig, pagesToProcess, outputDir);

      if (sitemapResult.filesWritten.length > 0) {
        console.log(
          `[@dwk/anglesite-11ty] Generated sitemap: ${sitemapResult.filesWritten.join(', ')} (${sitemapResult.totalUrls} URLs)`
        );
      }
    } finally {
      // Release collection data to prevent memory leaks
      sitemapPages.length = 0;
    }
  });
}
