/**
 * @file Secure logging utilities that sanitize PII and sensitive information
 */

import { basename } from 'path';
import * as os from 'os';

/**
 * Sanitizes file paths to remove PII (usernames, sensitive directories).
 */
export function sanitizePath(filePath: string): string {
  if (!filePath) return '[empty-path]';

  try {
    const homeDir = os.homedir();
    const username = os.userInfo().username;

    // Replace home directory with placeholder
    let sanitized = filePath.replace(homeDir, '~');

    // Replace username in paths
    if (username) {
      const usernameRegex = new RegExp(`/${username}/`, 'g');
      sanitized = sanitized.replace(usernameRegex, '/[user]/');
    }

    // Replace other common sensitive patterns
    sanitized = sanitized
      .replace(/\/Users\/[^/]+\//g, '/Users/[user]/')
      .replace(/\/home\/[^/]+\//g, '/home/[user]/')
      .replace(/\\Users\\[^\\]+\\/g, '\\Users\\[user]\\')
      .replace(/C:\\Users\\[^\\]+\\/g, 'C:\\Users\\[user]\\');

    return sanitized;
  } catch {
    // Fallback: just show filename if sanitization fails
    return `[sanitized]/${basename(filePath)}`;
  }
}

/**
 * Sanitizes error messages to remove sensitive information.
 */
export function sanitizeError(error: unknown): string {
  if (!error) return '[no-error]';

  let message = error instanceof Error ? error.message : String(error);

  try {
    // Remove file paths from error messages
    message = message.replace(/\/[^\s]*\/[^\s]*/g, (match) => sanitizePath(match));

    // Remove potential API keys or tokens (common patterns)
    message = message
      .replace(/([a-zA-Z0-9]{32,})/g, '[REDACTED-TOKEN]')
      .replace(/Bearer\s+[^\s]+/g, 'Bearer [REDACTED]')
      .replace(/token[=:]\s*[^\s]+/gi, 'token=[REDACTED]')
      .replace(/key[=:]\s*[^\s]+/gi, 'key=[REDACTED]')
      .replace(/password[=:]\s*[^\s]+/gi, 'password=[REDACTED]');

    return message;
  } catch {
    return '[error-sanitization-failed]';
  }
}

/**
 * Log levels for structured logging
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

/**
 * Secure logger that sanitizes sensitive information
 */
export class SecureLogger {
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const sanitizedMessage = this.sanitizeMessage(message);

    let formatted = `[${timestamp}] [${level.toUpperCase()}] ${sanitizedMessage}`;

    if (context && this.isDevelopment) {
      const sanitizedContext = this.sanitizeContext(context);
      formatted += ` ${JSON.stringify(sanitizedContext)}`;
    }

    return formatted;
  }

  private sanitizeMessage(message: string): string {
    return sanitizeError(message);
  }

  private sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        sanitized[key] = key.toLowerCase().includes('path') ? sanitizePath(value) : sanitizeError(value);
      } else if (key.toLowerCase().includes('path') && typeof value === 'object' && value !== null) {
        sanitized[key] = '[REDACTED-PATH-OBJECT]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.error(this.formatMessage(LogLevel.ERROR, message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(this.formatMessage(LogLevel.WARN, message, context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.log(this.formatMessage(LogLevel.INFO, message, context));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.isDevelopment) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }
}

// Export default logger instance
export const logger = new SecureLogger();

/**
 * Quick sanitization functions for immediate use
 */
export const sanitize = {
  path: sanitizePath,
  error: sanitizeError,
  message: (message: string) => sanitizeError(message),
};
