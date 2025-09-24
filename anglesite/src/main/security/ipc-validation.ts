/**
 * @file IPC input validation utilities for secure inter-process communication
 */
import { logger, sanitize } from '../utils/logging';

/**
 * Validation error for IPC input
 */
export class IPCValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = 'IPCValidationError';
  }
}

/**
 * Configuration options for string validation with security constraints.
 */
interface StringValidationOptions {
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  allowEmpty?: boolean;
  sanitize?: boolean;
}

/**
 * Validates and sanitizes string inputs from IPC calls with comprehensive security checks.
 */
export function validateString(value: unknown, fieldName: string, options: StringValidationOptions = {}): string {
  const { maxLength = 1000, minLength = 0, pattern, allowEmpty = false, sanitize: shouldSanitize = true } = options;

  // Type validation
  if (typeof value !== 'string') {
    logger.warn('IPC validation failed: invalid type', {
      field: fieldName,
      type: typeof value,
      expected: 'string',
    });
    throw new IPCValidationError(`Field '${fieldName}' must be a string`, fieldName);
  }

  // Empty validation
  if (!allowEmpty && value.trim().length === 0) {
    throw new IPCValidationError(`Field '${fieldName}' cannot be empty`, fieldName);
  }

  // Length validation
  if (value.length > maxLength) {
    logger.warn('IPC validation failed: string too long', {
      field: fieldName,
      length: value.length,
      maxLength,
    });
    throw new IPCValidationError(`Field '${fieldName}' exceeds maximum length of ${maxLength}`, fieldName);
  }

  if (value.length < minLength) {
    throw new IPCValidationError(`Field '${fieldName}' is shorter than minimum length of ${minLength}`, fieldName);
  }

  // Pattern validation
  if (pattern && !pattern.test(value)) {
    logger.warn('IPC validation failed: pattern mismatch', {
      field: fieldName,
      pattern: pattern.source,
    });
    throw new IPCValidationError(`Field '${fieldName}' does not match required pattern`, fieldName);
  }

  // Path traversal detection
  if (value.includes('..') || value.includes('~/') || /[<>"|*?]/.test(value)) {
    logger.warn('IPC validation failed: potentially dangerous characters', {
      field: fieldName,
      value: shouldSanitize ? sanitize.path(value) : '[REDACTED]',
    });
    throw new IPCValidationError(`Field '${fieldName}' contains invalid characters`, fieldName);
  }

  return shouldSanitize ? sanitize.path(value) : value;
}

/**
 * Validates website names for IPC calls ensuring alphanumeric characters only.
 */
export function validateWebsiteName(websiteName: unknown): string {
  return validateString(websiteName, 'websiteName', {
    maxLength: 100,
    minLength: 1,
    pattern: /^[a-zA-Z0-9._-]+$/,
    allowEmpty: false,
  });
}

/**
 * Validates file paths for IPC calls preventing path traversal and absolute paths.
 */
export function validateFilePath(filePath: unknown): string {
  const path = validateString(filePath, 'filePath', {
    maxLength: 500,
    minLength: 1,
    allowEmpty: false,
  });

  // Additional path security checks
  if (path.startsWith('/') || path.match(/^[a-zA-Z]:/)) {
    logger.warn('IPC validation failed: absolute path detected', {
      field: 'filePath',
      path: sanitize.path(path),
    });
    throw new IPCValidationError('Absolute paths are not allowed', 'filePath');
  }

  return path;
}

/**
 * Validates content for file operations allowing any characters but enforcing size limits.
 */
export function validateFileContent(content: unknown): string {
  // Type validation only for file content - don't apply path/character restrictions
  if (typeof content !== 'string') {
    logger.warn('IPC validation failed: invalid type', {
      field: 'content',
      type: typeof content,
      expected: 'string',
    });
    throw new IPCValidationError("Field 'content' must be a string", 'content');
  }

  // Length validation
  const maxLength = 10 * 1024 * 1024; // 10MB max
  if (content.length > maxLength) {
    logger.warn('IPC validation failed: content too long', {
      field: 'content',
      length: content.length,
      maxLength,
    });
    throw new IPCValidationError(`Field 'content' exceeds maximum length of ${maxLength}`, 'content');
  }

  // File content can contain any characters - no path traversal or character restrictions
  return content;
}

/**
 * Validates page names for creation ensuring safe characters without path separators.
 */
export function validatePageName(pageName: unknown): string {
  const name = validateString(pageName, 'pageName', {
    maxLength: 100,
    minLength: 1,
    pattern: /^[a-zA-Z0-9._-]+$/,
    allowEmpty: false,
  });

  // Additional page name validation
  if (name.includes('/') || name.includes('\\')) {
    throw new IPCValidationError('Page name cannot contain path separators', 'pageName');
  }

  return name;
}

/**
 * Validates object inputs for IPC calls ensuring proper type and structure.
 */
export function validateObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    logger.warn('IPC validation failed: invalid object type', {
      field: fieldName,
      type: typeof value,
      isArray: Array.isArray(value),
    });
    throw new IPCValidationError(`Field '${fieldName}' must be an object`, fieldName);
  }

  return value as Record<string, unknown>;
}

/**
 * Validates URL inputs for IPC calls restricting to safe protocols only.
 */
export function validateUrl(url: unknown): string {
  const urlString = validateString(url, 'url', {
    maxLength: 500,
    allowEmpty: false,
  });

  try {
    const parsedUrl = new URL(urlString);

    // Only allow safe protocols
    const allowedProtocols = ['http:', 'https:', 'file:'];
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      logger.warn('IPC validation failed: disallowed protocol', {
        field: 'url',
        protocol: parsedUrl.protocol,
        allowedProtocols,
      });
      throw new IPCValidationError('URL protocol not allowed', 'url');
    }

    return urlString;
  } catch (error) {
    logger.warn('IPC validation failed: invalid URL format', {
      field: 'url',
      error: sanitize.error(error),
    });
    throw new IPCValidationError('Invalid URL format', 'url');
  }
}

/**
 * Validates array inputs with element validation and length constraints.
 */
export function validateArray<T>(
  value: unknown,
  fieldName: string,
  elementValidator: (element: unknown, index: number) => T,
  maxLength = 100
): T[] {
  if (!Array.isArray(value)) {
    logger.warn('IPC validation failed: not an array', {
      field: fieldName,
      type: typeof value,
    });
    throw new IPCValidationError(`Field '${fieldName}' must be an array`, fieldName);
  }

  if (value.length > maxLength) {
    logger.warn('IPC validation failed: array too long', {
      field: fieldName,
      length: value.length,
      maxLength,
    });
    throw new IPCValidationError(`Field '${fieldName}' exceeds maximum length of ${maxLength}`, fieldName);
  }

  return value.map((element, index) => {
    try {
      return elementValidator(element, index);
    } catch (error) {
      if (error instanceof IPCValidationError) {
        throw new IPCValidationError(`Array element ${index}: ${error.message}`, `${fieldName}[${index}]`);
      }
      throw error;
    }
  });
}

/**
 * Creates a secure IPC handler wrapper with input validation and error handling.
 */
export function createSecureIPCHandler<T extends unknown[], R>(
  handlerName: string,
  validator: (...args: T) => void,
  handler: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    try {
      // Validate inputs
      validator(...args);

      // Execute handler
      const result = await handler(...args);

      logger.debug('IPC handler completed successfully', {
        handler: handlerName,
        argCount: args.length,
      });

      return result;
    } catch (error) {
      if (error instanceof IPCValidationError) {
        logger.warn('IPC validation failed', {
          handler: handlerName,
          field: error.field,
          error: error.message,
        });
        throw error;
      }

      logger.error('IPC handler error', {
        handler: handlerName,
        error: sanitize.error(error),
      });
      throw error;
    }
  };
}
