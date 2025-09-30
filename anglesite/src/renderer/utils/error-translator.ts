/**
 * @file Error translator for converting technical errors to user-friendly messages
 *
 * Translates technical errors (AngleError or plain Error) into user-friendly
 * FriendlyError format with sanitization and context enrichment.
 */

import { ErrorCategory, ErrorSeverity } from '../types/errors';
import { MESSAGE_CATALOG, matchErrorPattern, renderTemplate, ErrorMessageTemplate } from './friendly-error-messages';

/**
 * Context for error translation
 */
export interface TranslationContext {
  channel?: string;
  operation?: string;
  resource?: string;
  filename?: string;
  retryCount?: number;
  maxRetries?: number;
  environment?: 'development' | 'production';
  showDetails?: boolean;
  severityOverride?: ErrorSeverity;
  [key: string]: unknown;
}

/**
 * User-friendly error with all information needed for display
 */
export interface FriendlyError {
  // User-facing content
  title: string;
  message: string;
  suggestion?: string;

  // Technical details (hidden by default)
  technicalMessage: string;
  errorCode?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;

  // Actions
  isRetryable: boolean;
  isDismissible: boolean;
  showDetails: boolean;

  // Context
  context?: {
    channel?: string;
    operation?: string;
    resource?: string;
    retryCount?: number;
    maxRetries?: number;
    [key: string]: unknown;
  };

  // Original error for logging/telemetry
  originalError: Error;
}

/**
 * Maximum length for displayed error messages
 */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Patterns for sensitive data that should be redacted
 */
const SENSITIVE_PATTERNS = [
  /token[=:\s]+[a-zA-Z0-9_-]+/gi,
  /password[=:\s]+\S+/gi,
  /api[_-]?key[=:\s]+[a-zA-Z0-9_-]+/gi,
  /secret[=:\s]+\S+/gi,
  /auth[=:\s]+[a-zA-Z0-9_-]+/gi,
];

/**
 * Sanitize a file path by extracting just the basename.
 * Removes user directories and sensitive path information.
 */
export function sanitizePath(path: string): string {
  if (!path) return '';

  // Extract basename from Unix or Windows path
  const unixBasename = path.split('/').pop() || '';
  const windowsBasename = unixBasename.split('\\').pop() || '';

  return windowsBasename;
}

/**
 * Sanitize a stack trace by removing user paths
 */
export function sanitizeStackTrace(stack: string): string {
  if (!stack) return '';

  return (
    stack
      // Remove full paths, keep just filename and line number
      .replace(/\/Users\/[^/]+\/[^\s:)]+/g, (match) => sanitizePath(match))
      .replace(/C:\\Users\\[^\\]+\\[^\s:)]+/gi, (match) => sanitizePath(match))
      // Remove other common user directory patterns
      .replace(/\/home\/[^/]+\/[^\s:)]+/g, (match) => sanitizePath(match))
      .replace(/\/var\/folders\/[^\s:)]+/g, (match) => sanitizePath(match))
  );
}

/**
 * Redact sensitive information from a string
 */
function redactSensitiveData(text: string): string {
  if (!text) return '';

  let sanitized = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      const key = match.split(/[=:\s]/)[0];
      return `${key}=[REDACTED]`;
    });
  }

  return sanitized;
}

/**
 * Extract filename from error message if present
 */
function extractFilenameFromMessage(message: string): string | undefined {
  // Try to extract filename from common patterns
  const patterns = [
    /['"]([^'"]+\.[a-zA-Z0-9]+)['"]/, // "file.txt" or 'file.txt'
    /:\s+([^\s:]+\.[a-zA-Z0-9]+)/, // : file.txt
    /file\s+['"]?([^\s'"]+)['"]?/i, // file "something.txt"
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return sanitizePath(match[1]);
    }
  }

  return undefined;
}

/**
 * Truncate a message to maximum length
 */
function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) {
    return message;
  }

  return message.substring(0, maxLength - 3) + '...';
}

/**
 * Check if an error has AngleError-like properties (duck typing).
 * We can't use instanceof since AngleError is in the main process.
 */
function isAngleErrorLike(error: Error): error is Error & {
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  metadata: Record<string, unknown>;
} {
  return (
    'code' in error &&
    typeof (error as unknown as { code: unknown }).code === 'string' &&
    'category' in error &&
    'severity' in error
  );
}

/**
 * Get the error code from an error.
 */
function getErrorCode(error: Error): string | undefined {
  if (isAngleErrorLike(error)) {
    return error.code;
  }

  // Try to extract code from error properties
  const errorWithCode = error as Error & { code?: string };
  return errorWithCode.code;
}

/**
 * Get the error category from an error.
 */
function getErrorCategory(error: Error): ErrorCategory | undefined {
  if (isAngleErrorLike(error)) {
    return error.category;
  }

  return undefined;
}

/**
 * Get the error severity from an error.
 */
function getErrorSeverity(error: Error): ErrorSeverity | undefined {
  if (isAngleErrorLike(error)) {
    return error.severity;
  }

  return undefined;
}

/**
 * Translate an error to a user-friendly format
 * @param error The error to translate
 * @param context Additional context for translation
 * @returns A FriendlyError with user-facing and technical information
 */
export function translateError(error: Error, context: TranslationContext = {}): FriendlyError {
  // Handle null/undefined errors
  if (!error) {
    return createFallbackError(new Error('Unknown error'), context);
  }

  try {
    // Extract error information
    const errorCode = getErrorCode(error);
    const errorCategory = getErrorCategory(error);
    const errorSeverity = getErrorSeverity(error);

    // Build context for template rendering
    const templateContext: Record<string, unknown> = {
      ...context,
    };

    // Add metadata from AngleError-like errors
    if (isAngleErrorLike(error) && error.metadata) {
      const metadata = error.metadata as {
        resource?: string;
        operation?: string;
        context?: Record<string, unknown>;
      };

      if (metadata.resource) {
        templateContext.resource = sanitizePath(metadata.resource);
        // Also set as filename if it looks like a file
        if (metadata.resource.includes('.')) {
          templateContext.filename = sanitizePath(metadata.resource);
        }
      }
      templateContext.operation = metadata.operation || context.operation;

      // Extract field from validation errors
      if (metadata.context?.field) {
        templateContext.field = metadata.context.field;
      }
    }

    // Try to extract filename from message if not in context
    if (!templateContext.filename && error.message) {
      templateContext.filename = extractFilenameFromMessage(error.message);
    }

    // Also try to extract filename from Windows-style paths in the message
    if (!templateContext.filename && error.message) {
      const windowsMatch = error.message.match(/[A-Z]:\\(?:[^\\]+\\)*([^\\]+\.[a-zA-Z0-9]+)/);
      if (windowsMatch && windowsMatch[1]) {
        templateContext.filename = windowsMatch[1];
      }
    }

    // Determine which message template to use
    let template: ErrorMessageTemplate | undefined;
    let matchedKey: string | undefined;

    if (errorCode && MESSAGE_CATALOG[errorCode]) {
      // Direct code lookup (fastest, most accurate)
      template = MESSAGE_CATALOG[errorCode];
      matchedKey = errorCode;
    } else {
      // Pattern matching fallback
      matchedKey = matchErrorPattern(error);
      template = MESSAGE_CATALOG[matchedKey];
    }

    // Render the template
    const rendered = renderTemplate(template, templateContext);

    // Prepare technical message
    const environment = context.environment || (process.env.NODE_ENV as 'development' | 'production');
    let technicalMessage = error.message || 'No error message available';

    // Add stack trace in development
    if (environment === 'development' && error.stack) {
      technicalMessage = `${technicalMessage}\n\n${sanitizeStackTrace(error.stack)}`;
    } else {
      // Sanitize message in production
      technicalMessage = redactSensitiveData(technicalMessage);
      technicalMessage = sanitizePath(technicalMessage);
    }

    // Build the friendly error
    const friendlyError: FriendlyError = {
      title: rendered.title,
      message: truncateMessage(rendered.message, MAX_MESSAGE_LENGTH),
      suggestion: rendered.suggestion,
      technicalMessage: truncateMessage(technicalMessage, MAX_MESSAGE_LENGTH * 2),
      errorCode: errorCode || matchedKey,
      category: context.severityOverride ? errorCategory || rendered.category : rendered.category,
      severity: context.severityOverride || errorSeverity || rendered.severity,
      isRetryable: rendered.isRetryable,
      isDismissible: rendered.isDismissible,
      showDetails: context.showDetails !== undefined ? context.showDetails : matchedKey === 'UNKNOWN',
      context: {
        channel: context.channel,
        operation: context.operation,
        resource: templateContext.resource as string | undefined,
        retryCount: context.retryCount,
        maxRetries: context.maxRetries,
      },
      originalError: error,
    };

    return friendlyError;
  } catch (translationError) {
    // If translation fails, return a safe fallback
    return createFallbackError(error, context);
  }
}

/**
 * Create a fallback error when translation fails
 */
function createFallbackError(error: Error, context: TranslationContext): FriendlyError {
  return {
    title: 'An Error Occurred',
    message: 'An unexpected error occurred',
    suggestion: 'Try again, or check the technical details below for more information.',
    technicalMessage: error?.message || 'Unknown error',
    errorCode: 'UNKNOWN',
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    isRetryable: true,
    isDismissible: true,
    showDetails: true,
    context: {
      channel: context.channel,
      operation: context.operation,
    },
    originalError: error || new Error('Unknown error'),
  };
}
