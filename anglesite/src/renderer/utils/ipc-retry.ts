import { logger } from './logger';
import { RetryConfig, DEFAULT_RETRY_CONFIG, getRetryConfigForChannel, isRetryBlacklisted } from './ipc-retry-config';

/**
 * Extended retry configuration with callback hooks
 */
export interface InvokeWithRetryOptions extends Partial<RetryConfig> {
  signal?: AbortSignal; // For cancellation
  onRetry?: (attempt: number, delay: number, error: Error) => void;
  onSuccess?: (attempt: number, duration: number) => void;
  onFailure?: (error: Error, attempts: number, duration: number) => void;
}

/**
 * Retry context for tracking attempts
 */
interface RetryContext {
  channel: string;
  args: unknown[];
  startTime: number;
  attempt: number;
  lastError?: Error;
}

/**
 * Classify if an error is retryable based on error message patterns
 */
export function isErrorRetryable(error: Error, config: RetryConfig): boolean {
  if (!error || !error.message) {
    return false;
  }

  const message = error.message.toLowerCase();

  // Check against retryable error patterns
  return config.retryableErrors.some((pattern) => message.includes(pattern.toLowerCase()));
}

/**
 * Calculate exponential backoff delay for a given attempt
 */
export function calculateBackoff(attempt: number, config: RetryConfig): number {
  if (attempt <= 1) {
    return 0; // No delay for first attempt
  }

  // Exponential: baseDelay * 2^(attempt - 2)
  // attempt 2: baseDelay * 2^0 = baseDelay
  // attempt 3: baseDelay * 2^1 = baseDelay * 2
  // attempt 4: baseDelay * 2^2 = baseDelay * 4
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt - 2);

  // Cap at maxDelay
  return Math.min(exponentialDelay, config.maxDelay);
}

/**
 * Wait for a specified delay, respecting abort signal
 */
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Retry aborted'));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    const abortHandler = () => {
      clearTimeout(timeout);
      reject(new Error('Retry aborted'));
    };

    signal?.addEventListener('abort', abortHandler, { once: true });
  });
}

/**
 * Invoke IPC with automatic retry logic
 *
 * @param channel - IPC channel name
 * @param args - Arguments to pass to IPC handler
 * @param options - Retry configuration and callbacks
 * @returns Promise resolving to IPC response
 *
 * @example
 * ```typescript
 * const schema = await invokeWithRetry<SchemaResult>(
 *   'get-website-schema',
 *   ['my-site'],
 *   {
 *     onRetry: (attempt, delay) => console.log(`Retrying in ${delay}ms...`),
 *   }
 * );
 * ```
 */
export async function invokeWithRetry<T = unknown>(
  channel: string,
  args: unknown[] = [],
  options: InvokeWithRetryOptions = {}
): Promise<T> {
  // Check if channel is blacklisted
  if (isRetryBlacklisted(channel)) {
    logger.debug('IPC Retry', `Channel ${channel} is blacklisted, bypassing retry logic`);
    return window.electronAPI!.invoke(channel, ...args) as Promise<T>;
  }

  // Get effective configuration
  const channelConfig = getRetryConfigForChannel(channel);
  const config: RetryConfig = {
    ...channelConfig,
    maxAttempts: options.maxAttempts ?? channelConfig.maxAttempts,
    baseDelay: options.baseDelay ?? channelConfig.baseDelay,
    maxDelay: options.maxDelay ?? channelConfig.maxDelay,
    retryableErrors: options.retryableErrors ?? channelConfig.retryableErrors,
  };

  const context: RetryContext = {
    channel,
    args,
    startTime: Date.now(),
    attempt: 0,
  };

  // Attempt loop
  while (context.attempt < config.maxAttempts) {
    context.attempt++;

    try {
      // Check for abort before attempt
      if (options.signal?.aborted) {
        throw new Error('Retry aborted before attempt');
      }

      // Make IPC call
      const result = (await window.electronAPI!.invoke(channel, ...args)) as T;

      // Success!
      const duration = Date.now() - context.startTime;

      if (context.attempt > 1) {
        logger.info('IPC Retry', `Success after ${context.attempt} attempts`, {
          channel,
          attempts: context.attempt,
          duration,
        });
      }

      options.onSuccess?.(context.attempt, duration);

      return result;
    } catch (error) {
      const err = error as Error;
      context.lastError = err;

      // Check if we should retry
      const isLastAttempt = context.attempt >= config.maxAttempts;
      const shouldRetry = isErrorRetryable(err, config) && !isLastAttempt;

      if (!shouldRetry) {
        // Final failure
        const duration = Date.now() - context.startTime;

        logger.error(
          'IPC Retry',
          `Failed after ${context.attempt} attempts: ${channel} (duration: ${duration}ms, retryable: ${isErrorRetryable(err, config)})`,
          err
        );

        options.onFailure?.(err, context.attempt, duration);

        throw err;
      }

      // Calculate backoff delay
      const backoffDelay = calculateBackoff(context.attempt + 1, config);

      logger.warn('IPC Retry', `Attempt ${context.attempt} failed, retrying in ${backoffDelay}ms`, {
        channel,
        attempt: context.attempt,
        error: err.message,
        delay: backoffDelay,
      });

      options.onRetry?.(context.attempt, backoffDelay, err);

      // Wait before retry
      await delay(backoffDelay, options.signal);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw context.lastError || new Error('Retry exhausted without error');
}
