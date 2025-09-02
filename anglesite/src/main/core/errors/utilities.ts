/**
 * @file Error handling utilities.
 *
 * Provides utilities for error serialization, logging, reporting, and handling.
 * with support for error recovery strategies and context enrichment.
 */

import { AngleError, ErrorSeverity, ErrorCategory, SerializedError } from './base';

/**
 * Error handler function type.
 */
export type ErrorHandler = (error: AngleError) => void | Promise<void>;

/**
 * Error recovery strategy function type.
 */
export type RecoveryStrategy<T = unknown> = (error: AngleError) => T | Promise<T>;

/**
 * Error reporting configuration.
 */
export interface ErrorReportingConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  includeStackTrace: boolean;
  includeBreadcrumbs: boolean;
  environment: string;
  version: string;
  maxRetries: number;
  retryDelay: number;
}

/**
 * Error context for enriching errors with additional information.
 */
export interface ErrorContext {
  operation?: string;
  resource?: string;
  user?: {
    id?: string;
    email?: string;
  };
  request?: {
    id?: string;
    url?: string;
    method?: string;
  };
  website?: {
    id?: string;
    domain?: string;
    path?: string;
  };
  [key: string]: unknown;
}

/**
 * Error breadcrumb for tracking error context.
 */
export interface ErrorBreadcrumb {
  timestamp: Date;
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  category: string;
  data?: Record<string, unknown>;
}

/**
 * Global error registry for tracking and managing errors.
 */
class ErrorRegistry {
  private handlers = new Map<string, ErrorHandler[]>();
  private breadcrumbs: ErrorBreadcrumb[] = [];
  private context: ErrorContext = {};
  private config: ErrorReportingConfig = {
    enabled: true,
    includeStackTrace: true,
    includeBreadcrumbs: true,
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    maxRetries: 3,
    retryDelay: 1000,
  };

  /**
   * Register an error handler for a specific error type.
   */
  registerHandler(errorType: string, handler: ErrorHandler): void {
    if (!this.handlers.has(errorType)) {
      this.handlers.set(errorType, []);
    }
    this.handlers.get(errorType)!.push(handler);
  }

  /**
   * Unregister a previously registered error handler for the specified type.
   */
  unregisterHandler(errorType: string, handler: ErrorHandler): void {
    const handlers = this.handlers.get(errorType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Handle an error by calling registered handlers.
   */
  async handleError(error: AngleError): Promise<void> {
    // Add error to breadcrumbs
    this.addBreadcrumb({
      timestamp: new Date(),
      level: 'error',
      message: error.message,
      category: error.category,
      data: { code: error.code, severity: error.severity },
    });

    // Call specific handlers for this error type
    const handlers = this.handlers.get(error.constructor.name) || [];
    const globalHandlers = this.handlers.get('*') || [];
    const allHandlers = [...handlers, ...globalHandlers];

    for (const handler of allHandlers) {
      try {
        await Promise.resolve(handler(error));
      } catch (handlerError) {
        console.error('Error handler failed:', handlerError);
      }
    }

    // Report error if enabled
    if (this.config.enabled) {
      await this.reportError(error);
    }
  }

  /**
   * Add a breadcrumb for context tracking.
   */
  addBreadcrumb(breadcrumb: ErrorBreadcrumb): void {
    this.breadcrumbs.push(breadcrumb);
    // Keep only last 50 breadcrumbs
    if (this.breadcrumbs.length > 50) {
      this.breadcrumbs.shift();
    }
  }

  /**
   * Set global error context.
   */
  setContext(context: Partial<ErrorContext>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Get current error context.
   */
  getContext(): ErrorContext {
    return { ...this.context };
  }

  /**
   * Clear all accumulated error context data from the registry.
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Get recent breadcrumbs.
   */
  getBreadcrumbs(): ErrorBreadcrumb[] {
    return [...this.breadcrumbs];
  }

  /**
   * Configure error reporting.
   */
  configure(config: Partial<ErrorReportingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Report error to external service.
   */
  private async reportError(error: AngleError): Promise<void> {
    if (!this.config.endpoint) {
      return;
    }

    const payload = {
      error: error.serialize(),
      context: this.context,
      breadcrumbs: this.config.includeBreadcrumbs ? this.breadcrumbs : [],
      environment: this.config.environment,
      version: this.config.version,
      timestamp: new Date().toISOString(),
    };

    let attempt = 0;
    while (attempt < this.config.maxRetries) {
      try {
        // Note: In a real implementation, you'd use fetch or axios here
        console.log('[Error Reporting]', JSON.stringify(payload, null, 2));
        break;
      } catch (reportError) {
        attempt++;
        if (attempt >= this.config.maxRetries) {
          console.error('Failed to report error after max retries:', reportError);
        } else {
          await new Promise((resolve) => setTimeout(resolve, this.config.retryDelay));
        }
      }
    }
  }
}

// Global error registry instance
const errorRegistry = new ErrorRegistry();

/**
 * Error utilities class with static methods.
 */
export class ErrorUtils {
  /**
   * Wrap an error in an AngleError if it's not already one.
   */
  static wrap(error: unknown, context?: Partial<ErrorContext>): AngleError {
    if (error instanceof AngleError) {
      return context ? error.withContext(context) : error;
    }

    if (error instanceof Error) {
      const errorInstance = error as Error;
      return new (class WrappedError extends AngleError {
        constructor() {
          super(
            errorInstance.message,
            'WRAPPED_ERROR',
            ErrorCategory.SYSTEM,
            ErrorSeverity.MEDIUM,
            {
              context,
              stack: errorInstance.stack,
            },
            errorInstance
          );
        }
      })();
    }

    // Handle non-Error objects
    const message = typeof error === 'string' ? error : String(error);
    return new (class UnknownError extends AngleError {
      constructor() {
        super(message, 'UNKNOWN_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.MEDIUM, { context });
      }
    })();
  }

  /**
   * Check if an error matches a specific type or code.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static matches(error: unknown, matcher: string | (new (...args: any[]) => Error)): boolean {
    if (!error) return false;

    if (typeof matcher === 'string') {
      return error instanceof AngleError && error.code === matcher;
    }

    return error instanceof matcher;
  }

  /**
   * Find errors in an error chain that match a specific type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static findInChain<T extends AngleError>(error: AngleError, errorType: new (...args: any[]) => T): T | null {
    let current: Error = error;
    while (current) {
      if (current instanceof errorType) {
        return current;
      }
      current = (current as Error & { cause?: Error }).cause as Error;
      if (!current) break;
    }
    return null;
  }

  /**
   * Execute a function with error handling and recovery.
   */
  static async withRecovery<T>(
    operation: () => T | Promise<T>,
    recovery: RecoveryStrategy<T>,
    context?: ErrorContext
  ): Promise<T> {
    try {
      return await Promise.resolve(operation());
    } catch (error) {
      const angleError = this.wrap(error, context);
      await errorRegistry.handleError(angleError);
      return await Promise.resolve(recovery(angleError));
    }
  }

  /**
   * Execute a function with retries.
   */
  static async withRetry<T>(
    operation: () => T | Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000,
    context?: ErrorContext
  ): Promise<T> {
    let lastError: AngleError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await Promise.resolve(operation());
      } catch (error) {
        lastError = ErrorUtils.wrap(error, context);

        if (attempt === maxRetries) {
          await errorRegistry.handleError(lastError);
          throw lastError;
        }

        // Use error-specific retry delay if available
        const retryDelay = lastError.getRetryDelay() || delay;
        if (retryDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError!;
  }

  /**
   * Format error for display.
   */
  static format(error: AngleError, includeStack: boolean = false): string {
    const parts = [`[${error.severity}] ${error.category}:${error.code}`, error.message];

    if (error.metadata.context) {
      const contextStr = Object.entries(error.metadata.context)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(', ');
      if (contextStr) {
        parts.push(`Context: {${contextStr}}`);
      }
    }

    if (includeStack && error.stack) {
      parts.push(`Stack: ${error.stack}`);
    }

    return parts.join('\n');
  }

  /**
   * Convert error to log-friendly object.
   */
  static toLogObject(error: AngleError): Record<string, unknown> {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      category: error.category,
      severity: error.severity,
      timestamp: error.timestamp,
      stack: error.stack,
      metadata: error.metadata,
      cause: error.cause ? this.toLogObject(ErrorUtils.wrap(error.cause)) : undefined,
    };
  }

  /**
   * Deserialize error from JSON.
   */
  static fromSerialized(serialized: SerializedError): AngleError {
    const error = new (class DeserializedError extends AngleError {
      constructor() {
        super(
          serialized.message,
          serialized.code,
          serialized.category,
          serialized.severity,
          serialized.metadata,
          serialized.cause ? ErrorUtils.fromSerialized(serialized.cause) : undefined
        );
        this.name = serialized.name;
        this.stack = serialized.stack;
      }
    })();

    return error;
  }

  /**
   * Group errors by category.
   */
  static groupByCategory(errors: AngleError[]): Map<ErrorCategory, AngleError[]> {
    const grouped = new Map<ErrorCategory, AngleError[]>();

    for (const error of errors) {
      if (!grouped.has(error.category)) {
        grouped.set(error.category, []);
      }
      grouped.get(error.category)!.push(error);
    }

    return grouped;
  }

  /**
   * Generate comprehensive statistics for an array of errors including counts by category and severity.
   */
  static getStatistics(errors: AngleError[]): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
    recoverable: number;
    nonRecoverable: number;
  } {
    const stats = {
      total: errors.length,
      byCategory: {} as Record<ErrorCategory, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
      recoverable: 0,
      nonRecoverable: 0,
    };

    for (const error of errors) {
      stats.byCategory[error.category] = (stats.byCategory[error.category] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;

      if (error.isRecoverable()) {
        stats.recoverable++;
      } else {
        stats.nonRecoverable++;
      }
    }

    return stats;
  }
}

/**
 * Error context manager for scoped error handling.
 */
export class ErrorContextManager {
  private static contextStack: ErrorContext[] = [];

  /**
   * Push a new error context onto the stack.
   */
  static pushContext(context: ErrorContext): void {
    this.contextStack.push(context);
    errorRegistry.setContext(this.getMergedContext());
  }

  /**
   * Pop the top error context from the stack.
   */
  static popContext(): ErrorContext | undefined {
    const context = this.contextStack.pop();
    errorRegistry.setContext(this.getMergedContext());
    return context;
  }

  /**
   * Get the current merged context from the stack.
   */
  static getMergedContext(): ErrorContext {
    return this.contextStack.reduce((merged, context) => ({ ...merged, ...context }), {});
  }

  /**
   * Execute a function with a specific error context.
   */
  static async withContext<T>(context: ErrorContext, operation: () => T | Promise<T>): Promise<T> {
    ErrorContextManager.pushContext(context);
    try {
      return await Promise.resolve(operation());
    } finally {
      ErrorContextManager.popContext();
    }
  }

  /**
   * Clear all contexts.
   */
  static clearAll(): void {
    this.contextStack.length = 0;
    errorRegistry.clearContext();
  }
}

// Export the global error registry for external access
export { errorRegistry };

/**
 * Decorator for automatic error handling.
 */
export function HandleErrors<T = unknown>(recovery?: RecoveryStrategy<T>) {
  return function (target: unknown, propertyName: string, descriptor: PropertyDescriptor): unknown {
    const method = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      try {
        return await method.apply(this, args);
      } catch (error) {
        const angleError = ErrorUtils.wrap(error, {
          operation: `${(target as { constructor: { name: string } }).constructor.name}.${propertyName}`,
        });

        await errorRegistry.handleError(angleError);

        if (recovery) {
          return await Promise.resolve(recovery(angleError));
        }

        throw angleError;
      }
    };

    return descriptor;
  };
}

/**
 * Pre-configured error handlers for common logging and reporting scenarios.
 */
export const DefaultErrorHandlers = {
  /**
   * Console logger handler.
   */
  consoleLogger: (error: AngleError) => {
    const level =
      error.severity === ErrorSeverity.CRITICAL
        ? 'error'
        : error.severity === ErrorSeverity.HIGH
          ? 'error'
          : error.severity === ErrorSeverity.MEDIUM
            ? 'warn'
            : 'info';

    console[level](`[${error.category}:${error.code}] ${error.message}`, {
      severity: error.severity,
      metadata: error.metadata,
      stack: error.stack,
    });
  },

  /**
   * File logger handler (simplified - would use actual file writing in production).
   */
  fileLogger: (error: AngleError) => {
    const logEntry = {
      timestamp: error.timestamp.toISOString(),
      level: error.severity,
      category: error.category,
      code: error.code,
      message: error.message,
      metadata: error.metadata,
      stack: error.stack,
    };

    // In a real implementation, this would write to a file
    console.log('[FILE LOG]', JSON.stringify(logEntry));
  },
};

// Register default handlers
errorRegistry.registerHandler('*', DefaultErrorHandlers.consoleLogger);
