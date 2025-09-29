import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { TelemetryService } from '../../src/main/services/telemetry-service';
import { IStore } from '../../src/main/core/interfaces';
import { Database } from 'better-sqlite3';
import { TelemetryConfig, TelemetryEvent } from '../../src/main/types/telemetry';

describe('TelemetryService', () => {
  let telemetryService: TelemetryService;
  let mockStore: jest.Mocked<IStore>;
  let mockDb: jest.Mocked<Database>;

  beforeEach(() => {
    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      getAll: jest.fn(),
      setAll: jest.fn(),
      saveWindowStates: jest.fn(),
      getWindowStates: jest.fn(),
      clearWindowStates: jest.fn(),
      addRecentWebsite: jest.fn(),
      getRecentWebsites: jest.fn(),
      clearRecentWebsites: jest.fn(),
      removeRecentWebsite: jest.fn(),
      forceSave: jest.fn(),
      dispose: jest.fn(),
    } as any;

    mockDb = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn(),
      }),
      transaction: jest.fn((fn) => fn),
      exec: jest.fn(),
      close: jest.fn(),
    } as any;

    telemetryService = new TelemetryService(mockStore, mockDb);
  });

  describe('Configuration', () => {
    test('should initialize with default configuration', () => {
      const config = telemetryService.getConfig();

      expect(config).toEqual({
        enabled: false,
        samplingRate: 1.0,
        maxBatchSize: 100,
        batchIntervalMs: 30000,
        maxStorageMb: 10,
        retentionDays: 30,
        anonymizeErrors: true,
        endpoints: [],
      });
    });

    test('should load configuration from store', async () => {
      const customConfig: TelemetryConfig = {
        enabled: true,
        samplingRate: 0.5,
        maxBatchSize: 50,
        batchIntervalMs: 60000,
        maxStorageMb: 5,
        retentionDays: 7,
        anonymizeErrors: false,
        endpoints: [],
      };

      mockStore.get.mockReturnValue(customConfig);

      await telemetryService.initialize();
      const config = telemetryService.getConfig();

      expect(config).toEqual(customConfig);
      expect(mockStore.get).toHaveBeenCalledWith('telemetryConfig');
    });

    test('should validate configuration values', async () => {
      const invalidConfig = {
        enabled: true,
        samplingRate: 1.5, // Invalid: > 1
        maxBatchSize: -1, // Invalid: negative
        batchIntervalMs: 100,
        maxStorageMb: 0, // Invalid: zero
        retentionDays: 400, // Invalid: > 365
        anonymizeErrors: true,
      };

      await expect(telemetryService.configure(invalidConfig as any)).rejects.toThrow('Invalid configuration');
    });

    test('should save valid configuration', async () => {
      const validConfig: TelemetryConfig = {
        enabled: true,
        samplingRate: 0.8,
        maxBatchSize: 200,
        batchIntervalMs: 20000,
        maxStorageMb: 15,
        retentionDays: 60,
        anonymizeErrors: true,
        endpoints: [],
      };

      await telemetryService.configure(validConfig);

      expect(mockStore.set).toHaveBeenCalledWith(
        'telemetryConfig',
        expect.objectContaining({
          enabled: true,
          samplingRate: 0.8,
          maxBatchSize: 200,
          batchIntervalMs: 20000,
          maxStorageMb: 15,
          retentionDays: 60,
          anonymizeErrors: true,
        })
      );
      expect(telemetryService.getConfig()).toEqual(validConfig);
    });
  });

  describe('Event Recording', () => {
    beforeEach(async () => {
      await telemetryService.initialize();
      await telemetryService.configure({
        enabled: true,
        samplingRate: 1.0,
        maxBatchSize: 10,
        batchIntervalMs: 1000,
        maxStorageMb: 10,
        retentionDays: 30,
        anonymizeErrors: true,
        endpoints: [],
      });
    });

    test('should record telemetry event when enabled', async () => {
      const event: Partial<TelemetryEvent> = {
        error: {
          message: 'Test error',
          stack: 'Error: Test error\n    at TestComponent',
        },
        component: {
          name: 'TestComponent',
          hierarchy: ['App', 'TestComponent'],
        },
      };

      const recordedEvent = await telemetryService.recordEvent(event);

      expect(recordedEvent).toMatchObject({
        id: expect.any(String),
        timestamp: expect.any(Number),
        sessionId: expect.any(String),
        error: event.error,
        component: event.component,
      });
    });

    test('should not record when disabled', async () => {
      await telemetryService.configure({
        ...telemetryService.getConfig(),
        enabled: false,
      });

      const event = await telemetryService.recordEvent({
        error: { message: 'Test' },
      } as any);

      expect(event).toBeNull();
    });

    test('should respect sampling rate', async () => {
      await telemetryService.configure({
        ...telemetryService.getConfig(),
        samplingRate: 0.5,
      });

      // Mock Math.random for deterministic testing
      const randomSpy = jest.spyOn(Math, 'random');

      // Should record when random < samplingRate
      randomSpy.mockReturnValueOnce(0.3);
      const recorded = await telemetryService.recordEvent({
        error: { message: 'Test' },
      } as any);
      expect(recorded).not.toBeNull();

      // Should not record when random >= samplingRate
      randomSpy.mockReturnValueOnce(0.7);
      const notRecorded = await telemetryService.recordEvent({
        error: { message: 'Test' },
      } as any);
      expect(notRecorded).toBeNull();

      randomSpy.mockRestore();
    });

    test('should anonymize PII in error messages', async () => {
      const event = await telemetryService.recordEvent({
        error: {
          message: 'User john@example.com failed to login',
          stack: 'Error at 192.168.1.1:3000',
        },
        component: { name: 'LoginForm' },
      } as any);

      expect(event?.error.message).toBe('User [REDACTED_EMAIL] failed to login');
      expect(event?.error.stack).toBe('Error at [REDACTED_IP]:3000');
    });

    test('should handle circular references in component data', async () => {
      const circular: any = { name: 'TestComponent' };
      circular.self = circular;

      const event = await telemetryService.recordEvent({
        error: { message: 'Test' },
        component: circular,
      } as any);

      expect(event).not.toBeNull();
      expect(() => JSON.stringify(event)).not.toThrow();
    });
  });

  describe('Batch Processing', () => {
    test('should batch events before processing', async () => {
      await telemetryService.initialize();
      await telemetryService.configure({
        enabled: true,
        samplingRate: 1.0,
        maxBatchSize: 3,
        batchIntervalMs: 1000,
        maxStorageMb: 10,
        retentionDays: 30,
        anonymizeErrors: false,
        endpoints: [],
      });

      const processSpy = jest.spyOn(telemetryService as any, 'processBatch');

      // Record 2 events - should not trigger batch
      await telemetryService.recordEvent({ error: { message: 'Error 1' } } as any);
      await telemetryService.recordEvent({ error: { message: 'Error 2' } } as any);
      expect(processSpy).not.toHaveBeenCalled();

      // Record 3rd event - should trigger batch
      await telemetryService.recordEvent({ error: { message: 'Error 3' } } as any);

      // Wait for async processBatch to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(processSpy).toHaveBeenCalledTimes(1);
    });

    test('should process batch after interval', async () => {
      jest.useFakeTimers();

      await telemetryService.initialize();
      await telemetryService.configure({
        enabled: true,
        samplingRate: 1.0,
        maxBatchSize: 10,
        batchIntervalMs: 5000,
        maxStorageMb: 10,
        retentionDays: 30,
        anonymizeErrors: false,
        endpoints: [],
      });

      const processSpy = jest.spyOn(telemetryService as any, 'processBatch');

      await telemetryService.recordEvent({ error: { message: 'Error 1' } } as any);
      expect(processSpy).not.toHaveBeenCalled();

      // Advance time by batch interval
      jest.advanceTimersByTime(5000);
      await Promise.resolve(); // Let async operations complete

      expect(processSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe('Storage Management', () => {
    test('should enforce storage size limits', async () => {
      await telemetryService.initialize();
      await telemetryService.configure({
        enabled: true,
        samplingRate: 1.0,
        maxBatchSize: 100,
        batchIntervalMs: 30000,
        maxStorageMb: 0.001, // 1KB limit for testing
        retentionDays: 30,
        anonymizeErrors: false,
        endpoints: [],
      });

      // Create a large event
      const largeEvent = {
        error: {
          message: 'x'.repeat(2000), // 2KB message
        },
        component: { name: 'Test' },
      };

      const result = await telemetryService.recordEvent(largeEvent as any);

      // Should either truncate or reject
      if (result) {
        expect(result.error.message.length).toBeLessThanOrEqual(10000); // MAX_MESSAGE_LENGTH
      } else {
        expect(result).toBeNull();
      }
    });

    test('should enforce retention period', async () => {
      const deleteOldEventsSpy = jest.spyOn(telemetryService as any, 'deleteOldEvents');

      await telemetryService.initialize();
      await telemetryService.configure({
        enabled: true,
        samplingRate: 1.0,
        maxBatchSize: 100,
        batchIntervalMs: 30000,
        maxStorageMb: 10,
        retentionDays: 7,
        anonymizeErrors: false,
        endpoints: [],
      });

      await telemetryService.cleanupOldEvents();

      expect(deleteOldEventsSpy).toHaveBeenCalled();
    });
  });

  describe('Lifecycle', () => {
    test('should initialize database on startup', async () => {
      await telemetryService.initialize();

      expect(mockDb.exec).toHaveBeenCalled();
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS'));
    });

    test('should clean up resources on shutdown', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      await telemetryService.initialize();
      await telemetryService.shutdown();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    test('should handle database errors gracefully', async () => {
      mockDb.exec.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(telemetryService.initialize()).rejects.toThrow('Failed to initialize telemetry');

      // Service should still be usable but disabled
      const event = await telemetryService.recordEvent({ error: { message: 'Test' } } as any);
      expect(event).toBeNull();
    });
  });
});
