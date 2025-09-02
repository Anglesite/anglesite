/**
 * @file Base error classes for structured error handling.
 *
 * Provides a hierarchical error system with categorization, context, and.
 * serialization support for consistent error handling across Anglesite.
 */

/**
 * Error severity levels for categorizing error impact.
 */
export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Error categories for domain-specific grouping.
 */
export enum ErrorCategory {
  SYSTEM = 'SYSTEM',
  NETWORK = 'NETWORK',
  FILE_SYSTEM = 'FILE_SYSTEM',
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  CONFIGURATION = 'CONFIGURATION',
  BUSINESS_LOGIC = 'BUSINESS_LOGIC',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE',
  USER_INPUT = 'USER_INPUT',
  CERTIFICATE = 'CERTIFICATE',
  DNS = 'DNS',
  SERVER = 'SERVER',
  WEBSITE = 'WEBSITE',
  ATOMIC_OPERATION = 'ATOMIC_OPERATION',
}

/**
 * Error metadata for additional context.
 */
export interface ErrorMetadata {
  timestamp?: Date;
  requestId?: string;
  userId?: string;
  websiteId?: string;
  operation?: string;
  resource?: string;
  context?: Record<string, unknown>;
  stack?: string;
  innerErrors?: AngleError[];
  retryCount?: number;
}

/**
 * Serialized error format for logging and transmission.
 */
export interface SerializedError {
  name: string;
  message: string;
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  metadata: ErrorMetadata;
  cause?: SerializedError;
  stack?: string;
}

/**
 * Base error class for all Anglesite errors.
 * Provides structured error information with categorization and context.
 */
export abstract class AngleError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly metadata: ErrorMetadata;
  public readonly timestamp: Date;
  public readonly cause?: Error;

  constructor(
    message: string,
    code: string,
    category: ErrorCategory,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(message);

    this.name = this.constructor.name;
    this.code = code;
    this.category = category;
    this.severity = severity;
    this.timestamp = metadata.timestamp || new Date();

    this.metadata = {
      ...metadata,
      timestamp: this.timestamp,
      stack: this.stack,
    };

    // Maintain proper error chain
    if (cause) {
      (this as Error & { cause?: Error }).cause = cause;
    }

    // Ensure proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error for logging or transmission.
   */
  serialize(): SerializedError {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      metadata: this.metadata,
      cause:
        (this as Error & { cause?: Error }).cause instanceof AngleError
          ? ((this as Error & { cause?: Error }).cause as AngleError).serialize()
          : undefined,
      stack: this.stack,
    };
  }

  /**
   * Convert error to JSON string.
   */
  toJSON(): SerializedError {
    return this.serialize();
  }

  /**
   * Get a user-friendly error message.
   */
  getUserMessage(): string {
    switch (this.severity) {
      case ErrorSeverity.CRITICAL:
        return 'A critical system error occurred. Please contact support.';
      case ErrorSeverity.HIGH:
        return 'An error occurred that requires immediate attention.';
      case ErrorSeverity.MEDIUM:
        return this.message;
      case ErrorSeverity.LOW:
        return this.message;
      default:
        return this.message;
    }
  }

  /**
   * Check if error is recoverable based on category and severity.
   */
  isRecoverable(): boolean {
    if (this.severity === ErrorSeverity.CRITICAL) {
      return false;
    }

    switch (this.category) {
      case ErrorCategory.SYSTEM:
      case ErrorCategory.CONFIGURATION:
        return this.severity !== ErrorSeverity.HIGH;
      case ErrorCategory.NETWORK:
      case ErrorCategory.EXTERNAL_SERVICE:
        return true;
      case ErrorCategory.VALIDATION:
      case ErrorCategory.USER_INPUT:
        return true;
      default:
        return this.severity === ErrorSeverity.LOW || this.severity === ErrorSeverity.MEDIUM;
    }
  }

  /**
   * Get retry delay in milliseconds based on error type.
   */
  getRetryDelay(): number | null {
    if (!this.isRecoverable()) {
      return null;
    }

    switch (this.category) {
      case ErrorCategory.NETWORK:
      case ErrorCategory.EXTERNAL_SERVICE:
        return Math.pow(2, Math.min(this.metadata.retryCount || 0, 5)) * 1000; // Exponential backoff.
      case ErrorCategory.FILE_SYSTEM:
        return 500; // Short delay for file system operations
      default:
        return null;
    }
  }

  /**
   * Add context to the error.
   */
  addContext(key: string, value: unknown): this {
    if (!this.metadata.context) {
      this.metadata.context = {};
    }
    this.metadata.context[key] = value;
    return this;
  }

  /**
   * Create a child error with additional context.
   */
  withContext(context: Record<string, unknown>): this {
    const newError = Object.create(Object.getPrototypeOf(this));

    // Copy all properties
    Object.assign(newError, this);

    // Update metadata with new context
    newError.metadata = {
      ...this.metadata,
      context: { ...this.metadata.context, ...context },
    };

    return newError;
  }

  /**
   * Check if this error or its cause matches a specific error type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  matches(errorClass: new (...args: any[]) => Error): boolean {
    if (this instanceof errorClass) {
      return true;
    }

    const cause = (this as Error & { cause?: Error }).cause;
    if (cause instanceof AngleError) {
      return cause.matches(errorClass);
    }

    return false;
  }

  /**
   * Find the root cause error.
   */
  getRootCause(): Error {
    let current = this as Error;
    while ((current as Error & { cause?: Error }).cause instanceof Error) {
      current = (current as Error & { cause?: Error }).cause as Error;
    }
    return current;
  }
}

/**
 * System-level errors (infrastructure, OS, hardware).
 */
export abstract class SystemError extends AngleError {
  constructor(
    message: string,
    code: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(message, code, ErrorCategory.SYSTEM, severity, metadata, cause);
  }
}

/**
 * Network-related errors (connectivity, timeouts, DNS).
 */
export abstract class NetworkError extends AngleError {
  constructor(
    message: string,
    code: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(message, code, ErrorCategory.NETWORK, severity, metadata, cause);
  }
}

/**
 * File system operation errors.
 */
export abstract class FileSystemError extends AngleError {
  public readonly path?: string;

  constructor(
    message: string,
    code: string,
    path?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      ErrorCategory.FILE_SYSTEM,
      severity,
      {
        ...metadata,
        resource: path,
      },
      cause
    );

    this.path = path;
  }
}

/**
 * Validation errors for input/data validation.
 */
export abstract class ValidationError extends AngleError {
  public readonly field?: string;
  public readonly value?: unknown;

  constructor(
    message: string,
    code: string,
    field?: string,
    value?: unknown,
    severity: ErrorSeverity = ErrorSeverity.LOW,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      ErrorCategory.VALIDATION,
      severity,
      {
        ...metadata,
        context: {
          ...metadata.context,
          field,
          value,
        },
      },
      cause
    );

    this.field = field;
    this.value = value;
  }
}

/**
 * Configuration-related errors.
 */
export abstract class ConfigurationError extends AngleError {
  public readonly configKey?: string;

  constructor(
    message: string,
    code: string,
    configKey?: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      ErrorCategory.CONFIGURATION,
      severity,
      {
        ...metadata,
        context: {
          ...metadata.context,
          configKey,
        },
      },
      cause
    );

    this.configKey = configKey;
  }
}

/**
 * Business logic errors.
 */
export abstract class BusinessLogicError extends AngleError {
  constructor(
    message: string,
    code: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(message, code, ErrorCategory.BUSINESS_LOGIC, severity, metadata, cause);
  }
}

/**
 * External service integration errors.
 */
export abstract class ExternalServiceError extends AngleError {
  public readonly service?: string;

  constructor(
    message: string,
    code: string,
    service?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: Partial<ErrorMetadata> = {},
    cause?: Error
  ) {
    super(
      message,
      code,
      ErrorCategory.EXTERNAL_SERVICE,
      severity,
      {
        ...metadata,
        context: {
          ...metadata.context,
          service,
        },
      },
      cause
    );

    this.service = service;
  }
}
