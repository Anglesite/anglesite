/**
 * @file Tests for useRealTimeUpdates hook
 */
import { renderHook, act } from '@testing-library/react';
import { jest } from '@jest/globals';
import { useRealTimeUpdates } from '../../../../src/renderer/diagnostics/hooks/useRealTimeUpdates';
import type { ComponentError, ErrorStatistics } from '../../../../src/renderer/diagnostics/types/diagnostics';

// Mock electron API
const mockSubscribeToErrors = jest.fn();
const mockUnsubscribeFromErrors = jest.fn();
const mockGetErrors = jest.fn();
const mockGetStatistics = jest.fn();
const mockClearErrors = jest.fn();

Object.defineProperty(window, 'electronAPI', {
  value: {
    diagnostics: {
      subscribeToErrors: mockSubscribeToErrors,
      unsubscribeFromErrors: mockUnsubscribeFromErrors,
      getErrors: mockGetErrors,
      getStatistics: mockGetStatistics,
      clearErrors: mockClearErrors,
    },
  },
  writable: true,
});

describe('useRealTimeUpdates', () => {
  const mockError: ComponentError = {
    id: 'test-error-1',
    message: 'Test error message',
    code: 'TEST_ERROR_001',
    severity: 'HIGH' as any,
    category: 'SYSTEM' as any,
    timestamp: new Date('2024-01-01T10:30:00Z'),
    metadata: {
      operation: 'test-operation',
      context: { userId: '123' },
      stack: 'Error stack trace',
    },
  };

  const mockStatistics: ErrorStatistics = {
    total: 5,
    bySeverity: { HIGH: 2, MEDIUM: 3 },
    byCategory: { SYSTEM: 3, NETWORK: 2 },
    hourlyTrends: [
      { timestamp: new Date('2024-01-01T10:00:00Z'), count: 2 },
      { timestamp: new Date('2024-01-01T11:00:00Z'), count: 3 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup default mocks
    mockGetErrors.mockResolvedValue([]);
    mockGetStatistics.mockResolvedValue(mockStatistics);
    mockSubscribeToErrors.mockResolvedValue('subscription-123');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should initialize with default values', () => {
    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    expect(result.current.realTimeState.connected).toBe(false);
    expect(result.current.realTimeState.lastUpdate).toBeNull();
    expect(result.current.realTimeState.subscriptionError).toBeNull();
    expect(result.current.errors).toEqual([]);
    expect(result.current.statistics).toEqual({
      total: 0,
      bySeverity: {},
      byCategory: {},
      hourlyTrends: [],
    });
  });

  test('should auto-connect on mount when enabled', async () => {
    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: true }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockSubscribeToErrors).toHaveBeenCalled();
    expect(mockGetErrors).toHaveBeenCalled();
    expect(mockGetStatistics).toHaveBeenCalled();
  });

  test('should not auto-connect when disabled', () => {
    renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    expect(mockSubscribeToErrors).not.toHaveBeenCalled();
  });

  test('should connect and load initial data successfully', async () => {
    const initialErrors = [mockError];
    mockGetErrors.mockResolvedValue(initialErrors);

    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.realTimeState.connected).toBe(true);
    expect(result.current.errors).toHaveLength(1);
    expect(result.current.statistics).toEqual(mockStatistics);
    expect(mockSubscribeToErrors).toHaveBeenCalled();
  });

  test('should handle connection errors', async () => {
    const errorMessage = 'Connection failed';
    mockSubscribeToErrors.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    await expect(result.current.connect()).rejects.toThrow(errorMessage);
    expect(result.current.realTimeState.connected).toBe(false);
    expect(result.current.realTimeState.subscriptionError).toBe(errorMessage);
  });

  test('should handle new error events', async () => {
    let errorEventHandler: ((error: ComponentError) => void) | undefined;
    mockSubscribeToErrors.mockImplementation((onError) => {
      errorEventHandler = onError;
      return Promise.resolve('subscription-123');
    });

    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    await act(async () => {
      await result.current.connect();
    });

    // Simulate new error event
    act(() => {
      errorEventHandler?.(mockError);
    });

    expect(result.current.errors).toContain(mockError);
    expect(result.current.realTimeState.lastUpdate).toBeInstanceOf(Date);
  });

  test('should handle statistics updates', async () => {
    let statisticsEventHandler: ((statistics: ErrorStatistics) => void) | undefined;
    mockSubscribeToErrors.mockImplementation((onError, onStatistics) => {
      statisticsEventHandler = onStatistics;
      return Promise.resolve('subscription-123');
    });

    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    await act(async () => {
      await result.current.connect();
    });

    const newStatistics: ErrorStatistics = {
      ...mockStatistics,
      total: 10,
    };

    // Simulate statistics update
    act(() => {
      statisticsEventHandler?.(newStatistics);
    });

    expect(result.current.statistics).toEqual(newStatistics);
    expect(result.current.realTimeState.lastUpdate).toBeInstanceOf(Date);
  });

  test('should limit errors to maxErrors', async () => {
    const maxErrors = 3;
    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false, maxErrors }));

    // Simulate adding more errors than the limit
    const errors = Array.from({ length: 5 }, (_, i) => ({
      ...mockError,
      id: `error-${i}`,
      message: `Error ${i}`,
    }));

    let errorEventHandler: ((error: ComponentError) => void) | undefined;
    mockSubscribeToErrors.mockImplementation((onError) => {
      errorEventHandler = onError;
      return Promise.resolve('subscription-123');
    });

    await act(async () => {
      await result.current.connect();
    });

    // Add errors one by one
    for (const error of errors) {
      act(() => {
        errorEventHandler?.(error);
      });
    }

    expect(result.current.errors).toHaveLength(maxErrors);
    // Should keep the most recent errors
    expect(result.current.errors[0].id).toBe('error-4');
    expect(result.current.errors[1].id).toBe('error-3');
    expect(result.current.errors[2].id).toBe('error-2');
  });

  test('should disconnect properly', async () => {
    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    await act(async () => {
      await result.current.connect();
    });

    act(() => {
      result.current.disconnect();
    });

    expect(mockUnsubscribeFromErrors).toHaveBeenCalledWith('subscription-123');
    expect(result.current.realTimeState.connected).toBe(false);
  });

  test('should refresh data successfully', async () => {
    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    const refreshedErrors = [mockError];
    const refreshedStatistics = { ...mockStatistics, total: 15 };

    mockGetErrors.mockResolvedValue(refreshedErrors);
    mockGetStatistics.mockResolvedValue(refreshedStatistics);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.errors).toEqual(refreshedErrors);
    expect(result.current.statistics).toEqual(refreshedStatistics);
    expect(result.current.realTimeState.lastUpdate).toBeInstanceOf(Date);
  });

  test('should clear errors successfully', async () => {
    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    // First add some errors
    let errorEventHandler: ((error: ComponentError) => void) | undefined;
    mockSubscribeToErrors.mockImplementation((onError) => {
      errorEventHandler = onError;
      return Promise.resolve('subscription-123');
    });

    await act(async () => {
      await result.current.connect();
    });

    act(() => {
      errorEventHandler?.(mockError);
    });

    expect(result.current.errors).toHaveLength(1);

    // Clear errors
    await act(async () => {
      await result.current.clearErrors();
    });

    expect(mockClearErrors).toHaveBeenCalled();
    expect(result.current.errors).toHaveLength(0);
    expect(result.current.statistics.total).toBe(0);
  });

  test('should handle reconnection attempts', async () => {
    const maxRetries = 2;
    const retryInterval = 1000;

    let connectionStateHandler: ((connected: boolean, error?: string) => void) | undefined;
    mockSubscribeToErrors.mockImplementation((onError, onStatistics, onConnectionState) => {
      connectionStateHandler = onConnectionState;
      return Promise.resolve('subscription-123');
    });

    const { result } = renderHook(() =>
      useRealTimeUpdates({
        autoConnect: false,
        maxRetries,
        retryInterval,
      })
    );

    await act(async () => {
      await result.current.connect();
    });

    // Simulate connection loss
    act(() => {
      connectionStateHandler?.(false, 'Connection lost');
    });

    expect(result.current.realTimeState.connected).toBe(false);
    expect(result.current.realTimeState.subscriptionError).toBe('Connection lost');

    // Fast-forward time to trigger retry
    act(() => {
      jest.advanceTimersByTime(retryInterval);
    });

    // Should attempt to reconnect
    expect(mockSubscribeToErrors).toHaveBeenCalledTimes(2);
  });

  test('should cleanup on unmount', () => {
    const { unmount } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    unmount();

    // Should not throw errors during cleanup
    expect(true).toBe(true);
  });

  test('should handle API not available error', async () => {
    // Remove electron API
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
    });

    const { result } = renderHook(() => useRealTimeUpdates({ autoConnect: false }));

    await expect(result.current.connect()).rejects.toThrow('Diagnostics API not available');
  });
});
