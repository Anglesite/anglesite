/**
 * @file Error Handler Integration Utilities
 * @description Helper functions for integrating ErrorHandlerUtility with services and IPC handlers
 */

import { IApplicationContext } from '../core/interfaces';
import { ErrorHandlerUtility, ErrorHandlerConvenience, ErrorContext } from './error-handler-utility';
import { ErrorReportingService } from '../services/error-reporting-service';

/**
 * Get ErrorHandlerUtility instance from service registry
 */
export function getErrorHandler(serviceRegistry: IApplicationContext): ErrorHandlerUtility | null {
  try {
    const errorReportingService = serviceRegistry.getService<ErrorReportingService>('errorReporting');
    if (!errorReportingService) {
      return null;
    }
    return new ErrorHandlerUtility(errorReportingService);
  } catch {
    return null;
  }
}

/**
 * Get ErrorHandlerConvenience instance for easy error/warn mapping
 */
export function getErrorHandlerConvenience(serviceRegistry: IApplicationContext): ErrorHandlerConvenience | null {
  const utility = getErrorHandler(serviceRegistry);
  if (!utility) {
    return null;
  }
  return new ErrorHandlerConvenience(utility);
}

/**
 * Create error reporting function for a specific service
 */
export function createServiceErrorReporter(
  serviceRegistry: IApplicationContext,
  serviceName: string
): (operation: string, error: unknown, context?: object) => Promise<void> {
  const errorHandler = getErrorHandler(serviceRegistry);

  return async (operation: string, error: unknown, context?: object) => {
    if (errorHandler && errorHandler.isAvailable()) {
      await errorHandler.reportServiceError(serviceName, operation, error, context);
    }
    // Graceful degradation - if no error handler available, fail silently
  };
}

/**
 * Create error reporting function for a specific IPC channel
 */
export function createIPCErrorReporter(
  serviceRegistry: IApplicationContext,
  channel: string
): (operation: string, error: unknown, context?: object) => Promise<void> {
  const errorHandler = getErrorHandler(serviceRegistry);

  return async (operation: string, error: unknown, context?: object) => {
    if (errorHandler && errorHandler.isAvailable()) {
      await errorHandler.reportIPCError(channel, operation, error, context);
    }
    // Graceful degradation - if no error handler available, fail silently
  };
}

/**
 * Helper class for replacing console.error/warn patterns
 */
export class ConsoleErrorReplacer {
  private errorHandler: ErrorHandlerConvenience | null;

  constructor(serviceRegistry: IApplicationContext) {
    this.errorHandler = getErrorHandlerConvenience(serviceRegistry);
  }

  /**
   * Replace console.error with proper error reporting
   */
  async error(message: string, error?: unknown, context?: ErrorContext): Promise<void> {
    if (this.errorHandler) {
      // Create error from message and additional error if provided
      const errorToReport = error || new Error(message);
      await this.errorHandler.error(errorToReport, context);
    }
    // Note: No console fallback as per requirements (no backward compatibility needed)
  }

  /**
   * Replace console.warn with proper error reporting
   */
  async warn(message: string, error?: unknown, context?: ErrorContext): Promise<void> {
    if (this.errorHandler) {
      // Create error from message and additional error if provided
      const errorToReport = error || new Error(message);
      await this.errorHandler.warn(errorToReport, context);
    }
    // Note: No console fallback as per requirements
  }

  /**
   * Check if error handler is available
   */
  isAvailable(): boolean {
    return this.errorHandler !== null;
  }
}
