/**
 * Tests for IPC Retry Logic
 */

import { logger } from '../../../src/renderer/utils/logger';
import {
  DEFAULT_RETRY_CONFIG,
  getRetryConfigForChannel,
  isRetryBlacklisted,
} from '../../../src/renderer/utils/ipc-retry-config';
import {
  calculateBackoff,
  isErrorRetryable,
  invokeWithRetry,
  InvokeWithRetryOptions,
} from '../../../src/renderer/utils/ipc-retry';

// Mock logger to prevent console noise in tests
jest.mock('../../../src/renderer/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock window.electronAPI
const mockInvoke = jest.fn().mockResolvedValue(undefined);

// Setup global window.electronAPI
(global as any).window = (global as any).window || {};
(global as any).window.electronAPI = {
  invoke: mockInvoke,
  send: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
  getCurrentTheme: jest.fn(),
  setTheme: jest.fn(),
  onThemeUpdated: jest.fn(),
  openExternal: jest.fn(),
  getAppInfo: jest.fn(),
  clipboard: {
    writeText: jest.fn(),
    readText: jest.fn(),
  },
  diagnostics: {} as any,
};

describe('IPC Retry Logic', () => {
  // Suppress console errors from error stack traces in tests
  const originalConsoleError = console.error;

  beforeAll(() => {
    console.error = jest.fn();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    // Reset mock to default behavior
    mockInvoke.mockResolvedValue(undefined);
  });

  describe('calculateBackoff', () => {
    const config = DEFAULT_RETRY_CONFIG;

    it('should return 0 for attempt 1 (first attempt)', () => {
      expect(calculateBackoff(1, config)).toBe(0);
    });

    it('should return baseDelay for attempt 2', () => {
      expect(calculateBackoff(2, config)).toBe(1000);
    });

    it('should return baseDelay * 2 for attempt 3', () => {
      expect(calculateBackoff(3, config)).toBe(2000);
    });

    it('should return baseDelay * 4 for attempt 4', () => {
      expect(calculateBackoff(4, config)).toBe(4000);
    });

    it('should return baseDelay * 8 for attempt 5', () => {
      // With baseDelay = 1000, attempt 5 would be 8000 but maxDelay caps it
      expect(calculateBackoff(5, config)).toBe(5000); // Capped at maxDelay
    });

    it('should cap at maxDelay', () => {
      const attempt10 = calculateBackoff(10, config);
      expect(attempt10).toBe(config.maxDelay);
      expect(attempt10).toBe(5000);
    });

    it('should handle custom config with different baseDelay', () => {
      const customConfig = { ...config, baseDelay: 500, maxDelay: 3000 };
      expect(calculateBackoff(2, customConfig)).toBe(500);
      expect(calculateBackoff(3, customConfig)).toBe(1000);
      expect(calculateBackoff(4, customConfig)).toBe(2000);
    });

    it('should handle edge case with attempt 0', () => {
      expect(calculateBackoff(0, config)).toBe(0);
    });

    it('should handle negative attempt numbers', () => {
      expect(calculateBackoff(-1, config)).toBe(0);
      expect(calculateBackoff(-5, config)).toBe(0);
    });

    it('should handle very large attempt numbers', () => {
      const result = calculateBackoff(100, config);
      expect(result).toBe(config.maxDelay);
      expect(result).toBeLessThanOrEqual(config.maxDelay);
    });

    it('should be monotonically increasing until maxDelay', () => {
      let previousDelay = 0;
      for (let attempt = 1; attempt <= 20; attempt++) {
        const delay = calculateBackoff(attempt, config);
        expect(delay).toBeGreaterThanOrEqual(previousDelay);
        previousDelay = delay;
      }
    });

    it('should handle maxDelay smaller than baseDelay gracefully', () => {
      const weirdConfig = { ...config, baseDelay: 5000, maxDelay: 1000 };
      expect(calculateBackoff(2, weirdConfig)).toBe(1000); // Should cap immediately
    });
  });

  describe('isErrorRetryable', () => {
    const config = DEFAULT_RETRY_CONFIG;

    it('should return true for TIMEOUT errors', () => {
      const error = new Error('Request TIMEOUT');
      expect(isErrorRetryable(error, config)).toBe(true);
    });

    it('should return true for ECONNREFUSED errors', () => {
      const error = new Error('Connection failed: ECONNREFUSED');
      expect(isErrorRetryable(error, config)).toBe(true);
    });

    it('should return true for ECONNRESET errors', () => {
      const error = new Error('Socket error: ECONNRESET');
      expect(isErrorRetryable(error, config)).toBe(true);
    });

    it('should return true for ENOTFOUND errors', () => {
      const error = new Error('DNS lookup failed: ENOTFOUND');
      expect(isErrorRetryable(error, config)).toBe(true);
    });

    it('should return true for Network error messages', () => {
      const error = new Error('Network error occurred');
      expect(isErrorRetryable(error, config)).toBe(true);
    });

    it('should return false for validation errors', () => {
      const error = new Error('Validation failed: invalid input');
      expect(isErrorRetryable(error, config)).toBe(false);
    });

    it('should return false for permission errors', () => {
      const error = new Error('Permission denied: EACCES');
      expect(isErrorRetryable(error, config)).toBe(false);
    });

    it('should return false for file not found errors', () => {
      const error = new Error('File not found: ENOENT');
      expect(isErrorRetryable(error, config)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
      expect(isErrorRetryable({} as Error, config)).toBe(false);
      expect(isErrorRetryable(null as any, config)).toBe(false);
      expect(isErrorRetryable(undefined as any, config)).toBe(false);
    });

    it('should return false for Error without message', () => {
      const error = new Error();
      expect(isErrorRetryable(error, config)).toBe(false);
    });

    it('should be case-insensitive when matching error patterns', () => {
      expect(isErrorRetryable(new Error('timeout'), config)).toBe(true);
      expect(isErrorRetryable(new Error('TIMEOUT'), config)).toBe(true);
      expect(isErrorRetryable(new Error('TimeOut'), config)).toBe(true);
    });

    it('should match partial strings in error messages', () => {
      // "timeout" contains "TIMEOUT" pattern (case-insensitive)
      expect(isErrorRetryable(new Error('Request TIMEOUT occurred'), config)).toBe(true);
      expect(isErrorRetryable(new Error('ECONNREFUSED by the server'), config)).toBe(true);
    });

    it('should match any pattern in retryableErrors array', () => {
      const error1 = new Error('TIMEOUT');
      const error2 = new Error('ECONNREFUSED');
      const error3 = new Error('Network error');
      expect(isErrorRetryable(error1, config)).toBe(true);
      expect(isErrorRetryable(error2, config)).toBe(true);
      expect(isErrorRetryable(error3, config)).toBe(true);
    });

    it('should respect custom retryableErrors config', () => {
      const customConfig = { ...config, retryableErrors: ['CUSTOM_ERROR'] };
      expect(isErrorRetryable(new Error('CUSTOM_ERROR'), customConfig)).toBe(true);
      expect(isErrorRetryable(new Error('TIMEOUT'), customConfig)).toBe(false);
    });

    it('should handle empty retryableErrors array', () => {
      const emptyConfig = { ...config, retryableErrors: [] };
      expect(isErrorRetryable(new Error('TIMEOUT'), emptyConfig)).toBe(false);
      expect(isErrorRetryable(new Error('anything'), emptyConfig)).toBe(false);
    });
  });

  describe('invokeWithRetry - basic functionality', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should succeed on first attempt without retry', async () => {
      const mockResult = { success: true, data: 'test' };
      mockInvoke.mockResolvedValueOnce(mockResult);

      const result = await invokeWithRetry('test-channel', ['arg1']);

      expect(result).toEqual(mockResult);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('test-channel', 'arg1');
    });

    it('should succeed on second attempt after retryable failure', async () => {
      const mockResult = { success: true };
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));
      mockInvoke.mockResolvedValueOnce(mockResult);

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', []);

      // Fast-forward through the delay
      await jest.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toEqual(mockResult);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('should succeed on third attempt after 2 retryable failures', async () => {
      const mockResult = { success: true };
      mockInvoke.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));
      mockInvoke.mockResolvedValueOnce(mockResult);

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', []);

      // First retry after 1000ms
      await jest.advanceTimersByTimeAsync(1000);
      // Second retry after 2000ms
      await jest.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result).toEqual(mockResult);
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });

    it('should fail after exhausting all retries', async () => {
      const error = new Error('TIMEOUT');
      mockInvoke.mockRejectedValue(error);

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', []);

      // Advance through all retries
      await jest.advanceTimersByTimeAsync(1000); // First retry
      await jest.advanceTimersByTimeAsync(2000); // Second retry

      await expect(promise).rejects.toThrow('TIMEOUT');
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });
  });

  describe('invokeWithRetry - blacklist behavior', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should bypass retry logic for blacklisted channels', async () => {
      const error = new Error('TIMEOUT');
      mockInvoke.mockRejectedValueOnce(error);

      await expect(invokeWithRetry('diagnostics:clear-errors', [])).rejects.toThrow('TIMEOUT');

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith('IPC Retry', expect.stringContaining('blacklisted'));
    });

    it('should not retry blacklisted channel even with retryable error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      await expect(invokeWithRetry('create-new-page', [])).rejects.toThrow();

      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('invokeWithRetry - non-retryable errors', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should fail immediately on non-retryable error', async () => {
      const error = new Error('Validation failed');
      mockInvoke.mockRejectedValueOnce(error);

      await expect(invokeWithRetry('test-channel', [])).rejects.toThrow('Validation failed');

      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('should not retry on ENOENT errors', async () => {
      const error = new Error('ENOENT: file not found');
      mockInvoke.mockRejectedValueOnce(error);

      await expect(invokeWithRetry('test-channel', [])).rejects.toThrow();

      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('invokeWithRetry - AbortSignal cancellation', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should cancel pending retry when AbortSignal is triggered', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));

      const controller = new AbortController();

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { signal: controller.signal });

      // Abort during the delay
      setTimeout(() => controller.abort(), 500);
      await jest.advanceTimersByTimeAsync(500);

      await expect(promise).rejects.toThrow('Retry aborted');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('should not make IPC call if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(invokeWithRetry('test-channel', [], { signal: controller.signal })).rejects.toThrow('Retry aborted');

      expect(mockInvoke).toHaveBeenCalledTimes(0);
    });
  });

  describe('invokeWithRetry - callback hooks', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should call onRetry callback with correct arguments', async () => {
      const onRetry = jest.fn();
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));
      mockInvoke.mockResolvedValueOnce({ success: true });

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { onRetry });

      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, 1000, expect.any(Error));
    });

    it('should call onSuccess callback on successful completion', async () => {
      const onSuccess = jest.fn();
      mockInvoke.mockResolvedValueOnce({ success: true });

      await invokeWithRetry('test-channel', [], { onSuccess });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it('should call onSuccess with attempt count after retries', async () => {
      const onSuccess = jest.fn();
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));
      mockInvoke.mockResolvedValueOnce({ success: true });

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { onSuccess });

      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(2, expect.any(Number));
    });

    it('should call onFailure callback on final failure', async () => {
      const onFailure = jest.fn();
      mockInvoke.mockRejectedValue(new Error('TIMEOUT'));

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { onFailure });

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await expect(promise).rejects.toThrow();

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(expect.any(Error), 3, expect.any(Number));
    });

    it('should not call onSuccess if request fails', async () => {
      const onSuccess = jest.fn();
      mockInvoke.mockRejectedValue(new Error('TIMEOUT'));

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { onSuccess });

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await expect(promise).rejects.toThrow();
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe('invokeWithRetry - custom configuration', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should respect custom maxAttempts override', async () => {
      mockInvoke.mockRejectedValue(new Error('TIMEOUT'));

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { maxAttempts: 2 });

      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).rejects.toThrow();
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('should respect custom baseDelay override', async () => {
      const onRetry = jest.fn();
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));
      mockInvoke.mockResolvedValueOnce({ success: true });

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { baseDelay: 500, onRetry });

      await jest.advanceTimersByTimeAsync(500);
      await promise;

      expect(onRetry).toHaveBeenCalledWith(1, 500, expect.any(Error));
    });

    it('should respect custom retryableErrors override', async () => {
      mockInvoke.mockRejectedValue(new Error('CUSTOM_ERROR'));

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], {
        retryableErrors: ['CUSTOM_ERROR'],
      });

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await expect(promise).rejects.toThrow();

      // Should have retried since it's now retryable
      expect(mockInvoke.mock.calls.length).toBeGreaterThan(1);
    });

    it('should merge custom config with channel defaults', async () => {
      // Channel 'get-website-schema' has maxAttempts: 3, baseDelay: 1000
      mockInvoke.mockRejectedValue(new Error('TIMEOUT'));

      jest.useFakeTimers();
      const promise = invokeWithRetry('get-website-schema', [], { maxAttempts: 2 });

      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).rejects.toThrow();
      expect(mockInvoke).toHaveBeenCalledTimes(2); // Custom override applied
    });
  });

  describe('invokeWithRetry - TypeScript generics', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    interface TestResult {
      success: boolean;
      data: string;
    }

    it('should preserve type information with generics', async () => {
      const mockResult: TestResult = { success: true, data: 'test' };
      mockInvoke.mockResolvedValueOnce(mockResult);

      const result = await invokeWithRetry<TestResult>('test-channel', []);

      expect(result).toEqual(mockResult);
      expect(result.success).toBe(true);
      expect(result.data).toBe('test');
    });

    it('should work with primitive return types', async () => {
      mockInvoke.mockResolvedValueOnce('string result');

      const result = await invokeWithRetry<string>('test-channel', []);

      expect(typeof result).toBe('string');
      expect(result).toBe('string result');
    });

    it('should work with array return types', async () => {
      const mockArray = [1, 2, 3, 4, 5];
      mockInvoke.mockResolvedValueOnce(mockArray);

      const result = await invokeWithRetry<number[]>('test-channel', []);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(mockArray);
    });
  });

  describe('invokeWithRetry - concurrent requests', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should handle multiple concurrent retries without interference', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ id: 3 });

      const promises = [
        invokeWithRetry('channel-1', ['arg1']),
        invokeWithRetry('channel-2', ['arg2']),
        invokeWithRetry('channel-3', ['arg3']),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure in concurrent requests', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error('Validation failed'));

      const promise1 = invokeWithRetry('channel-1', []);
      const promise2 = invokeWithRetry('channel-2', []);

      const results = await Promise.allSettled([promise1, promise2]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
    });
  });

  describe('invokeWithRetry - exponential backoff timing', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
      jest.useFakeTimers();
    });

    it('should use exponential backoff between retries', async () => {
      const onRetry = jest.fn();
      mockInvoke
        .mockRejectedValueOnce(new Error('TIMEOUT'))
        .mockRejectedValueOnce(new Error('TIMEOUT'))
        .mockResolvedValueOnce({ success: true });

      const promise = invokeWithRetry('test-channel', [], { onRetry });

      // First retry: baseDelay = 1000ms
      await jest.advanceTimersByTimeAsync(1000);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, 1000, expect.any(Error));

      // Second retry: baseDelay * 2 = 2000ms
      await jest.advanceTimersByTimeAsync(2000);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, 2000, expect.any(Error));

      await promise;
    });

    it('should respect maxDelay cap in backoff', async () => {
      const onRetry = jest.fn();
      mockInvoke.mockRejectedValue(new Error('TIMEOUT'));

      const promise = invokeWithRetry('test-channel', [], {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 3000,
        onRetry,
      });

      await jest.advanceTimersByTimeAsync(1000); // 1st retry: 1000ms
      await jest.advanceTimersByTimeAsync(2000); // 2nd retry: 2000ms
      await jest.advanceTimersByTimeAsync(3000); // 3rd retry: 3000ms (capped)
      await jest.advanceTimersByTimeAsync(3000); // 4th retry: 3000ms (capped)

      await expect(promise).rejects.toThrow();

      expect(onRetry).toHaveBeenCalledTimes(4);
      // Third retry should be capped at 3000ms
      expect(onRetry).toHaveBeenNthCalledWith(3, 3, 3000, expect.any(Error));
    });
  });

  describe('invokeWithRetry - logging behavior', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
      jest.clearAllMocks();
    });

    it('should log successful retry attempts', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));
      mockInvoke.mockResolvedValueOnce({ success: true });

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', []);

      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      expect(logger.info).toHaveBeenCalledWith(
        'IPC Retry',
        expect.stringContaining('Success after'),
        expect.objectContaining({
          channel: 'test-channel',
          attempts: 2,
        })
      );
    });

    it('should log retry warnings', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));
      mockInvoke.mockResolvedValueOnce({ success: true });

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', []);

      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      expect(logger.warn).toHaveBeenCalledWith(
        'IPC Retry',
        expect.stringContaining('Attempt 1 failed'),
        expect.objectContaining({
          channel: 'test-channel',
          attempt: 1,
        })
      );
    });

    it('should log final failure', async () => {
      mockInvoke.mockRejectedValue(new Error('TIMEOUT'));

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', []);

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await expect(promise).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'IPC Retry',
        expect.stringContaining('Failed after'),
        expect.any(Error)
      );
    });

    it('should not log success info on first attempt success', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });

      await invokeWithRetry('test-channel', []);

      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('invokeWithRetry - component unmount scenario', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
      jest.useFakeTimers();
    });

    it('should handle cleanup when AbortSignal is used for unmount', async () => {
      mockInvoke.mockRejectedValue(new Error('TIMEOUT'));

      const controller = new AbortController();
      const promise = invokeWithRetry('test-channel', [], { signal: controller.signal });

      // Simulate component unmount
      controller.abort();

      await expect(promise).rejects.toThrow('Retry aborted');
    });

    it('should not leak timers after abort', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('TIMEOUT'));

      const controller = new AbortController();

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', [], { signal: controller.signal });

      // Abort immediately
      controller.abort();

      await expect(promise).rejects.toThrow('Retry aborted');

      // Advance timers - should not cause any issues
      jest.advanceTimersByTime(10000);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('invokeWithRetry - edge cases', () => {
    beforeEach(() => {
      mockInvoke.mockReset();
    });

    it('should handle empty args array', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });

      await invokeWithRetry('test-channel', []);

      expect(mockInvoke).toHaveBeenCalledWith('test-channel');
    });

    it('should handle undefined args', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });

      await invokeWithRetry('test-channel');

      expect(mockInvoke).toHaveBeenCalledWith('test-channel');
    });

    it('should handle multiple arguments', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });

      await invokeWithRetry('test-channel', ['arg1', 'arg2', 'arg3']);

      expect(mockInvoke).toHaveBeenCalledWith('test-channel', 'arg1', 'arg2', 'arg3');
    });

    it('should handle complex argument types', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });
      const complexArg = { nested: { data: [1, 2, 3] } };

      await invokeWithRetry('test-channel', [complexArg, 123, 'string']);

      expect(mockInvoke).toHaveBeenCalledWith('test-channel', complexArg, 123, 'string');
    });

    it('should preserve error stack trace', async () => {
      const originalError = new Error('TIMEOUT');
      const originalStack = originalError.stack;
      mockInvoke.mockRejectedValue(originalError);

      jest.useFakeTimers();
      const promise = invokeWithRetry('test-channel', []);

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      try {
        await promise;
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as Error).stack).toBe(originalStack);
      }
    });
  });
});
