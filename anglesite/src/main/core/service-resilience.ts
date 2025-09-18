/**
 * @file Service Resilience and Recovery System
 *
 * Implements circuit breaker pattern, retry mechanisms, and health monitoring
 * for robust service operation and automatic recovery from failures.
 */

import { EventEmitter } from 'events';
import { ILogger } from './interfaces';

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Failing fast, not calling service
  HALF_OPEN = 'half-open', // Testing if service has recovered
}

/**
 * Configuration for circuit breaker behavior
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening circuit
  recoveryTimeout: number; // Time to wait before trying to recover (ms)
  successThreshold: number; // Successes needed to close circuit from half-open
  timeout: number; // Request timeout (ms)
  resetTimeout: number; // Time before resetting failure count (ms)
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeout: 30000, // 30 seconds
  successThreshold: 3,
  timeout: 10000, // 10 seconds
  resetTimeout: 60000, // 1 minute
};

/**
 * Circuit breaker for service calls with automatic recovery
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastResetTime = Date.now();

  constructor(
    private serviceName: string,
    private config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
    private logger: ILogger
  ) {
    super();
  }

  /**
   * Execute a service call with circuit breaker protection and timeout handling.
   */
  async execute<T>(serviceCall: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.logger.info(`Circuit breaker for ${this.serviceName} moving to HALF_OPEN`);
        this.emit('stateChange', this.state);
      } else {
        const error = new Error(`Circuit breaker is OPEN for service: ${this.serviceName}`);
        this.logger.warn(`Circuit breaker blocking call to ${this.serviceName}`);
        throw error;
      }
    }

    try {
      const result = await this.executeWithTimeout(serviceCall);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute service call with configurable timeout protection.
   */
  private async executeWithTimeout<T>(serviceCall: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Service call timeout after ${this.config.timeout}ms for ${this.serviceName}`));
      }, this.config.timeout);

      serviceCall()
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
   * Handle successful service call and update circuit breaker state.
   */
  private onSuccess(): void {
    this.resetFailureCountIfNeeded();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitBreakerState.CLOSED;
        this.successCount = 0;
        this.logger.info(`Circuit breaker for ${this.serviceName} CLOSED after recovery`);
        this.emit('stateChange', this.state);
        this.emit('recovered');
      }
    }
  }

  /**
   * Handle failed service call and update failure counters.
   */
  private onFailure(error: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.logger.warn(`Service failure for ${this.serviceName}`, {
      error: error instanceof Error ? error.message : String(error),
      failureCount: this.failureCount,
      state: this.state,
    });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.successCount = 0;
      this.logger.error(`Circuit breaker for ${this.serviceName} OPEN after half-open failure`);
      this.emit('stateChange', this.state);
      this.emit('opened');
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.error(`Circuit breaker for ${this.serviceName} OPEN after ${this.failureCount} failures`);
      this.emit('stateChange', this.state);
      this.emit('opened');
    }
  }

  /**
   * Check if circuit breaker should attempt reset based on recovery timeout.
   */
  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.recoveryTimeout;
  }

  /**
   * Reset failure count when reset timeout period has elapsed.
   */
  private resetFailureCountIfNeeded(): void {
    if (Date.now() - this.lastResetTime >= this.config.resetTimeout) {
      this.failureCount = 0;
      this.lastResetTime = Date.now();
    }
  }

  /**
   * Get current circuit breaker state and performance metrics.
   */
  getMetrics() {
    return {
      serviceName: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      config: this.config,
    };
  }

  /**
   * Manually reset circuit breaker state and clear all counters.
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.lastResetTime = Date.now();
    this.logger.info(`Circuit breaker for ${this.serviceName} manually reset`);
    this.emit('reset');
  }
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number; // Base delay between retries (ms)
  maxDelay: number; // Maximum delay between retries (ms)
  backoffMultiplier: number; // Exponential backoff multiplier
  retryableErrors: string[]; // Error types that should trigger retry
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  retryableErrors: ['ECONNREFUSED', 'ENOTFOUND', 'TIMEOUT', 'ECONNRESET'],
};

/**
 * Retry mechanism with exponential backoff
 */
export class RetryHandler {
  constructor(
    private serviceName: string,
    private config: RetryConfig = DEFAULT_RETRY_CONFIG,
    private logger: ILogger
  ) {}

  /**
   * Execute operation with exponential backoff retry logic.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          this.logger.info(`${this.serviceName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (!this.isRetryableError(lastError) || attempt === this.config.maxAttempts) {
          break;
        }

        const delay = this.calculateDelay(attempt);
        this.logger.warn(`${this.serviceName} failed on attempt ${attempt}, retrying in ${delay}ms`, {
          error: lastError.message,
          attempt,
          maxAttempts: this.config.maxAttempts,
        });

        await this.sleep(delay);
      }
    }

    this.logger.error(`${this.serviceName} failed after ${this.config.maxAttempts} attempts`, lastError);
    throw lastError;
  }

  /**
   * Check if error type is eligible for retry based on configuration.
   */
  private isRetryableError(error: Error): boolean {
    const errorCode = (error as { code?: string }).code;
    const errorMessage = error.message.toUpperCase();

    // Check error codes
    if (errorCode && this.config.retryableErrors.includes(errorCode)) {
      return true;
    }

    // Check error messages
    return this.config.retryableErrors.some((retryableError) => errorMessage.includes(retryableError.toUpperCase()));
  }

  /**
   * Calculate retry delay using exponential backoff with maximum limit.
   */
  private calculateDelay(attempt: number): number {
    const delay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * Sleep for specified duration in milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Service health monitor
 */
export interface HealthStatus {
  isHealthy: boolean;
  lastCheck: number;
  responseTime: number;
  error?: string;
}

/**
 * Health monitoring system for services
 */
export class HealthMonitor extends EventEmitter {
  private healthStatus = new Map<string, HealthStatus>();
  private checkIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private logger: ILogger) {
    super();
  }

  /**
   * Register a service for periodic health monitoring with configurable interval.
   */
  registerService(
    serviceName: string,
    healthCheck: () => Promise<boolean>,
    checkInterval: number = 30000 // 30 seconds
  ): void {
    // Clear existing interval if any
    const existingInterval = this.checkIntervals.get(serviceName);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Set up periodic health check
    const interval = setInterval(async () => {
      await this.performHealthCheck(serviceName, healthCheck);
    }, checkInterval);

    this.checkIntervals.set(serviceName, interval);

    // Perform initial health check
    this.performHealthCheck(serviceName, healthCheck);

    this.logger.info(`Health monitoring registered for ${serviceName}`);
  }

  /**
   * Perform health check for a service and update status tracking.
   */
  private async performHealthCheck(serviceName: string, healthCheck: () => Promise<boolean>): Promise<void> {
    const startTime = Date.now();

    try {
      const isHealthy = await healthCheck();
      const responseTime = Date.now() - startTime;

      const status: HealthStatus = {
        isHealthy,
        lastCheck: Date.now(),
        responseTime,
      };

      const previousStatus = this.healthStatus.get(serviceName);
      this.healthStatus.set(serviceName, status);

      // Emit events on status change
      if (!previousStatus || previousStatus.isHealthy !== isHealthy) {
        if (isHealthy) {
          this.logger.info(`Service ${serviceName} is healthy (${responseTime}ms)`);
          this.emit('healthy', serviceName, status);
        } else {
          this.logger.warn(`Service ${serviceName} is unhealthy (${responseTime}ms)`);
          this.emit('unhealthy', serviceName, status);
        }
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const status: HealthStatus = {
        isHealthy: false,
        lastCheck: Date.now(),
        responseTime,
        error: error instanceof Error ? error.message : String(error),
      };

      this.healthStatus.set(serviceName, status);
      this.logger.error(`Health check failed for ${serviceName}`, undefined, {
        errorMessage: status.error,
        responseTime,
      });
      this.emit('unhealthy', serviceName, status);
    }
  }

  /**
   * Get current health status for a specific service.
   */
  getHealthStatus(serviceName: string): HealthStatus | undefined {
    return this.healthStatus.get(serviceName);
  }

  /**
   * Get health status map for all currently monitored services.
   */
  getAllHealthStatus(): Map<string, HealthStatus> {
    return new Map(this.healthStatus);
  }

  /**
   * Stop health monitoring for a specific service and cleanup resources.
   */
  unregisterService(serviceName: string): void {
    const interval = this.checkIntervals.get(serviceName);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(serviceName);
    }
    this.healthStatus.delete(serviceName);
    this.logger.info(`Health monitoring stopped for ${serviceName}`);
  }

  /**
   * Stop all health monitoring and cleanup all intervals.
   */
  dispose(): void {
    for (const [serviceName, interval] of this.checkIntervals) {
      clearInterval(interval);
      this.logger.info(`Health monitoring stopped for ${serviceName}`);
    }
    this.checkIntervals.clear();
    this.healthStatus.clear();
  }
}

/**
 * Resilient service wrapper that combines circuit breaker, retry, and health monitoring
 */
export class ResilientServiceWrapper<T> {
  private circuitBreaker: CircuitBreaker;
  private retryHandler: RetryHandler;

  constructor(
    private serviceName: string,
    private service: T,
    private logger: ILogger,
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>,
    retryConfig?: Partial<RetryConfig>
  ) {
    this.circuitBreaker = new CircuitBreaker(
      serviceName,
      { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...circuitBreakerConfig },
      logger
    );

    this.retryHandler = new RetryHandler(serviceName, { ...DEFAULT_RETRY_CONFIG, ...retryConfig }, logger);

    // Set up circuit breaker event handlers
    this.circuitBreaker.on('opened', () => {
      logger.error(`Circuit breaker OPENED for ${serviceName} - service calls will be blocked`);
    });

    this.circuitBreaker.on('recovered', () => {
      logger.info(`Service ${serviceName} recovered - circuit breaker CLOSED`);
    });
  }

  /**
   * Execute a service method with circuit breaker and retry protection.
   */
  async execute<R>(serviceMethod: (service: T) => Promise<R>): Promise<R> {
    return this.circuitBreaker.execute(async () => {
      return this.retryHandler.execute(async () => {
        return serviceMethod(this.service);
      });
    });
  }

  /**
   * Execute a service method with circuit breaker only (no retry for non-idempotent operations).
   */
  async executeOnce<R>(serviceMethod: (service: T) => Promise<R>): Promise<R> {
    return this.circuitBreaker.execute(async () => {
      return serviceMethod(this.service);
    });
  }

  /**
   * Get direct access to the underlying service (bypasses resilience protection).
   */
  getService(): T {
    return this.service;
  }

  /**
   * Get detailed circuit breaker metrics and state information.
   */
  getMetrics() {
    return this.circuitBreaker.getMetrics();
  }

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset(): void {
    this.circuitBreaker.reset();
  }
}
