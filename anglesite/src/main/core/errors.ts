/**
 * @file Structured Error System
 *
 * Provides a comprehensive error handling framework with typed errors,
 * severity levels, categories, and utilities for error management.
 */

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  SYSTEM = 'system',
  NETWORK = 'network',
  FILE_SYSTEM = 'file_system',
  BUSINESS_LOGIC = 'business_logic',
  VALIDATION = 'validation',
  ATOMIC_OPERATION = 'atomic_operation',
  SECURITY = 'security',
  USER_INPUT = 'user_input',
  SERVICE_MANAGEMENT = 'service_management',
  IPC_COMMUNICATION = 'ipc_communication',
  UI_COMPONENT = 'ui_component',
  FILE_OPERATION = 'file_operation',
  WEBSITE_MANAGEMENT = 'website_management',
  EXPORT_OPERATION = 'export_operation',
}

/**
 * Metadata structure for errors
 */
export interface ErrorMetadata {
  context?: Record<string, unknown>;
  operation?: string;
  recoverable?: boolean;
  retryable?: boolean;
  userMessage?: string;
  stack?: string;
  expectedFormat?: string;
  originalValue?: unknown;
  [key: string]: unknown; // Allow additional fields
}

/**
 * Serialized error format for persistence and transmission
 */
export interface SerializedError {
  name: string;
  message: string;
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  metadata: ErrorMetadata;
  timestamp: string;
  cause?: SerializedError;
}

/**
 * Base error class for all Anglesite errors
 */
export class AngleError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly timestamp: Date;
  public metadata: ErrorMetadata;
  public cause?: Error;

  constructor(
    message: string,
    code: string,
    category: ErrorCategory = ErrorCategory.SYSTEM,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: ErrorMetadata = {},
    cause?: Error,
    timestamp?: Date
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.category = category;
    this.severity = severity;
    this.timestamp = timestamp || new Date();
    this.metadata = metadata;
    this.cause = cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Check if the error is recoverable
   */
  isRecoverable(): boolean {
    if (this.metadata.recoverable !== undefined) {
      return this.metadata.recoverable;
    }
    return this.severity !== ErrorSeverity.CRITICAL;
  }

  /**
   * Get retry delay in milliseconds
   */
  getRetryDelay(): number {
    if (this.category === ErrorCategory.NETWORK) {
      return 1000; // 1 second for network errors
    }
    return 100; // Default 100ms
  }

  /**
   * Add context to the error
   */
  addContext(key: string, value: unknown): void {
    if (!this.metadata.context) {
      this.metadata.context = {};
    }
    this.metadata.context[key] = value;
  }

  /**
   * Create a new error with additional context
   */
  withContext(context: Record<string, unknown>): AngleError {
    const newMetadata = {
      ...this.metadata,
      context: { ...this.metadata.context, ...context },
    };

    // Create a new instance of the same error type
    const newError = Object.create(Object.getPrototypeOf(this));
    Object.assign(newError, this);
    newError.metadata = newMetadata;

    return newError;
  }

  /**
   * Get the root cause of the error chain
   */
  getRootCause(): Error {
    let current: Error = this;
    while (current instanceof AngleError && current.cause) {
      current = current.cause;
    }
    return current;
  }

  /**
   * Serialize the error for persistence or transmission
   */
  serialize(): SerializedError {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      metadata: {
        ...this.metadata,
        stack: this.stack,
      },
      timestamp: this.timestamp.toISOString(),
      cause: this.cause instanceof AngleError ? this.cause.serialize() : undefined,
    };
  }

  /**
   * Convert to JSON
   */
  toJSON(): SerializedError {
    return this.serialize();
  }
}

/**
 * Website-related errors
 */
export class WebsiteError extends AngleError {
  public readonly websiteId?: string;
  public readonly websitePath?: string;

  constructor(
    message: string,
    code: string,
    websiteId?: string,
    websitePath?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata: ErrorMetadata = {},
    cause?: Error
  ) {
    super(message, code, ErrorCategory.BUSINESS_LOGIC, severity, metadata, cause);
    this.websiteId = websiteId;
    this.websitePath = websitePath;
    if (websiteId) this.addContext('websiteId', websiteId);
    if (websitePath) this.addContext('websitePath', websitePath);
  }
}

export class WebsiteNotFoundError extends WebsiteError {
  constructor(websiteId: string, metadata?: ErrorMetadata) {
    super(`Website not found: ${websiteId}`, 'WEBSITE_NOT_FOUND', websiteId, undefined, ErrorSeverity.MEDIUM, metadata);
  }
}

/**
 * Server-related errors
 */
export class ServerError extends AngleError {
  public readonly port?: number;
  public readonly serverId?: string;

  constructor(
    message: string,
    code: string,
    port?: number,
    serverId?: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    metadata: ErrorMetadata = {},
    cause?: Error
  ) {
    super(message, code, ErrorCategory.SYSTEM, severity, metadata, cause);
    this.port = port;
    this.serverId = serverId;
    if (port) this.addContext('port', port);
    if (serverId) this.addContext('serverId', serverId);
  }
}

export class ServerStartError extends ServerError {
  constructor(port: number, reason: string, metadata?: ErrorMetadata) {
    super(
      `Failed to start server on port ${port}: ${reason}`,
      'SERVER_START_FAILED',
      port,
      undefined,
      ErrorSeverity.HIGH,
      metadata
    );
  }
}

/**
 * Atomic operation errors
 */
export class AtomicOperationError extends AngleError {
  public readonly operationType: string;
  public readonly rollbackPerformed: boolean;
  public readonly temporaryPaths?: string[];

  constructor(
    message: string,
    code: string,
    operationType: string,
    rollbackPerformed: boolean,
    temporaryPaths?: string[],
    metadata?: ErrorMetadata,
    cause?: Error
  ) {
    super(message, code, ErrorCategory.ATOMIC_OPERATION, ErrorSeverity.HIGH, metadata, cause);
    this.operationType = operationType;
    this.rollbackPerformed = rollbackPerformed;
    this.temporaryPaths = temporaryPaths;
    this.addContext('operationType', operationType);
    this.addContext('rollbackPerformed', rollbackPerformed);
  }
}

/**
 * File system errors
 */
export class FileNotFoundError extends AngleError {
  public readonly path: string;

  constructor(path: string, metadata?: ErrorMetadata) {
    super(`File not found: ${path}`, 'FILE_NOT_FOUND', ErrorCategory.FILE_SYSTEM, ErrorSeverity.MEDIUM, metadata);
    this.path = path;
    this.addContext('path', path);
  }
}

export class DirectoryNotFoundError extends AngleError {
  public readonly path: string;

  constructor(path: string, metadata?: ErrorMetadata) {
    super(
      `Directory not found: ${path}`,
      'DIRECTORY_NOT_FOUND',
      ErrorCategory.FILE_SYSTEM,
      ErrorSeverity.MEDIUM,
      metadata
    );
    this.path = path;
    this.addContext('path', path);
  }
}

/**
 * System-level errors
 */
export class SystemError extends AngleError {
  constructor(
    message: string,
    code: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    metadata?: ErrorMetadata,
    cause?: Error
  ) {
    super(message, code, ErrorCategory.SYSTEM, severity, metadata, cause);
  }
}

/**
 * Atomic write operation error
 */
export class AtomicWriteError extends AtomicOperationError {
  constructor(message: string, temporaryPath?: string, targetPath?: string, metadata?: ErrorMetadata) {
    super(message, 'ATOMIC_WRITE_FAILED', 'write', false, temporaryPath ? [temporaryPath] : undefined, {
      ...metadata,
      targetPath,
    });
  }
}

/**
 * Validation errors
 */
export class ValidationError extends AngleError {
  public readonly field?: string;
  public readonly value?: unknown;

  constructor(message: string, code: string, field?: string, value?: unknown, metadata?: ErrorMetadata) {
    super(message, code, ErrorCategory.VALIDATION, ErrorSeverity.LOW, metadata);
    this.field = field;
    this.value = value;
    if (field) this.addContext('field', field);
    if (value !== undefined) this.addContext('value', value);
  }
}

export class RequiredFieldError extends ValidationError {
  constructor(field: string, metadata?: ErrorMetadata) {
    super(`Required field missing: ${field}`, 'REQUIRED_FIELD_MISSING', field, undefined, metadata);
  }
}

export class InvalidFormatError extends ValidationError {
  constructor(field: string, value: unknown, expectedFormat: string, metadata?: ErrorMetadata) {
    super(`Invalid format for field ${field}: expected ${expectedFormat}`, 'INVALID_FORMAT', field, value, {
      ...metadata,
      expectedFormat,
    });
  }
}

/**
 * Error utilities
 */
export class ErrorUtils {
  /**
   * Wrap any thrown value as an AngleError
   */
  static wrap(error: unknown, context?: Record<string, unknown>): AngleError {
    if (error instanceof AngleError) {
      return context ? error.withContext(context) : error;
    }

    if (error instanceof Error) {
      const wrapped = new AngleError(error.message, 'WRAPPED_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.MEDIUM, {
        context,
        stack: error.stack,
      });
      wrapped.cause = error;
      return wrapped;
    }

    // Handle string errors
    if (typeof error === 'string') {
      return new AngleError(error, 'UNKNOWN_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.MEDIUM, { context });
    }

    // Handle other types
    return new AngleError(String(error), 'UNKNOWN_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.MEDIUM, {
      context,
      originalValue: error,
    });
  }

  /**
   * Check if an error matches a specific type or code
   */
  static matches(error: unknown, matcher: { new (...args: any[]): AngleError } | string): boolean {
    if (typeof matcher === 'string') {
      return error instanceof AngleError && error.code === matcher;
    }
    return error instanceof matcher;
  }

  /**
   * Format an error for display
   */
  static format(error: AngleError): string {
    const parts = [`[${error.severity.toUpperCase()}] ${error.category.toUpperCase()}:${error.code}`, error.message];

    if (error.metadata.context) {
      const contextStr = Object.entries(error.metadata.context)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(', ');
      parts.push(`Context: ${contextStr}`);
    }

    return parts.join('\n');
  }

  /**
   * Convert error to log object
   */
  static toLogObject(error: AngleError): Record<string, unknown> {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      category: error.category,
      severity: error.severity,
      metadata: error.metadata,
      timestamp: error.timestamp.toISOString(),
    };
  }

  /**
   * Get error statistics
   */
  static getStatistics(errors: AngleError[]): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
  } {
    const stats = {
      total: errors.length,
      byCategory: {} as Record<ErrorCategory, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
    };

    // Initialize counters
    Object.values(ErrorCategory).forEach((cat) => {
      stats.byCategory[cat as ErrorCategory] = 0;
    });
    Object.values(ErrorSeverity).forEach((sev) => {
      stats.bySeverity[sev as ErrorSeverity] = 0;
    });

    // Count errors
    errors.forEach((error) => {
      stats.byCategory[error.category]++;
      stats.bySeverity[error.severity]++;
    });

    return stats;
  }

  /**
   * Group errors by category
   */
  static groupByCategory(errors: AngleError[]): Map<ErrorCategory, AngleError[]> {
    const grouped = new Map<ErrorCategory, AngleError[]>();

    errors.forEach((error) => {
      const group = grouped.get(error.category) || [];
      group.push(error);
      grouped.set(error.category, group);
    });

    return grouped;
  }

  /**
   * Create error from serialized format
   */
  static fromSerialized(serialized: SerializedError): AngleError {
    const error = new AngleError(
      serialized.message,
      serialized.code,
      serialized.category,
      serialized.severity,
      serialized.metadata
    );

    // Restore properties
    Object.defineProperty(error, 'name', { value: serialized.name });
    Object.defineProperty(error, 'timestamp', { value: new Date(serialized.timestamp) });

    if (serialized.cause) {
      error.cause = this.fromSerialized(serialized.cause);
    }

    return error;
  }
}

/**
 * Error context management for async operations
 */
export class ErrorContextManager {
  private static contextStack: Map<string, unknown>[] = [];

  static push(context: Record<string, unknown>): void {
    this.contextStack.push(new Map(Object.entries(context)));
  }

  static pop(): void {
    this.contextStack.pop();
  }

  static getMergedContext(): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    this.contextStack.forEach((context) => {
      context.forEach((value, key) => {
        merged[key] = value;
      });
    });
    return merged;
  }

  static clearAll(): void {
    this.contextStack = [];
  }
}

/**
 * Execute a function with error context
 */
export async function withContext<T>(context: Record<string, unknown>, fn: () => T | Promise<T>): Promise<T> {
  ErrorContextManager.push(context);
  try {
    return await fn();
  } finally {
    ErrorContextManager.pop();
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(fn: () => T | Promise<T>, maxRetries = 3, baseDelay = 100): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay
      let delay = baseDelay * Math.pow(2, attempt);

      // Use error-specific delay if available
      if (error instanceof AngleError && error.isRecoverable()) {
        delay = error.getRetryDelay();
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Global error registry for centralized error handling
 */
class ErrorRegistry {
  private handlers = new Map<string, Array<(error: AngleError) => void | Promise<void>>>();

  /**
   * Handle an error through registered handlers
   */
  async handleError(error: AngleError): Promise<void> {
    // Get specific handlers for this error type
    const specificHandlers = this.handlers.get(error.constructor.name) || [];

    // Get global handlers
    const globalHandlers = this.handlers.get('*') || [];

    // Execute all handlers
    const allHandlers = [...specificHandlers, ...globalHandlers];

    await Promise.all(
      allHandlers.map(async (handler) => {
        try {
          await handler(error);
        } catch (handlerError) {
          // Log handler errors but don't throw
          console.error('Error in error handler:', handlerError);
        }
      })
    );
  }

  /**
   * Register an error handler
   */
  register(errorType: string, handler: (error: AngleError) => void | Promise<void>): void {
    const handlers = this.handlers.get(errorType) || [];
    handlers.push(handler);
    this.handlers.set(errorType, handlers);
  }
}

export const errorRegistry = new ErrorRegistry();

/**
 * Register an error handler
 */
export function registerErrorHandler(
  errorType: string | '*',
  handler: (error: AngleError) => void | Promise<void>
): void {
  errorRegistry.register(errorType, handler);
}
