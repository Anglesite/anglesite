/**
 * @file Error Handler Utility
 * @description Centralized error reporting utility for consistent error handling across all modules
 */

import { ErrorReportingService } from '../services/error-reporting-service';
import { ErrorSeverity, ErrorCategory, AngleError } from '../core/errors';

export interface ErrorContext {
  operation?: string;
  serviceName?: string;
  channel?: string;
  component?: string;
  correlationId?: string;
  category?: ErrorCategory;
  timestamp?: number;
  [key: string]: unknown;
}

export class ErrorHandlerUtility {
  private errorReportingService: ErrorReportingService;

  constructor(errorReportingService: ErrorReportingService) {
    this.errorReportingService = errorReportingService;
  }

  /**
   * Report an error with optional context and severity
   */
  async reportError(
    error: unknown,
    context: ErrorContext = {},
    severity: ErrorSeverity = ErrorSeverity.HIGH
  ): Promise<void> {
    try {
      // Check if service is available
      if (!this.isAvailable()) {
        // Graceful degradation - service not available
        return;
      }

      // Standardize context with timestamp
      const standardizedContext = this.standardizeContext(context);

      // Create AngleError with proper category if one is specified in context
      let angleError: unknown = error;
      if (!(error instanceof AngleError) && standardizedContext.category) {
        // Create AngleError with specified category
        const message = error instanceof Error ? error.message : String(error);
        const code = this.getErrorCode(error);

        angleError = new AngleError(message, code, standardizedContext.category, severity, {
          context: standardizedContext,
          stack: error instanceof Error ? error.stack : undefined,
        });

        if (error instanceof Error) {
          (angleError as AngleError).cause = error;
        }
      }

      // Report through ErrorReportingService
      await this.errorReportingService.report(angleError, standardizedContext);
    } catch (reportError) {
      // Graceful degradation - don't throw if error reporting fails
      // This prevents cascading failures
    }
  }

  /**
   * Report service-specific errors
   */
  async reportServiceError(
    serviceName: string,
    operation: string,
    error: unknown,
    context: object = {}
  ): Promise<void> {
    const serviceContext: ErrorContext = {
      ...context,
      serviceName,
      operation,
      category: ErrorCategory.SERVICE_MANAGEMENT,
      correlationId: this.generateCorrelationId('service'),
    };

    await this.reportError(error, serviceContext, ErrorSeverity.HIGH);
  }

  /**
   * Report IPC handler errors
   */
  async reportIPCError(channel: string, operation: string, error: unknown, context: object = {}): Promise<void> {
    const ipcContext: ErrorContext = {
      ...context,
      channel,
      operation,
      category: ErrorCategory.IPC_COMMUNICATION,
      correlationId: this.generateCorrelationId('ipc'),
    };

    await this.reportError(error, ipcContext, ErrorSeverity.HIGH);
  }

  /**
   * Report renderer/UI component errors
   */
  async reportRendererError(component: string, error: unknown, errorInfo?: object): Promise<void> {
    const rendererContext: ErrorContext = {
      component,
      errorInfo,
      category: ErrorCategory.UI_COMPONENT,
      correlationId: this.generateCorrelationId('ui'),
    };

    await this.reportError(error, rendererContext, ErrorSeverity.HIGH);
  }

  /**
   * Check if ErrorReportingService is available
   */
  isAvailable(): boolean {
    try {
      return this.errorReportingService && this.errorReportingService.isEnabled();
    } catch {
      return false;
    }
  }

  /**
   * Standardize error context with common fields
   */
  private standardizeContext(context: ErrorContext): ErrorContext {
    return {
      ...context,
      timestamp: Date.now(),
      // Preserve existing correlationId if provided, otherwise generate if needed
      correlationId: context.correlationId || (context.operation ? this.generateCorrelationId('general') : undefined),
    };
  }

  /**
   * Generate correlation ID for error tracking
   */
  private generateCorrelationId(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}-${random}-${timestamp}`;
  }

  /**
   * Get error code based on error type and context
   */
  private getErrorCode(error: unknown): string {
    if (error instanceof Error && 'code' in error && typeof (error as any).code === 'string') {
      return (error as any).code;
    }

    if (error instanceof Error) {
      return 'ERROR_HANDLER_WRAPPED';
    }

    return 'UNKNOWN_ERROR';
  }
}

/**
 * Factory function to create ErrorHandlerUtility instance
 * This will be used by other modules to get a properly configured utility
 */
export function createErrorHandlerUtility(errorReportingService: ErrorReportingService): ErrorHandlerUtility {
  return new ErrorHandlerUtility(errorReportingService);
}

/**
 * Convenience functions for different error severity levels
 * These map the old console.error/console.warn patterns to the new system
 */
export class ErrorHandlerConvenience {
  private utility: ErrorHandlerUtility;

  constructor(utility: ErrorHandlerUtility) {
    this.utility = utility;
  }

  /**
   * Report high severity error (replaces console.error)
   */
  async error(error: unknown, context?: ErrorContext): Promise<void> {
    await this.utility.reportError(error, context, ErrorSeverity.HIGH);
  }

  /**
   * Report medium severity warning (replaces console.warn)
   */
  async warn(error: unknown, context?: ErrorContext): Promise<void> {
    await this.utility.reportError(error, context, ErrorSeverity.MEDIUM);
  }

  /**
   * Report service error
   */
  async serviceError(serviceName: string, operation: string, error: unknown, context?: object): Promise<void> {
    await this.utility.reportServiceError(serviceName, operation, error, context);
  }

  /**
   * Report IPC error
   */
  async ipcError(channel: string, operation: string, error: unknown, context?: object): Promise<void> {
    await this.utility.reportIPCError(channel, operation, error, context);
  }

  /**
   * Report renderer error
   */
  async rendererError(component: string, error: unknown, errorInfo?: object): Promise<void> {
    await this.utility.reportRendererError(component, error, errorInfo);
  }
}
