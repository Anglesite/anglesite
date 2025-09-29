/**
 * @file Global Error Reporting Service
 *
 * Centralized error collection, persistence, and reporting service.
 * Collects errors from all processes and provides analytics.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { IErrorReportingService, IStore } from '../core/interfaces';
import { AngleError, ErrorUtils, ErrorCategory, ErrorSeverity, SerializedError } from '../core/errors';
import { logger, sanitize } from '../utils/logging';
import { ServiceKeys } from '../core/container';

/**
 * Error report structure for persistence
 */
interface ErrorReport {
  id: string;
  timestamp: Date;
  error: SerializedError;
  context?: Record<string, unknown>;
  process: 'main' | 'renderer' | 'worker';
  sessionId: string;
  version: string;
}

/**
 * Configuration for error reporting
 */
interface ErrorReportingConfig {
  maxStorageSize: number; // Maximum storage size in bytes
  maxErrorAge: number; // Maximum age of errors in milliseconds
  rateLimitPerMinute: number; // Maximum errors per minute
  persistenceEnabled: boolean;
  consoleLoggingEnabled: boolean;
}

/**
 * Error reporting service implementation
 */
export class ErrorReportingService implements IErrorReportingService {
  private store: IStore;
  private enabled = true;
  private initialized = false;
  private errorBuffer: ErrorReport[] = [];
  private errorLogPath: string;
  private sessionId: string;
  private rateLimitMap = new Map<string, number[]>();
  private flushTimer: NodeJS.Timeout | null = null;
  private config: ErrorReportingConfig;

  constructor(store: IStore) {
    this.store = store;
    this.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    this.errorLogPath = path.join(app.getPath('userData'), 'error-reports');

    // Default configuration
    this.config = {
      maxStorageSize: 50 * 1024 * 1024, // 50MB
      maxErrorAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      rateLimitPerMinute: 100,
      persistenceEnabled: true,
      consoleLoggingEnabled: process.env.NODE_ENV === 'development',
    };
  }

  /**
   * Initialize the error reporting service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Create error log directory if it doesn't exist
      await fs.mkdir(this.errorLogPath, { recursive: true });

      // Clean up old error reports
      await this.cleanupOldReports();

      // Start periodic flush
      this.startPeriodicFlush();

      // Register global error handlers
      this.registerGlobalHandlers();

      this.initialized = true;
      logger.info('ErrorReportingService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ErrorReportingService', { error: error as Error });
      // Don't throw - error reporting should never crash the app
    }
  }

  /**
   * Report an error
   */
  async report(error: Error | unknown, context?: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;

    try {
      // Check rate limiting
      if (!this.checkRateLimit(error)) {
        logger.debug('Error rate limit exceeded, dropping error');
        return;
      }

      // Wrap as AngleError if needed
      const angleError = error instanceof AngleError ? error : ErrorUtils.wrap(error, context);

      // Create error report
      const report: ErrorReport = {
        id: this.generateErrorId(),
        timestamp: new Date(),
        error: angleError.serialize(),
        context: this.sanitizeContext(context),
        process: this.getProcessType(),
        sessionId: this.sessionId,
        version: app.getVersion(),
      };

      // Add to buffer
      this.errorBuffer.push(report);

      // Log to console if enabled
      if (this.config.consoleLoggingEnabled) {
        logger.error('Error reported to ErrorReportingService', { error: angleError });
      }

      // Flush if buffer is getting large
      if (this.errorBuffer.length >= 10) {
        await this.flush();
      }
    } catch (reportingError) {
      // Logging errors should never throw
      logger.error('Failed to report error', { error: reportingError as Error });
    }
  }

  /**
   * Get error statistics
   */
  async getStatistics(since?: Date): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  }> {
    try {
      const errors = await this.loadErrors(since);
      const angleErrors = errors.map((report) => ErrorUtils.fromSerialized(report.error));

      return ErrorUtils.getStatistics(angleErrors);
    } catch (error) {
      logger.error('Failed to get error statistics', { error: error as Error });
      return {
        total: 0,
        byCategory: {},
        bySeverity: {},
      };
    }
  }

  /**
   * Get recent errors
   */
  async getRecentErrors(limit = 100): Promise<ErrorReport[]> {
    try {
      const errors = await this.loadErrors();
      return errors.slice(-limit);
    } catch (error) {
      logger.error('Failed to get recent errors', { error: error as Error });
      return [];
    }
  }

  /**
   * Clear error history
   */
  async clearHistory(): Promise<void> {
    try {
      this.errorBuffer = [];

      // Clear persisted errors
      const files = await fs.readdir(this.errorLogPath);
      await Promise.all(
        files.filter((file) => file.endsWith('.jsonl')).map((file) => fs.unlink(path.join(this.errorLogPath, file)))
      );

      logger.info('Error history cleared');
    } catch (error) {
      logger.error('Failed to clear error history', { error: error as Error });
    }
  }

  /**
   * Enable or disable error reporting
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info(`Error reporting ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if reporting is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Export errors to a file
   */
  async exportErrors(filePath: string, since?: Date): Promise<void> {
    try {
      const errors = await this.loadErrors(since);

      // Create export object
      const exportData = {
        exportDate: new Date().toISOString(),
        sessionId: this.sessionId,
        version: app.getVersion(),
        errorCount: errors.length,
        errors: errors,
        statistics: await this.getStatistics(since),
      };

      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
      logger.info(`Exported ${errors.length} errors to ${filePath}`);
    } catch (error) {
      logger.error('Failed to export errors', { error: error as Error });
      throw error;
    }
  }

  /**
   * Dispose of the service
   */
  async dispose(): Promise<void> {
    try {
      // Flush any remaining errors
      await this.flush();

      // Clear timers
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }

      // Remove global handlers
      this.removeGlobalHandlers();

      logger.info('ErrorReportingService disposed');
    } catch (error) {
      logger.error('Failed to dispose ErrorReportingService', { error: error as Error });
    }
  }

  /**
   * Flush error buffer to disk
   */
  private async flush(): Promise<void> {
    if (this.errorBuffer.length === 0 || !this.config.persistenceEnabled) {
      return;
    }

    try {
      const fileName = `errors-${this.sessionId}-${Date.now()}.jsonl`;
      const filePath = path.join(this.errorLogPath, fileName);

      // Write errors as JSON Lines format (one JSON object per line)
      const lines = this.errorBuffer.map((error) => JSON.stringify(error));
      await fs.appendFile(filePath, lines.join('\n') + '\n', 'utf-8');

      logger.debug(`Flushed ${this.errorBuffer.length} errors to ${fileName}`);
      this.errorBuffer = [];

      // Check storage size
      await this.enforceStorageLimit();
    } catch (error) {
      logger.error('Failed to flush errors to disk', { error: error as Error });
    }
  }

  /**
   * Load errors from disk
   */
  private async loadErrors(since?: Date): Promise<ErrorReport[]> {
    if (!this.config.persistenceEnabled) {
      return this.errorBuffer;
    }

    try {
      const files = await fs.readdir(this.errorLogPath);
      const errorFiles = files.filter((file) => file.endsWith('.jsonl'));

      const allErrors: ErrorReport[] = [...this.errorBuffer];

      for (const file of errorFiles) {
        const filePath = path.join(this.errorLogPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const error = JSON.parse(line) as ErrorReport;
            error.timestamp = new Date(error.timestamp);

            if (!since || error.timestamp >= since) {
              allErrors.push(error);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Sort by timestamp
      allErrors.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      return allErrors;
    } catch (error) {
      logger.error('Failed to load errors from disk', { error: error as Error });
      return this.errorBuffer;
    }
  }

  /**
   * Clean up old error reports
   */
  private async cleanupOldReports(): Promise<void> {
    try {
      const files = await fs.readdir(this.errorLogPath);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const filePath = path.join(this.errorLogPath, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > this.config.maxErrorAge) {
          await fs.unlink(filePath);
          logger.debug(`Deleted old error report: ${file}`);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup old error reports', { error: error as Error });
    }
  }

  /**
   * Enforce storage size limit
   */
  private async enforceStorageLimit(): Promise<void> {
    try {
      const files = await fs.readdir(this.errorLogPath);
      const errorFiles = files.filter((file) => file.endsWith('.jsonl'));

      let totalSize = 0;
      const fileStats = [];

      for (const file of errorFiles) {
        const filePath = path.join(this.errorLogPath, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
        fileStats.push({ path: filePath, size: stats.size, mtime: stats.mtime });
      }

      // Delete oldest files if over limit
      if (totalSize > this.config.maxStorageSize) {
        fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

        for (const file of fileStats) {
          await fs.unlink(file.path);
          totalSize -= file.size;
          logger.debug(`Deleted error report to enforce storage limit: ${path.basename(file.path)}`);

          if (totalSize <= this.config.maxStorageSize * 0.8) {
            break; // Keep 20% buffer
          }
        }
      }
    } catch (error) {
      logger.error('Failed to enforce storage limit', { error: error as Error });
    }
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(error: unknown): boolean {
    const key = error instanceof Error ? error.message : String(error);
    const now = Date.now();
    const minute = 60 * 1000;

    // Get timestamps for this error
    let timestamps = this.rateLimitMap.get(key) || [];

    // Remove old timestamps
    timestamps = timestamps.filter((t) => now - t < minute);

    // Check if we're over the limit
    if (timestamps.length >= this.config.rateLimitPerMinute) {
      return false;
    }

    // Add current timestamp
    timestamps.push(now);
    this.rateLimitMap.set(key, timestamps);

    // Clean up old entries periodically
    if (this.rateLimitMap.size > 100) {
      for (const [k, v] of this.rateLimitMap.entries()) {
        if (v.filter((t) => now - t < minute).length === 0) {
          this.rateLimitMap.delete(k);
        }
      }
    }

    return true;
  }

  /**
   * Sanitize context to remove sensitive data
   */
  private sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        // Sanitize paths and potential sensitive data
        sanitized[key] = key.toLowerCase().includes('path') ? sanitize.path(value) : sanitize.message(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get the current process type
   */
  private getProcessType(): 'main' | 'renderer' | 'worker' {
    if (process.type === 'renderer') return 'renderer';
    if (process.type === 'worker') return 'worker';
    return 'main';
  }

  /**
   * Generate a unique error ID
   */
  private generateErrorId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Start periodic flush of error buffer
   */
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((error) => {
        logger.error('Periodic flush failed', { error: error as Error });
      });
    }, 30000); // Flush every 30 seconds
  }

  /**
   * Register global error handlers
   */
  private registerGlobalHandlers(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.report(error, { type: 'uncaughtException' }).catch(console.error);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown) => {
      this.report(reason, { type: 'unhandledRejection' }).catch(console.error);
    });
  }

  /**
   * Remove global error handlers
   */
  private removeGlobalHandlers(): void {
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  }
}
