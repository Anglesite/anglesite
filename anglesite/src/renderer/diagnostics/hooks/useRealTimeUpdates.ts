/**
 * @file Real-time diagnostics updates hook
 * @description Manages live error subscriptions and real-time data synchronization
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ComponentError, ErrorStatistics, RealTimeState } from '../types/diagnostics';

export interface UseRealTimeUpdatesOptions {
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Maximum number of errors to keep in memory (default: 1000) */
  maxErrors?: number;
  /** Reconnection retry interval in ms (default: 5000) */
  retryInterval?: number;
  /** Maximum reconnection attempts (default: 5) */
  maxRetries?: number;
}

export interface UseRealTimeUpdatesReturn {
  /** Current real-time connection state */
  realTimeState: RealTimeState;
  /** Live errors array (automatically updated) */
  errors: ComponentError[];
  /** Live statistics (automatically updated) */
  statistics: ErrorStatistics;
  /** Connect to real-time updates */
  connect: () => Promise<void>;
  /** Disconnect from real-time updates */
  disconnect: () => void;
  /** Force refresh all data */
  refresh: () => Promise<void>;
  /** Clear all errors */
  clearErrors: () => Promise<void>;
}

export const useRealTimeUpdates = (options: UseRealTimeUpdatesOptions = {}): UseRealTimeUpdatesReturn => {
  const { autoConnect = true, maxErrors = 1000, retryInterval = 5000, maxRetries = 5 } = options;

  const [realTimeState, setRealTimeState] = useState<RealTimeState>({
    connected: false,
    lastUpdate: null,
    subscriptionError: null,
  });

  const [errors, setErrors] = useState<ComponentError[]>([]);
  const [statistics, setStatistics] = useState<ErrorStatistics>({
    total: 0,
    bySeverity: {},
    byCategory: {},
    hourlyTrends: [],
  });

  const unsubscribe = useRef<(() => void) | null>(null);
  const retryCount = useRef<number>(0);
  const retryTimeout = useRef<NodeJS.Timeout | null>(null);
  const isUnmounted = useRef<boolean>(false);

  // Handle new error events
  const handleErrorEvent = useCallback(
    (newError: ComponentError) => {
      if (isUnmounted.current) return;

      setErrors((prev) => {
        const updated = [newError, ...prev];
        // Keep only the most recent errors within maxErrors limit
        return updated.slice(0, maxErrors);
      });

      setRealTimeState((prev) => ({
        ...prev,
        lastUpdate: new Date(),
      }));
    },
    [maxErrors]
  );

  // Handle statistics updates
  const handleStatisticsUpdate = useCallback((newStatistics: ErrorStatistics) => {
    if (isUnmounted.current) return;

    setStatistics(newStatistics);
    setRealTimeState((prev) => ({
      ...prev,
      lastUpdate: new Date(),
    }));
  }, []);

  // Handle connection state changes
  const handleConnectionStateChange = useCallback(
    (connected: boolean, error?: string) => {
      if (isUnmounted.current) return;

      setRealTimeState((prev) => ({
        ...prev,
        connected,
        subscriptionError: error || null,
      }));

      if (!connected && error) {
        console.error('Real-time connection lost:', error);

        // Attempt reconnection if within retry limits
        if (retryCount.current < maxRetries) {
          retryCount.current++;
          retryTimeout.current = setTimeout(() => {
            if (!isUnmounted.current) {
              connect();
            }
          }, retryInterval);
        }
      } else if (connected) {
        // Reset retry count on successful connection
        retryCount.current = 0;
        if (retryTimeout.current) {
          clearTimeout(retryTimeout.current);
          retryTimeout.current = null;
        }
      }
    },
    [maxRetries, retryInterval]
  );

  // Connect to real-time updates
  const connect = useCallback(async () => {
    if (!window.electronAPI?.diagnostics) {
      throw new Error('Diagnostics API not available');
    }

    try {
      setRealTimeState((prev) => ({ ...prev, subscriptionError: null }));

      // Subscribe to real-time error events
      unsubscribe.current = window.electronAPI.diagnostics.subscribeToErrors((error: unknown) =>
        handleErrorEvent(error as ComponentError)
      );

      // Load initial data
      const [initialErrors, initialStatistics] = await Promise.all([
        window.electronAPI.diagnostics.getErrors(),
        window.electronAPI.diagnostics.getStatistics(),
      ]);

      if (!isUnmounted.current) {
        // Transform and set initial errors
        const transformedErrors: ComponentError[] = (initialErrors as any[]).map((rawError: any, index: number) => ({
          id: rawError.id || `error-${index}`,
          message: rawError.message || 'Unknown error',
          code: rawError.code || 'UNKNOWN',
          severity: rawError.severity || 'MEDIUM',
          category: rawError.category || 'SYSTEM',
          timestamp: rawError.timestamp ? new Date(rawError.timestamp) : new Date(),
          metadata: {
            operation: rawError.operation,
            context: rawError.context || {},
            stack: rawError.stack,
          },
        }));

        setErrors(transformedErrors.slice(0, maxErrors));
        setStatistics(initialStatistics);

        handleConnectionStateChange(true);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      handleConnectionStateChange(false, errorMessage);
      throw error;
    }
  }, [handleErrorEvent, handleStatisticsUpdate, handleConnectionStateChange, maxErrors]);

  // Disconnect from real-time updates
  const disconnect = useCallback(() => {
    if (unsubscribe.current) {
      unsubscribe.current();
      unsubscribe.current = null;
    }

    if (retryTimeout.current) {
      clearTimeout(retryTimeout.current);
      retryTimeout.current = null;
    }

    handleConnectionStateChange(false);
  }, [handleConnectionStateChange]);

  // Force refresh all data
  const refresh = useCallback(async () => {
    if (!window.electronAPI?.diagnostics) {
      throw new Error('Diagnostics API not available');
    }

    try {
      const [refreshedErrors, refreshedStatistics] = await Promise.all([
        window.electronAPI.diagnostics.getErrors(),
        window.electronAPI.diagnostics.getStatistics(),
      ]);

      if (!isUnmounted.current) {
        // Transform and set refreshed errors
        const transformedErrors: ComponentError[] = (refreshedErrors as any[]).map((rawError: any, index: number) => ({
          id: rawError.id || `error-${index}`,
          message: rawError.message || 'Unknown error',
          code: rawError.code || 'UNKNOWN',
          severity: rawError.severity || 'MEDIUM',
          category: rawError.category || 'SYSTEM',
          timestamp: rawError.timestamp ? new Date(rawError.timestamp) : new Date(),
          metadata: {
            operation: rawError.operation,
            context: rawError.context || {},
            stack: rawError.stack,
          },
        }));

        setErrors(transformedErrors.slice(0, maxErrors));
        setStatistics(refreshedStatistics);

        setRealTimeState((prev) => ({
          ...prev,
          lastUpdate: new Date(),
        }));
      }
    } catch (error) {
      console.error('Failed to refresh diagnostics data:', error);
      throw error;
    }
  }, [maxErrors]);

  // Clear all errors
  const clearErrors = useCallback(async () => {
    if (!window.electronAPI?.diagnostics) {
      throw new Error('Diagnostics API not available');
    }

    try {
      await window.electronAPI.diagnostics.clearErrors();

      if (!isUnmounted.current) {
        setErrors([]);
        setStatistics((prev) => ({
          ...prev,
          total: 0,
          bySeverity: {},
          byCategory: {},
        }));

        setRealTimeState((prev) => ({
          ...prev,
          lastUpdate: new Date(),
        }));
      }
    } catch (error) {
      console.error('Failed to clear errors:', error);
      throw error;
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect().catch((error) => {
        console.error('Auto-connection failed:', error);
      });
    }

    return () => {
      isUnmounted.current = true;
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isUnmounted.current = true;
      if (retryTimeout.current) {
        clearTimeout(retryTimeout.current);
      }
    };
  }, []);

  return {
    realTimeState,
    errors,
    statistics,
    connect,
    disconnect,
    refresh,
    clearErrors,
  };
};
