/**
 * @file Enhanced file watcher for Anglesite with incremental compilation support
 * @description Provides optimized file watching with debouncing, smart filtering, and performance monitoring
 * @author David W. Keith (git@dwk.io)
 * @since 0.1.0
 */

import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';

/** File change event types */
export type FileChangeEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

/** File change information */
export interface FileChangeInfo {
  path: string;
  event: FileChangeEvent;
  timestamp: number;
  relativePath: string;
  isDirectory: boolean;
  stats?: fs.Stats;
}

/** Rebuild callback function type */
export type RebuildCallback = (changedFiles: FileChangeInfo[]) => Promise<void>;

/** Watch mode configuration */
export interface WatchModeConfig {
  /** Base directory to watch */
  inputDir: string;
  /** Build output directory to exclude from watching */
  outputDir: string;
  /** Debounce delay in milliseconds (default: 300ms) */
  debounceMs?: number;
  /** Maximum batch size for changes (default: 50) */
  maxBatchSize?: number;
  /** Enable performance monitoring (default: true) */
  enableMetrics?: boolean;
  /** Additional patterns to ignore */
  ignorePatterns?: string[];
  /** File extensions to prioritize for faster rebuilds */
  priorityExtensions?: string[];
}

/** Performance metrics for watch mode */
export interface WatchModeMetrics {
  /** Total number of file changes detected */
  totalChanges: number;
  /** Total number of rebuilds triggered */
  totalRebuilds: number;
  /** Average rebuild time in milliseconds */
  averageRebuildTime: number;
  /** Number of batched changes */
  batchedChanges: number;
  /** Number of ignored changes */
  ignoredChanges: number;
  /** Peak memory usage during watching */
  peakMemoryUsage: number;
  /** Watch mode start time */
  startTime: number;
}

/** Enhanced file watcher class */
export class EnhancedFileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: Map<string, FileChangeInfo> = new Map();
  private metrics: WatchModeMetrics;
  private config: Required<WatchModeConfig>;
  private lastRebuildTime: number = 0;
  private rebuildTimes: number[] = [];

  constructor(
    private rebuildCallback: RebuildCallback,
    config: WatchModeConfig
  ) {
    // Set default configuration
    this.config = {
      debounceMs: 300,
      maxBatchSize: 50,
      enableMetrics: true,
      ignorePatterns: ['**/node_modules/**', '**/.git/**', '**/.DS_Store', '**/Thumbs.db', '**/*.tmp', '**/*.log'],
      priorityExtensions: ['.md', '.html', '.css', '.js', '.ts', '.json'],
      ...config,
    };

    // Initialize metrics
    this.metrics = {
      totalChanges: 0,
      totalRebuilds: 0,
      averageRebuildTime: 0,
      batchedChanges: 0,
      ignoredChanges: 0,
      peakMemoryUsage: process.memoryUsage().heapUsed,
      startTime: Date.now(),
    };
  }

  /**
   * Start watching files for changes.
   */
  public async start(): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }

    const watchPattern = path.join(this.config.inputDir, '/**/*');

    // Create watcher with optimized settings
    this.watcher = chokidar.watch(watchPattern, {
      ignored: [this.config.outputDir + '/**', ...this.config.ignorePatterns],
      ignoreInitial: true,
      persistent: true,
      // Optimize for performance
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      // Reduce CPU usage
      atomic: true,
      alwaysStat: false,
      depth: 10,
    });

    // Set up event handlers
    this.watcher
      .on('add', (filePath, stats) => this.handleFileChange('add', filePath, stats))
      .on('change', (filePath, stats) => this.handleFileChange('change', filePath, stats))
      .on('unlink', (filePath) => this.handleFileChange('unlink', filePath))
      .on('addDir', (dirPath, stats) => this.handleFileChange('addDir', dirPath, stats))
      .on('unlinkDir', (dirPath) => this.handleFileChange('unlinkDir', dirPath))
      .on('error', (error) => this.handleWatcherError(error));

    console.log(`[Watch Mode] Started watching: ${watchPattern}`);
    console.log(`[Watch Mode] Debounce: ${this.config.debounceMs}ms, Max batch: ${this.config.maxBatchSize}`);
  }

  /**
   * Stop watching files with enhanced cleanup to prevent fsevents race conditions.
   */
  public async stop(): Promise<void> {
    console.log('[FileWatcher] Starting file watcher shutdown...');

    // Clear any pending rebuilds immediately to prevent new operations
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Clear pending changes to prevent any new processing
    this.pendingChanges.clear();

    if (this.watcher) {
      try {
        console.log('[FileWatcher] Closing chokidar watcher...');

        // Add timeout protection for chokidar/fsevents cleanup
        // This is critical to prevent the SIGABRT crash
        await Promise.race([
          this.watcher.close(),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('File watcher close timeout - fsevents may be hanging'));
            }, 3000); // 3 second timeout for file watcher cleanup
          }),
        ]);

        console.log('[FileWatcher] Chokidar watcher closed successfully');
      } catch (error) {
        console.error('[FileWatcher] Error closing file watcher (this may prevent fsevents crash):', error);
        // Don't throw - we want to continue with cleanup even if watcher.close() fails
        // This prevents the process from hanging on fsevents cleanup issues
      } finally {
        this.watcher = null;
      }
    }

    if (this.config.enableMetrics) {
      this.logFinalMetrics();
    }

    console.log('[FileWatcher] File watcher shutdown completed');
  }

  /**
   * Get current performance metrics.
   */
  public getMetrics(): WatchModeMetrics {
    return { ...this.metrics };
  }

  /**
   * Handle file change events with smart filtering.
   */
  private handleFileChange(event: FileChangeEvent, filePath: string, stats?: fs.Stats): void {
    const relativePath = path.relative(this.config.inputDir, filePath);

    // Skip if the file is in the output directory (should be caught by ignore patterns)
    if (filePath.startsWith(this.config.outputDir)) {
      this.metrics.ignoredChanges++;
      return;
    }

    // Smart filtering: ignore certain file types that don't affect builds
    if (this.shouldIgnoreFile(filePath)) {
      this.metrics.ignoredChanges++;
      return;
    }

    const changeInfo: FileChangeInfo = {
      path: filePath,
      event,
      timestamp: Date.now(),
      relativePath,
      isDirectory: event === 'addDir' || event === 'unlinkDir',
      stats,
    };

    // Update metrics
    this.metrics.totalChanges++;
    this.updateMemoryMetrics();

    // Store the change (overwrites previous change for same file)
    this.pendingChanges.set(filePath, changeInfo);

    console.log(`[Watch Mode] ${event.toUpperCase()}: ${relativePath}`);

    // Schedule debounced rebuild
    this.scheduleRebuild();
  }

  /**
   * Determine if a file should be ignored based on smart filtering.
   */
  private shouldIgnoreFile(filePath: string): boolean {
    const filename = path.basename(filePath);

    // Ignore temporary and cache files
    const tempPatterns = [/\.tmp$/, /\.temp$/, /~$/, /\.swp$/, /\.swo$/, /\.lock$/, /\.pid$/, /\.log$/];

    return tempPatterns.some((pattern) => pattern.test(filename));
  }

  /**
   * Schedule a debounced rebuild.
   */
  private scheduleRebuild(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.triggerRebuild();
    }, this.config.debounceMs);
  }

  /**
   * Trigger the actual rebuild with batched changes.
   */
  private async triggerRebuild(): Promise<void> {
    if (this.pendingChanges.size === 0) {
      return;
    }

    const startTime = Date.now();

    // Get batched changes and prioritize them
    const changes = this.getBatchedChanges();
    const sortedChanges = this.prioritizeChanges(changes);

    console.log(`[Watch Mode] Processing ${sortedChanges.length} changes...`);

    try {
      // Update metrics
      this.metrics.totalRebuilds++;
      this.metrics.batchedChanges += sortedChanges.length;

      // Execute the rebuild callback
      await this.rebuildCallback(sortedChanges);

      const rebuildTime = Date.now() - startTime;
      this.recordRebuildTime(rebuildTime);

      console.log(`[Watch Mode] Rebuild completed in ${rebuildTime}ms`);

      // Log performance metrics periodically
      if (this.config.enableMetrics && this.metrics.totalRebuilds % 10 === 0) {
        this.logPerformanceMetrics();
      }
    } catch (error) {
      console.error('[Watch Mode] Rebuild failed:', error);
    }

    // Clear processed changes
    this.pendingChanges.clear();
  }

  /**
   * Get batched changes up to the maximum batch size.
   */
  private getBatchedChanges(): FileChangeInfo[] {
    const changes = Array.from(this.pendingChanges.values());

    // Limit batch size to prevent overwhelming the build system
    return changes.slice(0, this.config.maxBatchSize);
  }

  /**
   * Prioritize changes based on file types and importance.
   */
  private prioritizeChanges(changes: FileChangeInfo[]): FileChangeInfo[] {
    return changes.sort((a, b) => {
      // Priority 1: Configuration and template files
      const aIsConfig = this.isConfigFile(a.path);
      const bIsConfig = this.isConfigFile(b.path);
      if (aIsConfig && !bIsConfig) return -1;
      if (!aIsConfig && bIsConfig) return 1;

      // Priority 2: Priority extensions
      const aIsPriority = this.isPriorityExtension(a.path);
      const bIsPriority = this.isPriorityExtension(b.path);
      if (aIsPriority && !bIsPriority) return -1;
      if (!aIsPriority && bIsPriority) return 1;

      // Priority 3: Newer changes first
      return b.timestamp - a.timestamp;
    });
  }

  /**
   * Check if a file is a configuration file that should be prioritized.
   */
  private isConfigFile(filePath: string): boolean {
    const filename = path.basename(filePath);
    const configFiles = ['.eleventy.js', 'eleventy.config.js', 'package.json', '_data', '_includes'];

    return configFiles.some((pattern) => filename.includes(pattern));
  }

  /**
   * Check if a file has a priority extension.
   */
  private isPriorityExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.config.priorityExtensions.includes(ext);
  }

  /**
   * Record rebuild time for performance tracking.
   */
  private recordRebuildTime(time: number): void {
    this.rebuildTimes.push(time);

    // Keep only the last 50 rebuild times to calculate rolling average
    if (this.rebuildTimes.length > 50) {
      this.rebuildTimes.shift();
    }

    this.metrics.averageRebuildTime = this.rebuildTimes.reduce((sum, t) => sum + t, 0) / this.rebuildTimes.length;
  }

  /**
   * Update memory usage metrics.
   */
  private updateMemoryMetrics(): void {
    const currentMemory = process.memoryUsage().heapUsed;
    if (currentMemory > this.metrics.peakMemoryUsage) {
      this.metrics.peakMemoryUsage = currentMemory;
    }
  }

  /**
   * Display current watch mode performance statistics.
   */
  private logPerformanceMetrics(): void {
    const uptime = Date.now() - this.metrics.startTime;
    const uptimeMinutes = Math.round(uptime / 60000);
    const memoryMB = Math.round(this.metrics.peakMemoryUsage / 1024 / 1024);

    console.log(`[Watch Mode] Performance Report:`);
    console.log(`  Uptime: ${uptimeMinutes}m`);
    console.log(`  Changes: ${this.metrics.totalChanges} (${this.metrics.ignoredChanges} ignored)`);
    console.log(`  Rebuilds: ${this.metrics.totalRebuilds}`);
    console.log(`  Avg rebuild time: ${Math.round(this.metrics.averageRebuildTime)}ms`);
    console.log(`  Peak memory: ${memoryMB}MB`);
    console.log(
      `  Efficiency: ${Math.round(this.metrics.batchedChanges / this.metrics.totalRebuilds)} changes/rebuild`
    );
  }

  /**
   * Log final metrics when stopping.
   */
  private logFinalMetrics(): void {
    console.log(`[Watch Mode] Final Performance Report:`);
    this.logPerformanceMetrics();
  }

  /**
   * Handle watcher errors.
   */
  private handleWatcherError(error: Error): void {
    console.error('[Watch Mode] Watcher error:', error);
  }
}

/**
 * Create and configure an enhanced file watcher.
 */
export function createEnhancedFileWatcher(
  rebuildCallback: RebuildCallback,
  config: WatchModeConfig
): EnhancedFileWatcher {
  return new EnhancedFileWatcher(rebuildCallback, config);
}
