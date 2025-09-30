import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeWithRetry, InvokeWithRetryOptions } from '../../../utils/ipc-retry';
import { recordRetrySuccess, recordRetryFailure } from '../../../utils/ipc-retry-telemetry';
import { logger } from '../../../utils/logger';
import { translateError, FriendlyError } from '../../../utils/error-translator';

/**
 * Options for useIPCInvoke hook
 */
export interface UseIPCInvokeOptions<T>
  extends Omit<InvokeWithRetryOptions, 'signal' | 'onRetry' | 'onSuccess' | 'onFailure'> {
  enabled?: boolean; // Conditional execution (default: true)
  initialData?: T; // Initial data value
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  retry?: boolean; // Enable/disable retries (default: true)
}

/**
 * Result from useIPCInvoke hook
 */
export interface UseIPCInvokeResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  friendlyError: FriendlyError | null; // NEW: User-friendly error for display
  retryCount: number;
  isRetrying: boolean;
  retry: () => Promise<void>;
  cancel: () => void;
}

/**
 * React hook for IPC invocation with automatic retry logic.
 * @param channel IPC channel name
 * @param args Arguments to pass to IPC handler
 * @param options Hook configuration options
 * @returns IPC result with loading/error state and retry capabilities
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { data, loading, error, retryCount } = useIPCInvoke<SchemaResult>(
 *     'get-website-schema',
 *     [websiteName],
 *     { enabled: !!websiteName }
 *   );
 *
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (retryCount > 0) return <div>Retrying... ({retryCount})</div>;
 *   return <div>{JSON.stringify(data)}</div>;
 * }
 * ```
 */
export function useIPCInvoke<T = unknown>(
  channel: string,
  args: unknown[] = [],
  options: UseIPCInvokeOptions<T> = {}
): UseIPCInvokeResult<T> {
  const {
    enabled = true,
    initialData = null,
    onSuccess,
    onError,
    retry: retryEnabled = true,
    ...retryOptions
  } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const execute = useCallback(
    async (resetRetryCount = true) => {
      if (!enabled) {
        return;
      }

      // Cancel previous request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      // Reset state
      if (resetRetryCount) {
        setRetryCount(0);
        setIsRetrying(false);
      }
      setLoading(true);
      setError(null);

      try {
        const startTime = Date.now();

        // Call with retry logic
        const result = await invokeWithRetry<T>(channel, args, {
          ...retryOptions,
          signal: abortControllerRef.current.signal,
          maxAttempts: retryEnabled ? retryOptions.maxAttempts : 1, // Disable retries if retryEnabled=false
          onRetry: (attempt, delay, err) => {
            if (!isMountedRef.current) return;
            setRetryCount(attempt);
            setIsRetrying(true);
            logger.debug('useIPCInvoke', `Retry attempt ${attempt} for ${channel}`, {
              delay,
              error: err.message,
            });
          },
          onSuccess: async (attempts, duration) => {
            if (attempts > 1) {
              try {
                await recordRetrySuccess(channel, attempts, duration);
              } catch (telemetryErr) {
                // Don't let telemetry errors break the hook
                logger.warn('useIPCInvoke', 'Telemetry recordRetrySuccess failed', telemetryErr);
              }
            }
          },
          onFailure: async (err, attempts, duration) => {
            try {
              await recordRetryFailure(channel, err, attempts, duration);
            } catch (telemetryErr) {
              // Don't let telemetry errors break the hook
              logger.warn('useIPCInvoke', 'Telemetry recordRetryFailure failed', telemetryErr);
            }
          },
        });

        // Update state only if still mounted
        if (!isMountedRef.current) return;

        setData(result);
        setError(null);
        setFriendlyError(null);
        setIsRetrying(false);

        onSuccess?.(result);

        const duration = Date.now() - startTime;
        logger.debug('useIPCInvoke', `Success: ${channel}`, {
          duration,
          retryCount,
        });
      } catch (err) {
        // Update state only if still mounted and not aborted
        if (!isMountedRef.current) return;

        const error = err as Error;

        // Don't set error state for abort errors (user-initiated)
        if (error.message === 'Retry aborted' || error.message.includes('aborted')) {
          logger.debug('useIPCInvoke', `Request cancelled: ${channel}`);
          return;
        }

        setError(error);

        // Translate to friendly error
        const friendly = translateError(error, {
          channel,
          operation: 'IPC call',
          retryCount,
          maxRetries: retryOptions.maxAttempts,
        });
        setFriendlyError(friendly);
        setIsRetrying(false);

        onError?.(error);

        logger.error('useIPCInvoke', `Error: ${channel} (retryCount: ${retryCount})`, error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [channel, JSON.stringify(args), enabled, retryEnabled, onSuccess, onError, JSON.stringify(retryOptions)]
  );

  // Auto-execute on mount and when dependencies change
  useEffect(() => {
    execute(true);
  }, [execute]);

  // Manual retry function
  const retry = useCallback(async () => {
    await execute(true); // Reset retry count on manual retry
  }, [execute]);

  // Cancel function
  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setLoading(false);
    setIsRetrying(false);
    logger.debug('useIPCInvoke', `Cancelled: ${channel}`);
  }, [channel]);

  return {
    data,
    loading,
    error,
    friendlyError,
    retryCount,
    isRetrying,
    retry,
    cancel,
  };
}
