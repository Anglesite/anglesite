/**
 * @file Renderer-side error type definitions.
 *
 * These types are duplicated from main/core/errors/base.ts to avoid
 * cross-process imports that cause lazy-loading failures in webpack bundles.
 *
 * IMPORTANT: Keep these in sync with main/core/errors/base.ts
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
 * Base error interface for renderer-side error handling.
 * This is a subset of the main process AngleError class.
 */
export interface RendererError {
  message: string;
  code?: string;
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  metadata?: {
    timestamp?: Date;
    operation?: string;
    resource?: string;
    context?: Record<string, unknown>;
  };
}
