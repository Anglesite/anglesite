/**
 * @file Friendly error message catalog and utilities
 *
 * Provides user-friendly error messages for common failure scenarios.
 * Maps technical error codes and patterns to human-readable messages
 * with actionable recovery suggestions.
 */

import { ErrorCategory, ErrorSeverity } from '../types/errors';

/**
 * Template for rendering user-friendly error messages
 */
export interface ErrorMessageTemplate {
  title: string;
  message: string | ((context: Record<string, unknown>) => string);
  suggestion?: string | ((context: Record<string, unknown>) => string);
  category: ErrorCategory;
  severity: ErrorSeverity;
  isRetryable: boolean;
  isDismissible: boolean;
}

/**
 * Rendered error message with resolved strings
 */
export interface RenderedErrorMessage {
  title: string;
  message: string;
  suggestion?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  isRetryable: boolean;
  isDismissible: boolean;
}

/**
 * Pattern matcher for classifying errors by message content
 */
interface ErrorPattern {
  pattern: RegExp | string;
  key: string;
}

/**
 * Centralized catalog of user-friendly error messages
 * Maps error keys to display templates
 */
export const MESSAGE_CATALOG: Readonly<Record<string, ErrorMessageTemplate>> = {
  // ========================================
  // NETWORK ERRORS
  // ========================================
  NETWORK_CONNECTION_REFUSED: {
    title: 'Connection Failed',
    message: "Can't connect to the server",
    suggestion: 'The server may not be running. Try starting it from the menu or check your network connection.',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: true,
    isDismissible: true,
  },

  NETWORK_TIMEOUT: {
    title: 'Request Timed Out',
    message: 'The operation took too long to complete',
    suggestion: 'The server might be slow or unresponsive. Try again, or check your network connection.',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: true,
    isDismissible: true,
  },

  NETWORK_CONNECTION_RESET: {
    title: 'Connection Lost',
    message: 'The connection to the server was interrupted',
    suggestion: 'This usually happens when the server restarts or crashes. Try again in a moment.',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: true,
    isDismissible: true,
  },

  NETWORK_DNS_FAILED: {
    title: 'Server Not Found',
    message: 'Could not find the server address',
    suggestion: 'Check that the server address is correct and your network connection is working.',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: true,
    isDismissible: true,
  },

  NETWORK_OFFLINE: {
    title: 'No Internet Connection',
    message: 'Your computer appears to be offline',
    suggestion: 'Check your network connection and try again.',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: true,
    isDismissible: true,
  },

  // ========================================
  // FILE SYSTEM ERRORS
  // ========================================
  FILE_NOT_FOUND: {
    title: 'File Not Found',
    message: (ctx) =>
      ctx.filename ? `The file "${ctx.filename}" could not be found` : 'The requested file could not be found',
    suggestion: 'The file may have been moved, renamed, or deleted. Check that it exists and try again.',
    category: ErrorCategory.FILE_SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  FILE_PERMISSION_DENIED: {
    title: 'Permission Denied',
    message: (ctx) =>
      ctx.filename
        ? `You don't have permission to access "${ctx.filename}"`
        : "You don't have permission to access this file",
    suggestion: 'Check the file permissions or try running the application with appropriate access rights.',
    category: ErrorCategory.FILE_SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  FILE_ALREADY_EXISTS: {
    title: 'File Already Exists',
    message: (ctx) => (ctx.filename ? `A file named "${ctx.filename}" already exists` : 'The file already exists'),
    suggestion: 'Choose a different name or delete the existing file first.',
    category: ErrorCategory.FILE_SYSTEM,
    severity: ErrorSeverity.LOW,
    isRetryable: false,
    isDismissible: true,
  },

  FILE_NOT_DIRECTORY: {
    title: 'Not a Directory',
    message: 'The path you specified is not a directory',
    suggestion: 'Check that you are using the correct path and try again.',
    category: ErrorCategory.FILE_SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  FILE_IS_DIRECTORY: {
    title: 'Is a Directory',
    message: 'The path you specified is a directory, not a file',
    suggestion: 'Specify a file path instead of a directory path.',
    category: ErrorCategory.FILE_SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  FILE_DISK_FULL: {
    title: 'Disk Full',
    message: 'There is not enough disk space to complete the operation',
    suggestion: 'Free up some disk space and try again.',
    category: ErrorCategory.FILE_SYSTEM,
    severity: ErrorSeverity.HIGH,
    isRetryable: false,
    isDismissible: true,
  },

  // ========================================
  // VALIDATION ERRORS
  // ========================================
  VALIDATION_INVALID_JSON: {
    title: 'Invalid Data Format',
    message: 'The configuration file contains invalid JSON',
    suggestion: 'Check the file for syntax errors like missing commas or quotes, or restore from a backup.',
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  VALIDATION_SCHEMA_MISMATCH: {
    title: 'Invalid Configuration',
    message: 'The configuration does not match the expected format',
    suggestion: 'Check that all required fields are present and have the correct data types.',
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  VALIDATION_REQUIRED_FIELD: {
    title: 'Missing Required Field',
    message: (ctx) => (ctx.field ? `The field "${ctx.field}" is required` : 'A required field is missing'),
    suggestion: 'Fill in all required fields and try again.',
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
    isRetryable: false,
    isDismissible: true,
  },

  // ========================================
  // CONFIGURATION ERRORS
  // ========================================
  CONFIG_MISSING_WEBSITE: {
    title: 'No Website Selected',
    message: 'You need to select or create a website first',
    suggestion: 'Create a new website or select an existing one from the sidebar.',
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  CONFIG_INVALID_WEBSITE_NAME: {
    title: 'Invalid Website Name',
    message: 'The website name contains invalid characters',
    suggestion: 'Use only letters, numbers, hyphens, and underscores in website names.',
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.LOW,
    isRetryable: false,
    isDismissible: true,
  },

  CONFIG_SERVER_NOT_STARTED: {
    title: 'Server Not Running',
    message: 'The website server has not been started',
    suggestion: 'Start the development server from the menu before accessing the website.',
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: false,
    isDismissible: true,
  },

  // ========================================
  // SERVER ERRORS
  // ========================================
  SERVER_START_FAILED: {
    title: 'Server Start Failed',
    message: 'Could not start the development server',
    suggestion: (ctx) =>
      ctx.port
        ? `Port ${ctx.port} may already be in use. Try closing other applications and try again.`
        : 'The port may already be in use. Try closing other applications and try again.',
    category: ErrorCategory.SERVER,
    severity: ErrorSeverity.HIGH,
    isRetryable: true,
    isDismissible: true,
  },

  SERVER_CRASHED: {
    title: 'Server Crashed',
    message: 'The development server stopped unexpectedly',
    suggestion: 'Check the console for error details and try restarting the server.',
    category: ErrorCategory.SERVER,
    severity: ErrorSeverity.HIGH,
    isRetryable: true,
    isDismissible: true,
  },

  // ========================================
  // GENERIC/UNKNOWN ERRORS
  // ========================================
  UNKNOWN: {
    title: 'An Error Occurred',
    message: 'An unexpected error occurred',
    suggestion: 'Try again, or check the technical details below for more information.',
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: true,
    isDismissible: true,
  },
};

/**
 * Patterns for matching error messages to error keys
 * Ordered by specificity (most specific first)
 */
export const ERROR_PATTERNS: ReadonlyArray<ErrorPattern> = [
  // Network errors - specific patterns first
  { pattern: /econnrefused|connection refused/i, key: 'NETWORK_CONNECTION_REFUSED' },
  { pattern: /etimedout|timed? ?out|timeout/i, key: 'NETWORK_TIMEOUT' },
  { pattern: /econnreset|connection reset/i, key: 'NETWORK_CONNECTION_RESET' },
  { pattern: /enotfound|getaddrinfo|dns/i, key: 'NETWORK_DNS_FAILED' },
  { pattern: /network error|offline/i, key: 'NETWORK_OFFLINE' },

  // File system errors
  { pattern: /enoent|no such file|not found/i, key: 'FILE_NOT_FOUND' },
  { pattern: /eacces|eaccess|permission denied|access denied/i, key: 'FILE_PERMISSION_DENIED' },
  { pattern: /eexist|already exists/i, key: 'FILE_ALREADY_EXISTS' },
  { pattern: /enotdir|not a directory/i, key: 'FILE_NOT_DIRECTORY' },
  { pattern: /eisdir|is a directory/i, key: 'FILE_IS_DIRECTORY' },
  { pattern: /enospc|no space|disk full/i, key: 'FILE_DISK_FULL' },

  // Validation errors
  { pattern: /unexpected token|json\.parse|invalid json|parse.*json/i, key: 'VALIDATION_INVALID_JSON' },
  { pattern: /schema.*invalid|invalid.*schema|does not match schema/i, key: 'VALIDATION_SCHEMA_MISMATCH' },
  { pattern: /required field|field.*required|missing.*required/i, key: 'VALIDATION_REQUIRED_FIELD' },

  // Configuration errors
  { pattern: /no website|website.*not.*selected|select.*website/i, key: 'CONFIG_MISSING_WEBSITE' },
  { pattern: /invalid.*website.*name|website.*name.*invalid/i, key: 'CONFIG_INVALID_WEBSITE_NAME' },
  { pattern: /server.*not.*started|server.*not.*running/i, key: 'CONFIG_SERVER_NOT_STARTED' },

  // Server errors
  { pattern: /server.*start.*failed|failed.*start.*server|eaddrinuse/i, key: 'SERVER_START_FAILED' },
  { pattern: /server.*crashed|server.*stopped/i, key: 'SERVER_CRASHED' },
];

/**
 * Match an error against known patterns to classify it
 * @param error The error to classify
 * @returns The message key for the matched pattern, or 'UNKNOWN' if no match
 */
export function matchErrorPattern(error: Error): string {
  if (!error || !error.message) {
    return 'UNKNOWN';
  }

  const message = error.message.toLowerCase();

  // Try to match against known patterns
  for (const { pattern, key } of ERROR_PATTERNS) {
    if (typeof pattern === 'string') {
      if (message.includes(pattern.toLowerCase())) {
        return key;
      }
    } else {
      if (pattern.test(error.message)) {
        return key;
      }
    }
  }

  return 'UNKNOWN';
}

/**
 * Render a message template with the given context
 * @param template The template to render
 * @param context Context data for dynamic templates
 * @returns The rendered message with resolved strings
 */
export function renderTemplate(template: ErrorMessageTemplate, context: Record<string, unknown>): RenderedErrorMessage {
  try {
    // Render message
    const message = typeof template.message === 'function' ? template.message(context) : template.message;

    // Render suggestion if present
    const suggestion = template.suggestion
      ? typeof template.suggestion === 'function'
        ? template.suggestion(context)
        : template.suggestion
      : undefined;

    return {
      title: template.title,
      message,
      suggestion,
      category: template.category,
      severity: template.severity,
      isRetryable: template.isRetryable,
      isDismissible: template.isDismissible,
    };
  } catch (error) {
    // If template rendering fails, return safe fallback
    return {
      title: 'An Error Occurred',
      message: 'An unexpected error occurred while displaying the error message',
      suggestion: 'Check the technical details for more information',
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.MEDIUM,
      isRetryable: false,
      isDismissible: true,
    };
  }
}
