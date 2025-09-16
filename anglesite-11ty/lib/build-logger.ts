/**
 * @file Build-time logging utilities for 11ty plugins
 * @description Provides environment-aware logging that respects test environments
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface BuildLogOptions {
  prefix?: string;
  suppressInTests?: boolean;
  suppressInProduction?: boolean;
}

/**
 * Environment-aware build logger for 11ty plugins
 */
class BuildLogger {
  private prefix: string;
  private suppressInTests: boolean;
  private suppressInProduction: boolean;
  private isTestEnvironment: boolean;
  private isProductionEnvironment: boolean;

  constructor(options: BuildLogOptions = {}) {
    this.prefix = options.prefix || '[@dwk/anglesite-11ty]';
    this.suppressInTests = options.suppressInTests ?? true; // Suppress by default in tests
    this.suppressInProduction = options.suppressInProduction ?? false;

    // Detect environment
    this.isTestEnvironment =
      process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined || typeof jest !== 'undefined';
    this.isProductionEnvironment = process.env.NODE_ENV === 'production';
  }

  private shouldLog(level: LogLevel): boolean {
    // Always log errors and warnings
    if (level === 'error' || level === 'warn') {
      return true;
    }

    // Suppress info/debug in tests if configured
    if (this.isTestEnvironment && this.suppressInTests) {
      return false;
    }

    // Suppress info/debug in production if configured
    if (this.isProductionEnvironment && this.suppressInProduction) {
      return false;
    }

    return true;
  }

  private formatMessage(message: string): string {
    return `${this.prefix} ${message}`;
  }

  /**
   * Log an informational message (e.g., "Wrote sitemap.xml")
   * @param {string} message - The message to log
   */
  info(message: string): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage(message));
    }
  }

  /**
   * Log a debug message (e.g., memory stats)
   * @param {string} message - The debug message to log
   */
  debug(message: string): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage(message));
    }
  }

  /**
   * Log a warning message
   * @param {string} message - The warning message to log
   */
  warn(message: string): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage(message));
    }
  }

  /**
   * Log an error message
   * @param {string} message - The error message to log
   * @param {Error | unknown} [error] - Optional error object to log
   */
  error(message: string, error?: Error | unknown): void {
    if (this.shouldLog('error')) {
      if (error) {
        console.error(this.formatMessage(message), error);
      } else {
        console.error(this.formatMessage(message));
      }
    }
  }

  /**
   * Create a child logger with a more specific prefix
   * @param {string} childPrefix - The prefix for the child logger
   * @returns {BuildLogger} A new BuildLogger instance with the child prefix
   */
  child(childPrefix: string): BuildLogger {
    return new BuildLogger({
      prefix: `${this.prefix} [${childPrefix}]`,
      suppressInTests: this.suppressInTests,
      suppressInProduction: this.suppressInProduction,
    });
  }

  /**
   * Force a message to be logged regardless of environment (for critical messages)
   * @param {string} message - The message to force log
   */
  force(message: string): void {
    console.log(this.formatMessage(message));
  }
}

/**
 * Default build logger instance for 11ty plugins
 */
export const buildLogger = new BuildLogger();

/**
 * Create a specialized logger for a specific plugin
 * @param {string} pluginName - The name of the plugin
 * @param {Omit<BuildLogOptions, 'prefix'>} [options] - Options for the logger
 * @returns {BuildLogger} A new BuildLogger instance for the plugin
 */
export function createPluginLogger(pluginName: string, options: Omit<BuildLogOptions, 'prefix'> = {}): BuildLogger {
  return new BuildLogger({
    ...options,
    prefix: `[@dwk/anglesite-11ty] [${pluginName}]`,
  });
}

/**
 * Legacy compatibility function - maintains existing console.log behavior for tests
 * Use this as a drop-in replacement for console.log in plugin files
 * @param {string} message - The message to log
 */
export function pluginLog(message: string): void {
  buildLogger.info(message);
}

export type { BuildLogOptions, LogLevel };
export { BuildLogger };
