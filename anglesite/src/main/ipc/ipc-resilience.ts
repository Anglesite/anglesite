/**
 * @file IPC Resilience and Error Handling Framework
 *
 * Provides comprehensive error handling, validation, timeout protection,
 * and monitoring for all IPC communications between main and renderer processes.
 */

import { ipcMain, WebContents, IpcMainEvent } from 'electron';
import { ILogger } from '../core/interfaces';

/**
 * IPC handler configuration
 */
export interface IPCHandlerConfig {
  timeout: number; // Request timeout in milliseconds
  validate: boolean; // Enable input validation
  sanitize: boolean; // Enable input sanitization
  retries: number; // Number of retries on failure
  rateLimitMs: number; // Rate limiting window
  maxRequestsPerWindow: number; // Max requests per rate limit window
}

/**
 * Default IPC handler configuration
 */
export const DEFAULT_IPC_CONFIG: IPCHandlerConfig = {
  timeout: 30000, // 30 seconds
  validate: true,
  sanitize: true,
  retries: 2,
  rateLimitMs: 1000, // 1 second
  maxRequestsPerWindow: 10,
};

/**
 * Validation schema for IPC inputs
 */
export interface ValidationSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  enum?: string[];
  properties?: Record<string, ValidationSchema>;
  items?: ValidationSchema;
}

/**
 * IPC request context for tracking and logging
 */
export interface IPCRequestContext {
  channel: string;
  requestId: string;
  startTime: number;
  sender: WebContents;
  args: unknown[];
}

/**
 * Rate limiting tracker
 */
interface RateLimitTracker {
  requests: number[];
  windowStart: number;
}

/**
 * Comprehensive IPC error handling and resilience system
 */
export class IPCResilienceManager {
  private logger: ILogger;
  private rateLimitTrackers = new Map<string, RateLimitTracker>();
  private activeRequests = new Map<string, IPCRequestContext>();
  private requestCounter = 0;

  constructor(logger: ILogger) {
    this.logger = logger.child({ component: 'IPCResilience' });
  }

  /**
   * Create a resilient IPC handler with timeout protection and validation.
   */
  createResilientHandler<T extends unknown[], R>(
    channel: string,
    handler: (...args: T) => Promise<R> | R,
    config: Partial<IPCHandlerConfig> = {},
    validationSchema?: ValidationSchema[]
  ): void {
    const finalConfig = { ...DEFAULT_IPC_CONFIG, ...config };

    ipcMain.handle(channel, async (event, ...args: T): Promise<R> => {
      const requestId = this.generateRequestId();
      const context: IPCRequestContext = {
        channel,
        requestId,
        startTime: Date.now(),
        sender: event.sender,
        args,
      };

      this.activeRequests.set(requestId, context);

      try {
        // Rate limiting check
        if (!this.checkRateLimit(channel, finalConfig)) {
          throw new Error(`Rate limit exceeded for channel: ${channel}`);
        }

        // Input validation
        if (finalConfig.validate && validationSchema) {
          this.validateInputs(args, validationSchema);
        }

        // Input sanitization
        if (finalConfig.sanitize) {
          args = this.sanitizeInputs(args) as T;
        }

        // Execute with timeout protection
        const result = await this.executeWithTimeout(() => handler(...args), finalConfig.timeout, channel);

        // Log successful request
        this.logRequest(context, 'success', Date.now() - context.startTime);

        return result;
      } catch (error) {
        const duration = Date.now() - context.startTime;
        this.logRequest(context, 'error', duration, error);

        // Convert error to safe format for IPC
        const safeError = this.createSafeError(error);
        throw safeError;
      } finally {
        this.activeRequests.delete(requestId);
      }
    });

    this.logger.info(`Resilient IPC handler registered for channel: ${channel}`, {
      config: finalConfig,
    });
  }

  /**
   * Create a resilient one-way IPC handler with error handling and rate limiting.
   */
  createResilientListener<T extends unknown[]>(
    channel: string,
    handler: (event: IpcMainEvent, ...args: T) => Promise<void> | void,
    config: Partial<IPCHandlerConfig> = {},
    validationSchema?: ValidationSchema[]
  ): void {
    const finalConfig = { ...DEFAULT_IPC_CONFIG, ...config };

    ipcMain.on(channel, async (event, ...args: T): Promise<void> => {
      const requestId = this.generateRequestId();
      const context: IPCRequestContext = {
        channel,
        requestId,
        startTime: Date.now(),
        sender: event.sender,
        args,
      };

      this.activeRequests.set(requestId, context);

      try {
        // Rate limiting check
        if (!this.checkRateLimit(channel, finalConfig)) {
          this.logger.warn(`Rate limit exceeded for channel: ${channel}`);
          return;
        }

        // Input validation
        if (finalConfig.validate && validationSchema) {
          this.validateInputs(args, validationSchema);
        }

        // Input sanitization
        if (finalConfig.sanitize) {
          args = this.sanitizeInputs(args) as T;
        }

        // Execute with timeout protection
        await this.executeWithTimeout(() => handler(event, ...args), finalConfig.timeout, channel);

        // Log successful request
        this.logRequest(context, 'success', Date.now() - context.startTime);
      } catch (error) {
        const duration = Date.now() - context.startTime;
        this.logRequest(context, 'error', duration, error);

        // For one-way handlers, we can't return errors, so just log them
        this.logger.error(`Error in IPC listener for channel: ${channel}`, error instanceof Error ? error : undefined, {
          requestId,
          duration,
        });
      } finally {
        this.activeRequests.delete(requestId);
      }
    });

    this.logger.info(`Resilient IPC listener registered for channel: ${channel}`, {
      config: finalConfig,
    });
  }

  /**
   * Execute handler with configurable timeout protection and error handling.
   */
  private async executeWithTimeout<R>(handler: () => Promise<R> | R, timeout: number, channel: string): Promise<R> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`IPC handler timeout after ${timeout}ms for channel: ${channel}`));
      }, timeout);

      Promise.resolve(handler())
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Check and enforce rate limiting for a specific IPC channel.
   */
  private checkRateLimit(channel: string, config: IPCHandlerConfig): boolean {
    const now = Date.now();
    let tracker = this.rateLimitTrackers.get(channel);

    if (!tracker) {
      tracker = {
        requests: [],
        windowStart: now,
      };
      this.rateLimitTrackers.set(channel, tracker);
    }

    // Reset window if needed
    if (now - tracker.windowStart >= config.rateLimitMs) {
      tracker.requests = [];
      tracker.windowStart = now;
    }

    // Check if under limit
    if (tracker.requests.length >= config.maxRequestsPerWindow) {
      return false;
    }

    // Add current request
    tracker.requests.push(now);
    return true;
  }

  /**
   * Validate IPC inputs against provided schema definitions.
   */
  private validateInputs(args: unknown[], schemas: ValidationSchema[]): void {
    for (let i = 0; i < schemas.length; i++) {
      const arg = args[i];
      const schema = schemas[i];

      if (schema.required && (arg === undefined || arg === null)) {
        throw new Error(`Required argument at position ${i} is missing`);
      }

      if (arg !== undefined && arg !== null) {
        this.validateValue(arg, schema, `argument[${i}]`);
      }
    }
  }

  /**
   * Validate a single value against schema definition with detailed error reporting.
   */
  private validateValue(value: unknown, schema: ValidationSchema, path: string): void {
    // Type validation
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== schema.type) {
      throw new Error(`${path}: expected ${schema.type}, got ${actualType}`);
    }

    // String validations
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new Error(`${path}: minimum length is ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new Error(`${path}: maximum length is ${schema.maxLength}`);
      }
      if (schema.pattern && !schema.pattern.test(value)) {
        throw new Error(`${path}: does not match required pattern`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        throw new Error(`${path}: must be one of ${schema.enum.join(', ')}`);
      }
    }

    // Object validations
    if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        this.validateValue(obj[key], propSchema, `${path}.${key}`);
      }
    }

    // Array validations
    if (schema.type === 'array' && Array.isArray(value) && schema.items) {
      value.forEach((item, index) => {
        this.validateValue(item, schema.items!, `${path}[${index}]`);
      });
    }
  }

  /**
   * Sanitize IPC inputs to prevent script injection and XSS attacks.
   */
  private sanitizeInputs(args: unknown[]): unknown[] {
    return args.map((arg) => this.sanitizeValue(arg));
  }

  /**
   * Sanitize a single value recursively for strings, arrays, and objects.
   */
  private sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string') {
      // Remove potentially dangerous characters
      return value
        .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/data:/gi, '') // Remove data: protocol
        .replace(/vbscript:/gi, '') // Remove vbscript: protocol
        .trim();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    if (typeof value === 'object' && value !== null) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = this.sanitizeValue(val);
      }
      return sanitized;
    }

    return value;
  }

  /**
   * Create a safe error object for secure IPC transmission.
   */
  private createSafeError(error: unknown): Error {
    if (error instanceof Error) {
      // Create a new error with safe properties only
      const safeError = new Error(error.message);
      safeError.name = error.name;
      // Don't include stack traces in production for security
      if (process.env.NODE_ENV !== 'production') {
        safeError.stack = error.stack;
      }
      return safeError;
    }

    return new Error(String(error));
  }

  /**
   * Generate unique request ID for tracking and logging.
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestCounter}`;
  }

  /**
   * Log IPC request completion with performance metrics and error details.
   */
  private logRequest(context: IPCRequestContext, status: 'success' | 'error', duration: number, error?: unknown): void {
    const logData = {
      channel: context.channel,
      requestId: context.requestId,
      duration,
      status,
      argsCount: context.args.length,
    };

    if (status === 'success') {
      this.logger.info(`IPC request completed`, logData);
    } else {
      this.logger.error(`IPC request failed`, error instanceof Error ? error : undefined, {
        ...logData,
      });
    }
  }

  /**
   * Get comprehensive metrics for active requests and rate limiting status.
   */
  getMetrics(): {
    activeRequests: number;
    totalChannels: number;
    rateLimitedChannels: string[];
    longRunningRequests: IPCRequestContext[];
  } {
    const now = Date.now();
    const longRunningThreshold = 5000; // 5 seconds

    const longRunningRequests = Array.from(this.activeRequests.values()).filter(
      (context) => now - context.startTime > longRunningThreshold
    );

    const rateLimitedChannels = Array.from(this.rateLimitTrackers.entries())
      .filter(([, tracker]) => tracker.requests.length >= DEFAULT_IPC_CONFIG.maxRequestsPerWindow)
      .map(([channel]) => channel);

    return {
      activeRequests: this.activeRequests.size,
      totalChannels: this.rateLimitTrackers.size,
      rateLimitedChannels,
      longRunningRequests,
    };
  }

  /**
   * Cancel all active requests during application shutdown.
   */
  cancelAllRequests(): void {
    const activeCount = this.activeRequests.size;
    if (activeCount > 0) {
      this.logger.warn(`Cancelling ${activeCount} active IPC requests during shutdown`);
      this.activeRequests.clear();
    }
  }

  /**
   * Clean up rate limiting trackers and active request maps.
   */
  cleanup(): void {
    this.rateLimitTrackers.clear();
    this.activeRequests.clear();
    this.logger.info('IPC resilience manager cleaned up');
  }
}

/**
 * Common validation schemas for IPC input validation and reuse
 */
export const CommonValidationSchemas = {
  websiteName: {
    type: 'string' as const,
    required: true,
    minLength: 1,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9\-_]+$/,
  },

  websitePath: {
    type: 'string' as const,
    required: true,
    minLength: 1,
    maxLength: 500,
  },

  boolean: {
    type: 'boolean' as const,
    required: true,
  },

  positiveNumber: {
    type: 'number' as const,
    required: true,
  },

  websiteConfig: {
    type: 'object' as const,
    required: true,
    properties: {
      title: { type: 'string' as const, required: true, minLength: 1, maxLength: 200 },
      url: { type: 'string' as const, required: true, minLength: 1, maxLength: 500 },
      language: { type: 'string' as const, required: true, minLength: 2, maxLength: 10 },
    },
  },
};

/**
 * Helper function to create resilient IPC handlers with standard configuration patterns.
 */
export function createStandardIPCHandler<T extends unknown[], R>(
  ipcManager: IPCResilienceManager,
  channel: string,
  handler: (...args: T) => Promise<R> | R,
  validationSchema?: ValidationSchema[],
  config?: Partial<IPCHandlerConfig>
): void {
  ipcManager.createResilientHandler(
    channel,
    handler,
    {
      timeout: 10000, // 10 seconds for most operations
      validate: true,
      sanitize: true,
      ...config,
    },
    validationSchema
  );
}

/**
 * Helper function for file operation IPC handlers with extended timeout configuration.
 */
export function createFileOperationIPCHandler<T extends unknown[], R>(
  ipcManager: IPCResilienceManager,
  channel: string,
  handler: (...args: T) => Promise<R> | R,
  validationSchema?: ValidationSchema[],
  config?: Partial<IPCHandlerConfig>
): void {
  ipcManager.createResilientHandler(
    channel,
    handler,
    {
      timeout: 60000, // 60 seconds for file operations
      validate: true,
      sanitize: true,
      retries: 1, // Fewer retries for file ops
      ...config,
    },
    validationSchema
  );
}
