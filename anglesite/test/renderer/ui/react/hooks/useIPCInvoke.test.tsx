import { renderHook, waitFor, act } from '@testing-library/react';
import { useIPCInvoke } from '../../../../../src/renderer/ui/react/hooks/useIPCInvoke';
import * as ipcRetry from '../../../../../src/renderer/utils/ipc-retry';
import * as telemetry from '../../../../../src/renderer/utils/ipc-retry-telemetry';
import { logger } from '../../../../../src/renderer/utils/logger';

// Mock dependencies
jest.mock('../../../../../src/renderer/utils/ipc-retry');
jest.mock('../../../../../src/renderer/utils/ipc-retry-telemetry');
jest.mock('../../../../../src/renderer/utils/logger');

const mockInvokeWithRetry = ipcRetry.invokeWithRetry as jest.MockedFunction<typeof ipcRetry.invokeWithRetry>;
const mockRecordRetrySuccess = telemetry.recordRetrySuccess as jest.MockedFunction<typeof telemetry.recordRetrySuccess>;
const mockRecordRetryFailure = telemetry.recordRetryFailure as jest.MockedFunction<typeof telemetry.recordRetryFailure>;

describe('useIPCInvoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Basic functionality', () => {
    it('executes invoke on mount', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledWith(
          'test-channel',
          [],
          expect.objectContaining({
            signal: expect.any(AbortSignal),
          })
        );
      });
    });

    it('sets loading state correctly', async () => {
      let resolveInvoke: (value: unknown) => void;
      const invokePromise = new Promise((resolve) => {
        resolveInvoke = resolve;
      });
      mockInvokeWithRetry.mockReturnValue(invokePromise as Promise<unknown>);

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      // Should be loading initially
      await waitFor(() => {
        expect(result.current.loading).toBe(true);
      });

      // Resolve the promise
      await act(async () => {
        resolveInvoke!({ success: true });
        await invokePromise;
      });

      // Should no longer be loading
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('returns data on success', async () => {
      const testData = { id: 123, name: 'test' };
      mockInvokeWithRetry.mockResolvedValue(testData);

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.data).toEqual(testData);
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
      });
    });

    it('sets error on failure', async () => {
      const testError = new Error('Test error');
      mockInvokeWithRetry.mockRejectedValue(testError);

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.error).toEqual(testError);
        expect(result.current.data).toBeNull();
        expect(result.current.loading).toBe(false);
      });
    });

    it('respects enabled=false option', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useIPCInvoke('test-channel', [], { enabled: false }));

      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });

      expect(mockInvokeWithRetry).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBeNull();
    });

    it('uses initialData', () => {
      const initialData = { id: 1, name: 'initial' };
      mockInvokeWithRetry.mockResolvedValue({ id: 2, name: 'updated' });

      const { result } = renderHook(() => useIPCInvoke('test-channel', [], { initialData }));

      // Should have initial data immediately
      expect(result.current.data).toEqual(initialData);
    });

    it('calls onSuccess callback', async () => {
      const testData = { success: true };
      const onSuccess = jest.fn();
      mockInvokeWithRetry.mockResolvedValue(testData);

      renderHook(() => useIPCInvoke('test-channel', [], { onSuccess }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(testData);
      });
    });

    it('calls onError callback', async () => {
      const testError = new Error('Test error');
      const onError = jest.fn();
      mockInvokeWithRetry.mockRejectedValue(testError);

      renderHook(() => useIPCInvoke('test-channel', [], { onError }));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(testError);
      });
    });

    it('passes args to invokeWithRetry', async () => {
      const args = ['arg1', 123, { key: 'value' }];
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      renderHook(() => useIPCInvoke('test-channel', args));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledWith('test-channel', args, expect.any(Object));
      });
    });
  });

  describe('Retry state management', () => {
    it('retryCount increments during retries', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        // Simulate retries
        onRetryCallback?.(1, 1000, new Error('Retry 1'));
        onRetryCallback?.(2, 2000, new Error('Retry 2'));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.retryCount).toBeGreaterThan(0);
      });
    });

    it('isRetrying is true during retry', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry'));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.isRetrying).toBe(true);
      });
    });

    it('retryCount resets on manual retry', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry 1'));
        onRetryCallback?.(2, 2000, new Error('Retry 2'));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      // Wait for first execution with retries
      await waitFor(() => {
        expect(result.current.retryCount).toBeGreaterThan(0);
      });

      // Manual retry should reset count
      mockInvokeWithRetry.mockResolvedValue({ success: true });
      await act(async () => {
        await result.current.retry();
      });

      await waitFor(() => {
        expect(result.current.retryCount).toBe(0);
      });
    });

    it('successful retry sets retryCount correctly', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry 1'));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.retryCount).toBe(1);
        expect(result.current.data).toEqual({ success: true });
        expect(result.current.error).toBeNull();
      });
    });

    it('failed retry maintains retryCount', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry 1'));
        onRetryCallback?.(2, 2000, new Error('Retry 2'));
        throw new Error('Final failure');
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.retryCount).toBeGreaterThan(0);
      });
    });

    it('isRetrying is false after successful retry', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry'));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.isRetrying).toBe(false);
        expect(result.current.data).toEqual({ success: true });
      });
    });

    it('isRetrying is false after failed retry', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry'));
        throw new Error('Final failure');
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.isRetrying).toBe(false);
        expect(result.current.error).toBeTruthy();
      });
    });

    it('retryCount starts at 0 on initial execution', () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      expect(result.current.retryCount).toBe(0);
    });

    it('retryCount persists across re-renders', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry'));
        return { success: true };
      });

      const { result, rerender } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.retryCount).toBe(1);
      });

      rerender();

      expect(result.current.retryCount).toBe(1);
    });

    it('multiple consecutive retries increment count correctly', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry 1'));
        onRetryCallback?.(2, 2000, new Error('Retry 2'));
        onRetryCallback?.(3, 3000, new Error('Retry 3'));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.retryCount).toBe(3);
      });
    });
  });

  describe('Manual retry function', () => {
    it('retry() triggers new execution', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Manual retry
      await act(async () => {
        await result.current.retry();
      });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(2);
      });
    });

    it('retry() resets retryCount', async () => {
      let onRetryCallback: ((attempt: number, delay: number, err: Error) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onRetryCallback = options?.onRetry;
        onRetryCallback?.(1, 1000, new Error('Retry'));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.retryCount).toBe(1);
      });

      // Manual retry should reset count
      mockInvokeWithRetry.mockResolvedValue({ success: true });
      await act(async () => {
        await result.current.retry();
      });

      await waitFor(() => {
        expect(result.current.retryCount).toBe(0);
      });
    });

    it('retry() clears previous error', async () => {
      mockInvokeWithRetry.mockRejectedValue(new Error('Initial error'));

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      // Manual retry should clear error
      mockInvokeWithRetry.mockResolvedValue({ success: true });
      await act(async () => {
        await result.current.retry();
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
        expect(result.current.data).toEqual({ success: true });
      });
    });

    it('multiple retries work correctly', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Multiple manual retries
      await act(async () => {
        await result.current.retry();
      });

      await act(async () => {
        await result.current.retry();
      });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(3);
      });
    });

    it('retry() sets loading state', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Manual retry
      let resolveInvoke: (value: unknown) => void;
      const invokePromise = new Promise((resolve) => {
        resolveInvoke = resolve;
      });
      mockInvokeWithRetry.mockReturnValue(invokePromise as Promise<unknown>);

      act(() => {
        result.current.retry();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(true);
      });

      // Resolve
      await act(async () => {
        resolveInvoke!({ success: true });
        await invokePromise;
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('retry() cancels previous request', async () => {
      let firstAbortSignal: AbortSignal | undefined;
      let secondAbortSignal: AbortSignal | undefined;

      mockInvokeWithRetry
        .mockImplementationOnce(async (channel, args, options) => {
          firstAbortSignal = options?.signal;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return { first: true };
        })
        .mockImplementationOnce(async (channel, args, options) => {
          secondAbortSignal = options?.signal;
          return { second: true };
        });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Trigger manual retry before first completes
      await act(async () => {
        await result.current.retry();
      });

      await waitFor(() => {
        expect(firstAbortSignal?.aborted).toBe(true);
        expect(secondAbortSignal?.aborted).toBe(false);
      });
    });
  });

  describe('Cancellation', () => {
    it('cancel() stops pending request', async () => {
      let abortSignal: AbortSignal | undefined;
      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        abortSignal = options?.signal;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalled();
      });

      act(() => {
        result.current.cancel();
      });

      expect(abortSignal?.aborted).toBe(true);
      expect(result.current.loading).toBe(false);
      expect(result.current.isRetrying).toBe(false);
    });

    it('unmount cancels pending request', async () => {
      let abortSignal: AbortSignal | undefined;
      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        abortSignal = options?.signal;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { success: true };
      });

      const { unmount } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalled();
      });

      unmount();

      expect(abortSignal?.aborted).toBe(true);
    });

    it('cancelled request does not update state', async () => {
      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        // Check if aborted before resolving
        if (options?.signal?.aborted) {
          throw new Error('Operation aborted');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { success: true };
      });

      const { unmount } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalled();
      });

      // Unmount before request completes
      unmount();

      // Wait a bit to ensure no state updates occur
      await act(async () => {
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      // State should remain as it was (no updates after unmount)
      // Note: We can't test this directly after unmount, but we ensure no errors occur
    });

    it('AbortSignal propagates to invokeWithRetry', async () => {
      let capturedSignal: AbortSignal | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        capturedSignal = options?.signal;
        return { success: true };
      });

      renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(capturedSignal).toBeInstanceOf(AbortSignal);
      });
    });

    it('multiple component instances do not interfere', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result: result1 } = renderHook(() => useIPCInvoke('channel-1'));
      const { result: result2 } = renderHook(() => useIPCInvoke('channel-2'));

      await waitFor(() => {
        expect(result1.current.data).toEqual({ success: true });
        expect(result2.current.data).toEqual({ success: true });
      });

      // Cancel first instance
      act(() => {
        result1.current.cancel();
      });

      // Second instance should not be affected
      expect(result2.current.loading).toBe(false);
      expect(result2.current.data).toEqual({ success: true });
    });

    it('abort error does not set error state', async () => {
      mockInvokeWithRetry.mockRejectedValue(new Error('Retry aborted'));

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalled();
      });

      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });

      expect(result.current.error).toBeNull();
    });

    it('cancel() logs debug message', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.cancel();
      });

      expect(logger.debug).toHaveBeenCalledWith('useIPCInvoke', 'Cancelled: test-channel');
    });

    it('cancelled request logs cancellation message', async () => {
      mockInvokeWithRetry.mockRejectedValue(new Error('Operation aborted'));

      renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalled();
      });

      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });

      expect(logger.debug).toHaveBeenCalledWith('useIPCInvoke', 'Request cancelled: test-channel');
    });
  });

  describe('Telemetry integration', () => {
    it('calls recordRetrySuccess on success after retries', async () => {
      let onSuccessCallback: ((attempts: number, duration: number) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onSuccessCallback = options?.onSuccess;
        // Simulate 2 attempts, 100ms duration
        await onSuccessCallback?.(2, 100);
        return { success: true };
      });

      renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockRecordRetrySuccess).toHaveBeenCalledWith('test-channel', 2, 100);
      });
    });

    it('does not call recordRetrySuccess on first attempt success', async () => {
      let onSuccessCallback: ((attempts: number, duration: number) => void) | undefined;

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onSuccessCallback = options?.onSuccess;
        // Simulate 1 attempt (no retries)
        await onSuccessCallback?.(1, 50);
        return { success: true };
      });

      renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalled();
      });

      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });

      expect(mockRecordRetrySuccess).not.toHaveBeenCalled();
    });

    it('calls recordRetryFailure on final failure', async () => {
      let onFailureCallback: ((err: Error, attempts: number, duration: number) => void) | undefined;

      const testError = new Error('Final failure');
      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onFailureCallback = options?.onFailure;
        await onFailureCallback?.(testError, 3, 500);
        throw testError;
      });

      renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockRecordRetryFailure).toHaveBeenCalledWith('test-channel', testError, 3, 500);
      });
    });

    it('telemetry errors do not break hook', async () => {
      let onSuccessCallback: ((attempts: number, duration: number) => void) | undefined;

      mockRecordRetrySuccess.mockRejectedValue(new Error('Telemetry error'));

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onSuccessCallback = options?.onSuccess;
        await onSuccessCallback?.(2, 100);
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.data).toEqual({ success: true });
        expect(result.current.error).toBeNull();
      });
    });

    it('passes telemetry callbacks to invokeWithRetry', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledWith(
          'test-channel',
          [],
          expect.objectContaining({
            onSuccess: expect.any(Function),
            onFailure: expect.any(Function),
          })
        );
      });
    });

    it('telemetry callbacks handle async operations', async () => {
      let onSuccessCallback: ((attempts: number, duration: number) => void) | undefined;

      mockRecordRetrySuccess.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onSuccessCallback = options?.onSuccess;
        await onSuccessCallback?.(2, 100);
        return { success: true };
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.data).toEqual({ success: true });
      });

      expect(mockRecordRetrySuccess).toHaveBeenCalled();
    });

    it('telemetry failure errors are logged and do not break hook', async () => {
      let onFailureCallback: ((err: Error, attempts: number, duration: number) => void) | undefined;

      mockRecordRetryFailure.mockRejectedValue(new Error('Telemetry failure error'));

      const testError = new Error('Final failure');
      mockInvokeWithRetry.mockImplementation(async (channel, args, options) => {
        onFailureCallback = options?.onFailure;
        await onFailureCallback?.(testError, 3, 500);
        throw testError;
      });

      const { result } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.error).toEqual(testError);
      });

      expect(mockRecordRetryFailure).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'useIPCInvoke',
        'Telemetry recordRetryFailure failed',
        expect.any(Error)
      );
    });
  });

  describe('Edge cases', () => {
    it('args changes trigger re-execution', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { rerender } = renderHook(({ args }) => useIPCInvoke('test-channel', args), {
        initialProps: { args: ['arg1'] },
      });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Change args
      rerender({ args: ['arg2'] });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(2);
        expect(mockInvokeWithRetry).toHaveBeenLastCalledWith('test-channel', ['arg2'], expect.any(Object));
      });
    });

    it('channel changes trigger re-execution', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { rerender } = renderHook(({ channel }) => useIPCInvoke(channel), {
        initialProps: { channel: 'channel-1' },
      });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Change channel
      rerender({ channel: 'channel-2' });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(2);
        expect(mockInvokeWithRetry).toHaveBeenLastCalledWith('channel-2', [], expect.any(Object));
      });
    });

    it('enabled toggle works correctly', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { rerender } = renderHook(({ enabled }) => useIPCInvoke('test-channel', [], { enabled }), {
        initialProps: { enabled: false },
      });

      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });

      expect(mockInvokeWithRetry).not.toHaveBeenCalled();

      // Enable
      rerender({ enabled: true });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Disable again
      rerender({ enabled: false });

      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });

      // Should not trigger another call
      expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
    });

    it('concurrent requests handle abort correctly', async () => {
      let firstAbortSignal: AbortSignal | undefined;
      let secondAbortSignal: AbortSignal | undefined;

      mockInvokeWithRetry
        .mockImplementationOnce(async (channel, args, options) => {
          firstAbortSignal = options?.signal;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return { first: true };
        })
        .mockImplementationOnce(async (channel, args, options) => {
          secondAbortSignal = options?.signal;
          return { second: true };
        });

      const { rerender } = renderHook(({ args }) => useIPCInvoke('test-channel', args), {
        initialProps: { args: ['first'] },
      });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Trigger re-execution before first completes
      rerender({ args: ['second'] });

      await waitFor(() => {
        expect(firstAbortSignal?.aborted).toBe(true);
        expect(secondAbortSignal?.aborted).toBe(false);
      });
    });

    it('retryEnabled=false disables retries', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      renderHook(() => useIPCInvoke('test-channel', [], { retry: false }));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledWith(
          'test-channel',
          [],
          expect.objectContaining({
            maxAttempts: 1,
          })
        );
      });
    });

    it('component remount resets state', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { result, unmount } = renderHook(() => useIPCInvoke('test-channel'));

      await waitFor(() => {
        expect(result.current.data).toEqual({ success: true });
      });

      // Unmount
      unmount();

      // Remount with new render
      const { result: newResult } = renderHook(() => useIPCInvoke('test-channel'));

      // Should start fresh
      expect(newResult.current.retryCount).toBe(0);
      expect(newResult.current.isRetrying).toBe(false);
    });

    it('handles complex object args correctly', async () => {
      const complexArgs = [{ nested: { deep: { value: 123 } } }, [1, 2, 3], 'string', null, undefined];

      mockInvokeWithRetry.mockResolvedValue({ success: true });

      renderHook(() => useIPCInvoke('test-channel', complexArgs));

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledWith('test-channel', complexArgs, expect.any(Object));
      });
    });

    it('handles options changes correctly', async () => {
      mockInvokeWithRetry.mockResolvedValue({ success: true });

      const { rerender } = renderHook(({ options }) => useIPCInvoke('test-channel', [], options), {
        initialProps: { options: { maxAttempts: 3 } },
      });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
      });

      // Change options
      rerender({ options: { maxAttempts: 5 } });

      await waitFor(() => {
        expect(mockInvokeWithRetry).toHaveBeenCalledTimes(2);
      });
    });
  });
});
