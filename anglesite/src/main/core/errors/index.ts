/**
 * @file Anglesite Error System - Main Export.
 *
 * Centralized export for all error handling components in Anglesite.
 * Provides a structured error hierarchy with domain-specific errors,.
 * utilities for error handling, and comprehensive error management.
 */

// Base error system
export {
  AngleError,
  SystemError,
  NetworkError,
  FileSystemError,
  ValidationError,
  ConfigurationError,
  BusinessLogicError,
  ExternalServiceError,
  ErrorSeverity,
  ErrorCategory,
  ErrorMetadata,
  SerializedError,
} from './base';

// Domain-specific errors
export {
  // Website errors
  WebsiteError,
  WebsiteNotFoundError,
  WebsiteCreationError,
  WebsiteDeletionError,
  WebsiteConfigurationError,

  // Server errors
  ServerError,
  ServerStartError,
  ServerStopError,
  PortAlreadyInUseError,

  // DNS errors
  DnsError,
  DnsResolutionError,
  DnsRecordUpdateError,
  HostsFileError,

  // Certificate errors
  CertificateError,
  CertificateGenerationError,
  CertificateValidationError,
  CertificateExpiredError,

  // Atomic operation errors
  AtomicOperationError,
  AtomicWriteError,
  AtomicCopyError,
  RollbackError,

  // Template errors
  TemplateError,
  TemplateNotFoundError,
  TemplateParsingError,

  // Window management errors
  WindowError,
  WindowCreationError,
  WindowNotFoundError,

  // File system specific errors
  FileNotFoundError,
  DirectoryNotFoundError,
  PermissionDeniedError,
  DiskSpaceError,

  // Validation specific errors
  RequiredFieldError,
  InvalidFormatError,
  ValueOutOfRangeError,
} from './domain';

// Re-export base classes with aliases to avoid conflicts
export { ValidationError as BaseValidationError, ConfigurationError as BaseConfigurationError } from './base';

// Error utilities and management
export {
  ErrorUtils,
  ErrorContextManager,
  errorRegistry,
  HandleErrors,
  DefaultErrorHandlers,
  ErrorHandler,
  RecoveryStrategy,
  ErrorReportingConfig,
  ErrorContext,
  ErrorBreadcrumb,
} from './utilities';

// Convenience functions for common error operations
import { ErrorUtils, ErrorContextManager, errorRegistry } from './utilities';
import {
  AngleError,
  ErrorSeverity,
  ErrorCategory,
  ValidationError as BaseValidationErrorType,
  ConfigurationError as BaseConfigurationErrorType,
} from './base';

/**
 * Create a generic system error.
 */
export function createSystemError(
  message: string,
  code: string,
  severity: ErrorSeverity = ErrorSeverity.HIGH,
  metadata?: Record<string, unknown>,
  cause?: Error
): AngleError {
  return new (class extends AngleError {
    constructor() {
      super(message, code, ErrorCategory.SYSTEM, severity, metadata, cause);
    }
  })();
}

/**
 * Wrap any error in an AngleError.
 */
export const wrapError = ErrorUtils.wrap;

/**
 * Execute operation with error handling.
 */
export const withErrorHandling = ErrorUtils.withRecovery;

/**
 * Execute operation with retries.
 */
export const withRetry = ErrorUtils.withRetry;

/**
 * Execute operation with error context.
 */
export const withContext = ErrorContextManager.withContext.bind(ErrorContextManager);

/**
 * Format error for display.
 */
export const formatError = ErrorUtils.format;

/**
 * Register global error handler.
 */
export function registerErrorHandler(errorType: string, handler: (error: AngleError) => void | Promise<void>): void {
  errorRegistry.registerHandler(errorType, handler);
}

/**
 * Configure error reporting settings for the global error registry.
 */
export function configureErrorReporting(config: {
  enabled?: boolean;
  endpoint?: string;
  apiKey?: string;
  includeStackTrace?: boolean;
  includeBreadcrumbs?: boolean;
  environment?: string;
  version?: string;
}): void {
  errorRegistry.configure(config);
}

/**
 * Add error breadcrumb for context tracking.
 */
export function addErrorBreadcrumb(
  message: string,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info',
  category: string = 'general',
  data?: Record<string, unknown>
): void {
  errorRegistry.addBreadcrumb({
    timestamp: new Date(),
    level,
    message,
    category,
    data,
  });
}

/**
 * Handle error through the error system.
 */
export async function handleError(error: unknown): Promise<void> {
  const angleError = ErrorUtils.wrap(error);
  await errorRegistry.handleError(angleError);
}

/**
 * Common error patterns and factory functions.
 */
export const ErrorFactories = {
  /**
   * Create a not found error.
   */
  notFound: (resource: string, resourceType: string = 'Resource') =>
    createSystemError(`${resourceType} not found: ${resource}`, 'RESOURCE_NOT_FOUND', ErrorSeverity.MEDIUM, {
      resource,
      resourceType,
    }),

  /**
   * Create a validation error.
   */
  validation: (field: string, value: unknown, message?: string) => {
    return new (class extends BaseValidationErrorType {
      constructor() {
        super(message || `Invalid value for ${field}`, 'VALIDATION_ERROR', field, value);
      }
    })();
  },

  /**
   * Create a permission error.
   */
  permission: (operation: string, resource?: string) =>
    createSystemError(
      `Permission denied for ${operation}${resource ? ` on ${resource}` : ''}`,
      'PERMISSION_DENIED',
      ErrorSeverity.HIGH,
      { operation, resource }
    ),

  /**
   * Create a timeout error.
   */
  timeout: (operation: string, duration: number) =>
    createSystemError(`Operation timed out: ${operation} (${duration}ms)`, 'OPERATION_TIMEOUT', ErrorSeverity.MEDIUM, {
      operation,
      duration,
    }),

  /**
   * Create a configuration error.
   */
  configuration: (key: string, message?: string) => {
    return new (class extends BaseConfigurationErrorType {
      constructor() {
        super(message || `Invalid configuration: ${key}`, 'CONFIGURATION_ERROR', key);
      }
    })();
  },
};

/**
 * Type guards for error checking.
 */
export const ErrorChecks = {
  /**
   * Check if error is a specific AngleError type.
   */
  isAngleError: (error: unknown): error is AngleError => error instanceof AngleError,

  /**
   * Check if error is recoverable.
   */
  isRecoverable: (error: unknown): boolean => error instanceof AngleError && error.isRecoverable(),

  /**
   * Check if error is critical.
   */
  isCritical: (error: unknown): boolean => error instanceof AngleError && error.severity === ErrorSeverity.CRITICAL,

  /**
   * Check if error matches specific category.
   */
  isCategory: (error: unknown, category: ErrorCategory): boolean =>
    error instanceof AngleError && error.category === category,

  /**
   * Check if error matches specific code.
   */
  isCode: (error: unknown, code: string): boolean => error instanceof AngleError && error.code === code,
};
