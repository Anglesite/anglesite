import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  recordRetryAttempt,
  recordRetrySuccess,
  recordRetryFailure,
  resetTelemetryCache,
  IPCRetryEvent,
} from '../../../src/renderer/utils/ipc-retry-telemetry';
import { logger } from '../../../src/renderer/utils/logger';

// Mock window.electronAPI
const mockInvoke = jest.fn();

// Setup global window.electronAPI
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).window = (global as any).window || {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).window.electronAPI = {
  invoke: mockInvoke,
};

// Mock logger
jest.mock('../../../src/renderer/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('IPC Retry Telemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTelemetryCache();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isTelemetryEnabled()', () => {
    test('returns true when telemetry is enabled', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: true });

      // Import and test the internal function through recordRetryAttempt
      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await recordRetryAttempt(event);

      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));
    });

    test('returns false when telemetry is disabled', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: false });

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await recordRetryAttempt(event);

      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
      expect(mockInvoke).toHaveBeenCalledTimes(1); // Only config check, no report
    });

    test('caches result for 60 seconds', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      // First call
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Second call immediately - should use cache
      await recordRetryAttempt(event);
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:get-config');
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));
    });

    test('re-checks after TTL expires', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      // First call
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Advance time past TTL
      jest.advanceTimersByTime(61000);
      jest.setSystemTime(Date.now() + 61000);

      // Should re-check config
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
    });

    test('handles missing telemetry channel gracefully', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockRejectedValueOnce(new Error('Channel not found'));

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await expect(recordRetryAttempt(event)).resolves.not.toThrow();
      expect(logger.debug).toHaveBeenCalledWith(
        'IPC Retry Telemetry',
        'Telemetry check failed, assuming disabled',
        expect.any(Error)
      );
    });

    test('returns false on error', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await recordRetryAttempt(event);

      // Should not attempt to send telemetry event
      expect(mockInvoke).toHaveBeenCalledTimes(1); // Only the config check
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
    });
  });

  describe('recordRetryAttempt()', () => {
    beforeEach(() => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });
    });

    test('sends telemetry event when enabled', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at test.js:10:5';

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 2,
        totalAttempts: 5,
        delay: 200,
        error,
        timestamp: 1234567890,
        success: false,
        totalDuration: 500,
      };

      await recordRetryAttempt(event);

      expect(mockInvoke).toHaveBeenCalledWith('telemetry:report-event', {
        timestamp: 1234567890,
        error: {
          message: 'IPC retry attempt 2/5: test-channel',
          stack: 'Error: Test error\n  at test.js:10:5',
        },
        component: {
          name: 'IPCRetryWrapper',
          hierarchy: ['Renderer', 'IPC', 'Retry'],
        },
        context: {
          channel: 'test-channel',
          attemptNumber: 2,
          totalAttempts: 5,
          delay: 200,
          success: false,
          totalDuration: 500,
          errorMessage: 'Test error',
        },
      });
    });

    test('skips when telemetry disabled', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: false });
      resetTelemetryCache();

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await recordRetryAttempt(event);

      expect(mockInvoke).toHaveBeenCalledTimes(1); // Only config check
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));
    });

    test('includes all event fields', async () => {
      const error = new Error('Custom error message');
      error.stack = 'Custom stack trace';

      const event: IPCRetryEvent = {
        channel: 'custom-channel',
        attempt: 3,
        totalAttempts: 4,
        delay: 400,
        error,
        timestamp: 9876543210,
        success: true,
        totalDuration: 1200,
      };

      await recordRetryAttempt(event);

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      expect(telemetryCall).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const telemetryEvent = telemetryCall![1] as any;

      expect(telemetryEvent.timestamp).toBe(9876543210);
      expect(telemetryEvent.error.message).toBe('IPC retry attempt 3/4: custom-channel');
      expect(telemetryEvent.error.stack).toBe('Custom stack trace');
      expect(telemetryEvent.component.name).toBe('IPCRetryWrapper');
      expect(telemetryEvent.component.hierarchy).toEqual(['Renderer', 'IPC', 'Retry']);
      expect(telemetryEvent.context.channel).toBe('custom-channel');
      expect(telemetryEvent.context.attemptNumber).toBe(3);
      expect(telemetryEvent.context.totalAttempts).toBe(4);
      expect(telemetryEvent.context.delay).toBe(400);
      expect(telemetryEvent.context.success).toBe(true);
      expect(telemetryEvent.context.totalDuration).toBe(1200);
      expect(telemetryEvent.context.errorMessage).toBe('Custom error message');
    });

    test('handles telemetry send failure gracefully (no throw)', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: true }); // Config check
      // @ts-expect-error - Mock return type
      mockInvoke.mockRejectedValueOnce(new Error('Telemetry service unavailable')); // Report fails

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await expect(recordRetryAttempt(event)).resolves.not.toThrow();
    });

    test('logs debug message on success', async () => {
      const event: IPCRetryEvent = {
        channel: 'success-channel',
        attempt: 2,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: true,
        totalDuration: 200,
      };

      await recordRetryAttempt(event);

      expect(logger.debug).toHaveBeenCalledWith('IPC Retry Telemetry', 'Recorded retry attempt for success-channel', {
        attempt: 2,
        success: true,
      });
    });

    test('logs warning on telemetry failure', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: true });
      // @ts-expect-error - Mock return type
      mockInvoke.mockRejectedValueOnce(new Error('Network failure'));

      const event: IPCRetryEvent = {
        channel: 'fail-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await recordRetryAttempt(event);

      expect(logger.warn).toHaveBeenCalledWith(
        'IPC Retry Telemetry',
        'Failed to record retry attempt',
        expect.any(Error)
      );
    });

    test('handles error without stack trace', async () => {
      const errorNoStack = new Error('Error without stack');
      delete errorNoStack.stack;

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: errorNoStack,
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      await expect(recordRetryAttempt(event)).resolves.not.toThrow();

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((telemetryCall![1] as any).error.stack).toBeUndefined();
    });
  });

  describe('recordRetrySuccess()', () => {
    beforeEach(() => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });
    });

    test('sends success event when enabled', async () => {
      await recordRetrySuccess('success-channel', 3, 1500);

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      expect(telemetryCall).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = telemetryCall![1] as any;
      expect(event.error.message).toBe('IPC retry succeeded after 3 attempts: success-channel');
      expect(event.component.name).toBe('IPCRetryWrapper');
      expect(event.component.hierarchy).toEqual(['Renderer', 'IPC', 'Retry']);
      expect(event.context.channel).toBe('success-channel');
      expect(event.context.totalAttempts).toBe(3);
      expect(event.context.totalDuration).toBe(1500);
      expect(event.context.finalResult).toBe('success');
      expect(event.timestamp).toBeGreaterThan(0);
    });

    test('skips when telemetry disabled', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: false });
      resetTelemetryCache();

      await recordRetrySuccess('success-channel', 2, 1000);

      expect(mockInvoke).toHaveBeenCalledTimes(1); // Only config check
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));
    });

    test('includes correct context fields', async () => {
      await recordRetrySuccess('my-channel', 5, 3000);

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const context = (telemetryCall![1] as any).context;

      expect(context).toEqual({
        channel: 'my-channel',
        totalAttempts: 5,
        totalDuration: 3000,
        finalResult: 'success',
      });
    });

    test('handles errors gracefully', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: true });
      // @ts-expect-error - Mock return type
      mockInvoke.mockRejectedValueOnce(new Error('Telemetry failure'));

      await expect(recordRetrySuccess('test-channel', 2, 1000)).resolves.not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        'IPC Retry Telemetry',
        'Failed to record retry success',
        expect.any(Error)
      );
    });

    test('logs debug message on success', async () => {
      await recordRetrySuccess('debug-channel', 4, 2500);

      expect(logger.debug).toHaveBeenCalledWith('IPC Retry Telemetry', 'Recorded retry success for debug-channel', {
        attempts: 4,
        duration: 2500,
      });
    });

    test('uses Date.now() for timestamp', async () => {
      const now = 1234567890000;
      jest.setSystemTime(now);

      await recordRetrySuccess('time-channel', 1, 100);

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((telemetryCall![1] as any).timestamp).toBe(now);
    });
  });

  describe('recordRetryFailure()', () => {
    beforeEach(() => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });
    });

    test('always logs error locally (even if telemetry disabled)', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: false });
      resetTelemetryCache();

      const error = new Error('Critical failure');
      await recordRetryFailure('fail-channel', error, 5, 3000);

      expect(logger.error).toHaveBeenCalledWith('IPC Retry Telemetry', 'Retry failed after 5 attempts: fail-channel', {
        error,
        channel: 'fail-channel',
        attempts: 5,
        duration: 3000,
      });
    });

    test('sends failure event when telemetry enabled', async () => {
      const error = new Error('Test failure');
      error.stack = 'Error: Test failure\n  at test.js:50:10';

      await recordRetryFailure('error-channel', error, 3, 2000);

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      expect(telemetryCall).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = telemetryCall![1] as any;
      expect(event.error.message).toBe('IPC retry failed after 3 attempts: error-channel');
      expect(event.error.stack).toBe('Error: Test failure\n  at test.js:50:10');
      expect(event.component.name).toBe('IPCRetryWrapper');
      expect(event.component.hierarchy).toEqual(['Renderer', 'IPC', 'Retry']);
      expect(event.context.channel).toBe('error-channel');
      expect(event.context.totalAttempts).toBe(3);
      expect(event.context.totalDuration).toBe(2000);
      expect(event.context.finalResult).toBe('failure');
      expect(event.context.errorMessage).toBe('Test failure');
    });

    test('skips telemetry when disabled (but still logs)', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: false });
      resetTelemetryCache();

      const error = new Error('Test error');
      await recordRetryFailure('test-channel', error, 2, 1000);

      expect(logger.error).toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledTimes(1); // Only config check
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));
    });

    test('includes error stack trace', async () => {
      const error = new Error('Stack trace test');
      error.stack = 'Error: Stack trace test\n  at function1 (file1.js:10:5)\n  at function2 (file2.js:20:10)';

      await recordRetryFailure('stack-channel', error, 4, 3500);

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((telemetryCall![1] as any).error.stack).toBe(error.stack);
    });

    test('handles telemetry errors', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: true });
      // @ts-expect-error - Mock return type
      mockInvoke.mockRejectedValueOnce(new Error('Telemetry service down'));

      const error = new Error('Test error');
      await expect(recordRetryFailure('test-channel', error, 3, 2000)).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        'IPC Retry Telemetry',
        'Failed to record retry failure',
        expect.any(Error)
      );
    });

    test('logs debug message on successful telemetry send', async () => {
      const error = new Error('Test error');
      await recordRetryFailure('debug-channel', error, 3, 1500);

      expect(logger.debug).toHaveBeenCalledWith('IPC Retry Telemetry', 'Recorded retry failure for debug-channel', {
        attempts: 3,
        duration: 1500,
      });
    });

    test('handles error without stack trace', async () => {
      const errorNoStack = new Error('No stack error');
      delete errorNoStack.stack;

      await expect(recordRetryFailure('test-channel', errorNoStack, 2, 1000)).resolves.not.toThrow();

      const telemetryCall = mockInvoke.mock.calls.find((call) => call[0] === 'telemetry:report-event');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((telemetryCall![1] as any).error.stack).toBeUndefined();
    });

    test('logs error with all context fields', async () => {
      const error = new Error('Context test');
      await recordRetryFailure('context-channel', error, 7, 5000);

      expect(logger.error).toHaveBeenCalledWith(
        'IPC Retry Telemetry',
        'Retry failed after 7 attempts: context-channel',
        {
          error,
          channel: 'context-channel',
          attempts: 7,
          duration: 5000,
        }
      );
    });
  });

  describe('Integration tests', () => {
    test('cache invalidation works correctly', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      // First call - checks config
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Second call within TTL - uses cache
      await recordRetryAttempt(event);
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Advance time past TTL
      jest.advanceTimersByTime(61000);
      jest.setSystemTime(Date.now() + 61000);

      // Third call after TTL - re-checks config
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
    });

    test('resetTelemetryCache() clears cache', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      // First call
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Reset cache
      resetTelemetryCache();

      // Next call should re-check config
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
    });

    test('multiple calls use cached value', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      // First call establishes cache
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Make 5 more calls - should not re-check config
      for (let i = 0; i < 5; i++) {
        await recordRetryAttempt(event);
      }

      const additionalConfigChecks = mockInvoke.mock.calls.filter((call) => call[0] === 'telemetry:get-config').length;
      expect(additionalConfigChecks).toBe(0);

      // Should have sent 5 telemetry events
      const telemetryEvents = mockInvoke.mock.calls.filter((call) => call[0] === 'telemetry:report-event').length;
      expect(telemetryEvents).toBe(5);
    });

    test('TTL expiration triggers re-check', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });

      const baseTime = 1234567890000;
      jest.setSystemTime(baseTime);

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      // Initial call
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Wait 59 seconds - still within TTL
      jest.setSystemTime(baseTime + 59000);
      await recordRetryAttempt(event);
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // Wait another 2 seconds - exceeds TTL (total 61 seconds)
      jest.setSystemTime(baseTime + 61000);
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
    });

    test('different functions share the same cache', async () => {
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValue({ enabled: true });

      const event: IPCRetryEvent = {
        channel: 'test-channel',
        attempt: 1,
        totalAttempts: 3,
        delay: 100,
        error: new Error('Test error'),
        timestamp: Date.now(),
        success: false,
        totalDuration: 100,
      };

      // recordRetryAttempt establishes cache
      await recordRetryAttempt(event);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');

      jest.clearAllMocks();

      // recordRetrySuccess should use the same cache
      await recordRetrySuccess('success-channel', 2, 1000);
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:get-config');
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));

      jest.clearAllMocks();

      // recordRetryFailure should also use the same cache
      await recordRetryFailure('fail-channel', new Error('Test'), 3, 2000);
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:get-config');
    });

    test('cache updates when telemetry state changes', async () => {
      // Initially enabled
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: true });

      await recordRetrySuccess('test-channel', 1, 100);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));

      jest.clearAllMocks();
      resetTelemetryCache();

      // Now disabled
      // @ts-expect-error - Mock return type
      mockInvoke.mockResolvedValueOnce({ enabled: false });

      await recordRetrySuccess('test-channel', 1, 100);
      expect(mockInvoke).toHaveBeenCalledWith('telemetry:get-config');
      expect(mockInvoke).not.toHaveBeenCalledWith('telemetry:report-event', expect.any(Object));
    });
  });
});
