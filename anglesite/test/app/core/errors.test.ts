/**
 * @file Error System Tests
 *
 * Tests for the structured error handling system including base errors,
 * domain-specific errors, utilities, and error management.
 */

import {
  AngleError,
  ErrorSeverity,
  ErrorCategory,
  ErrorUtils,
  WebsiteError,
  WebsiteNotFoundError,
  ServerError,
  ServerStartError,
  AtomicOperationError,
  FileNotFoundError,
  RequiredFieldError,
  InvalidFormatError,
  withContext,
  withRetry,
  errorRegistry,
  registerErrorHandler,
  ErrorContextManager,
} from '../../../app/core/errors';

describe('Error System', () => {
  describe('Base AngleError', () => {
    class TestError extends AngleError {
      constructor(message: string) {
        super(message, 'TEST_ERROR', ErrorCategory.SYSTEM, ErrorSeverity.MEDIUM);
      }
    }

    it('should create error with basic properties', () => {
      const error = new TestError('Test message');

      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.category).toBe(ErrorCategory.SYSTEM);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.name).toBe('TestError');
    });

    it('should serialize error properly', () => {
      const error = new TestError('Test message');
      const serialized = error.serialize();

      expect(serialized.name).toBe('TestError');
      expect(serialized.message).toBe('Test message');
      expect(serialized.code).toBe('TEST_ERROR');
      expect(serialized.category).toBe(ErrorCategory.SYSTEM);
      expect(serialized.severity).toBe(ErrorSeverity.MEDIUM);
      expect(serialized.metadata).toBeDefined();
    });

    it('should determine recoverability correctly', () => {
      const criticalError = new TestError('Critical');
      Object.defineProperty(criticalError, 'severity', { value: ErrorSeverity.CRITICAL, configurable: true });

      const mediumError = new TestError('Medium');

      expect(criticalError.isRecoverable()).toBe(false);
      expect(mediumError.isRecoverable()).toBe(true);
    });

    it('should add context correctly', () => {
      const error = new TestError('Test message');
      error.addContext('userId', '123');
      error.addContext('operation', 'test');

      expect(error.metadata.context?.userId).toBe('123');
      expect(error.metadata.context?.operation).toBe('test');
    });

    it('should create error with context', () => {
      const error = new TestError('Test message');
      const contextError = error.withContext({ userId: '456', operation: 'update' });

      expect(contextError.metadata.context?.userId).toBe('456');
      expect(contextError.metadata.context?.operation).toBe('update');
      expect(contextError).not.toBe(error); // Should be a new instance
    });
  });

  describe('Domain-specific Errors', () => {
    it('should create WebsiteError with website context', () => {
      const error = new WebsiteError('Website failed', 'WEBSITE_FAILED', 'site-123', '/path/to/site');

      expect(error.websiteId).toBe('site-123');
      expect(error.websitePath).toBe('/path/to/site');
      expect(error.code).toBe('WEBSITE_FAILED');
      expect(error.category).toBe(ErrorCategory.BUSINESS_LOGIC);
    });

    it('should create WebsiteNotFoundError with proper defaults', () => {
      const error = new WebsiteNotFoundError('site-456');

      expect(error.websiteId).toBe('site-456');
      expect(error.code).toBe('WEBSITE_NOT_FOUND');
      expect(error.message).toBe('Website not found: site-456');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should create ServerError with port context', () => {
      const error = new ServerError('Server failed', 'SERVER_FAILED', 3000, 'server-1');

      expect(error.port).toBe(3000);
      expect(error.serverId).toBe('server-1');
      expect(error.category).toBe(ErrorCategory.SYSTEM);
    });

    it('should create ServerStartError with proper details', () => {
      const error = new ServerStartError(8080, 'Port already in use');

      expect(error.port).toBe(8080);
      expect(error.code).toBe('SERVER_START_FAILED');
      expect(error.message).toBe('Failed to start server on port 8080: Port already in use');
    });

    it('should create AtomicOperationError with operation context', () => {
      const error = new AtomicOperationError('Write failed', 'ATOMIC_WRITE_FAILED', 'writeFile', false, [
        '/tmp/test.tmp',
      ]);

      expect(error.operationType).toBe('writeFile');
      expect(error.rollbackPerformed).toBe(false);
      expect(error.temporaryPaths).toEqual(['/tmp/test.tmp']);
      expect(error.category).toBe(ErrorCategory.ATOMIC_OPERATION);
    });

    it('should create FileNotFoundError with file path', () => {
      const error = new FileNotFoundError('/path/to/file.txt');

      expect(error.path).toBe('/path/to/file.txt');
      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.category).toBe(ErrorCategory.FILE_SYSTEM);
    });

    it('should create validation errors with field context', () => {
      const requiredError = new RequiredFieldError('email');
      expect(requiredError.field).toBe('email');
      expect(requiredError.code).toBe('REQUIRED_FIELD_MISSING');

      const formatError = new InvalidFormatError('phone', '123', 'XXX-XXX-XXXX');
      expect(formatError.field).toBe('phone');
      expect(formatError.value).toBe('123');
      expect(formatError.code).toBe('INVALID_FORMAT');
    });
  });

  describe('ErrorUtils', () => {
    it('should wrap regular Error in AngleError', () => {
      const originalError = new Error('Original error');
      const wrappedError = ErrorUtils.wrap(originalError);

      expect(wrappedError).toBeInstanceOf(AngleError);
      expect(wrappedError.message).toBe('Original error');
      expect(wrappedError.code).toBe('WRAPPED_ERROR');
      expect(wrappedError.category).toBe(ErrorCategory.SYSTEM);
    });

    it('should return AngleError unchanged when wrapping', () => {
      const angleError = new WebsiteError('Test', 'TEST');
      const wrappedError = ErrorUtils.wrap(angleError);

      expect(wrappedError).toBe(angleError);
    });

    it('should wrap string as error', () => {
      const wrappedError = ErrorUtils.wrap('String error message');

      expect(wrappedError).toBeInstanceOf(AngleError);
      expect(wrappedError.message).toBe('String error message');
      expect(wrappedError.code).toBe('UNKNOWN_ERROR');
    });

    it('should wrap error with context', () => {
      const error = new Error('Test error');
      const wrappedError = ErrorUtils.wrap(error, { userId: '123', operation: 'test' });

      expect(wrappedError.metadata.context?.userId).toBe('123');
      expect(wrappedError.metadata.context?.operation).toBe('test');
    });

    it('should check error matches', () => {
      const websiteError = new WebsiteError('Test', 'TEST');

      expect(ErrorUtils.matches(websiteError, WebsiteError)).toBe(true);
      expect(ErrorUtils.matches(websiteError, ServerError)).toBe(false);
      expect(ErrorUtils.matches(websiteError, 'TEST')).toBe(true);
      expect(ErrorUtils.matches(websiteError, 'OTHER')).toBe(false);
    });

    it('should format error for display', () => {
      const error = new WebsiteError('Website failed', 'WEBSITE_FAILED', 'site-123');
      const formatted = ErrorUtils.format(error);

      expect(formatted).toContain('[MEDIUM] BUSINESS_LOGIC:WEBSITE_FAILED');
      expect(formatted).toContain('Website failed');
      expect(formatted).toContain('websiteId=');
    });

    it('should convert error to log object', () => {
      const error = new FileNotFoundError('/test/file.txt');
      const logObj = ErrorUtils.toLogObject(error);

      expect(logObj.name).toBe('FileNotFoundError');
      expect(logObj.message).toBe('File not found: /test/file.txt');
      expect(logObj.code).toBe('FILE_NOT_FOUND');
      expect(logObj.category).toBe(ErrorCategory.FILE_SYSTEM);
      expect(logObj.severity).toBe(ErrorSeverity.MEDIUM);
      expect(logObj.metadata).toBeDefined();
    });

    it('should get error statistics', () => {
      const errors = [
        new WebsiteError('Test 1', 'TEST_1'),
        new ServerError('Test 2', 'TEST_2'),
        new FileNotFoundError('/file'),
        new WebsiteError('Test 3', 'TEST_3'),
      ];

      const stats = ErrorUtils.getStatistics(errors);

      expect(stats.total).toBe(4);
      expect(stats.byCategory[ErrorCategory.BUSINESS_LOGIC]).toBe(2);
      expect(stats.byCategory[ErrorCategory.SYSTEM]).toBe(1);
      expect(stats.byCategory[ErrorCategory.FILE_SYSTEM]).toBe(1);
      expect(stats.bySeverity[ErrorSeverity.MEDIUM]).toBe(3);
      expect(stats.bySeverity[ErrorSeverity.HIGH]).toBe(1); // ServerError defaults to HIGH
    });

    it('should group errors by category', () => {
      const errors = [
        new WebsiteError('Test 1', 'TEST_1'),
        new ServerError('Test 2', 'TEST_2'),
        new WebsiteError('Test 3', 'TEST_3'),
      ];

      const grouped = ErrorUtils.groupByCategory(errors);

      expect(grouped.get(ErrorCategory.BUSINESS_LOGIC)).toHaveLength(2);
      expect(grouped.get(ErrorCategory.SYSTEM)).toHaveLength(1);
    });
  });

  describe('Error Context Management', () => {
    afterEach(() => {
      ErrorContextManager.clearAll();
    });

    it('should execute function with context', async () => {
      let capturedContext: Record<string, unknown> = {};

      await withContext({ operation: 'test', userId: '123' }, async () => {
        capturedContext = ErrorContextManager.getMergedContext();
        return 'success';
      });

      expect(capturedContext.operation).toBe('test');
      expect(capturedContext.userId).toBe('123');
    });

    it('should handle nested contexts', async () => {
      let innerContext: Record<string, unknown> = {};

      await withContext({ operation: 'outer', userId: '123' }, async () => {
        await withContext({ operation: 'inner', websiteId: 'site-456' }, async () => {
          innerContext = ErrorContextManager.getMergedContext();
          return 'inner';
        });
        return 'outer';
      });

      expect(innerContext.operation).toBe('inner'); // Should override
      expect(innerContext.userId).toBe('123'); // Should inherit
      expect(innerContext.websiteId).toBe('site-456'); // Should be added
    });

    it('should clean up context stack properly', async () => {
      await withContext({ operation: 'test' }, async () => {
        expect(ErrorContextManager.getMergedContext().operation).toBe('test');
        return 'success';
      });

      // Context should be cleaned up
      expect(Object.keys(ErrorContextManager.getMergedContext())).toHaveLength(0);
    });
  });

  describe('Error Retry Mechanism', () => {
    it('should succeed on first try', async () => {
      let attempts = 0;

      const result = await withRetry(
        () => {
          attempts++;
          return 'success';
        },
        3,
        100
      );

      expect(result).toBe('success');
      expect(attempts).toBe(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;

      const result = await withRetry(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        },
        3,
        10
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should fail after max retries', async () => {
      let attempts = 0;

      await expect(
        withRetry(
          () => {
            attempts++;
            throw new Error('Persistent failure');
          },
          2,
          10
        )
      ).rejects.toThrow('Persistent failure');

      expect(attempts).toBe(3); // Initial attempt + 2 retries
    });

    it('should use error-specific retry delays', async () => {
      class NetworkTestError extends AngleError {
        constructor() {
          super('Network error', 'NETWORK_ERROR', ErrorCategory.NETWORK);
        }

        getRetryDelay() {
          return 50; // Custom delay
        }

        isRecoverable() {
          return true; // Make sure it's recoverable for retries
        }
      }

      let attempts = 0;
      const startTime = Date.now();

      try {
        await withRetry(
          () => {
            attempts++;
            throw new NetworkTestError();
          },
          1,
          100 // This should be overridden by error's getRetryDelay()
        );
      } catch {
        // Expected to fail
      }

      const endTime = Date.now();
      expect(attempts).toBe(2);
      // Should have used custom delay of 50ms instead of 100ms
      expect(endTime - startTime).toBeLessThan(80);
    });
  });

  describe('Error Registration and Handling', () => {
    beforeEach(() => {
      // Clear any existing handlers
      // Clear handlers - accessing private property for testing
      (errorRegistry as unknown as { handlers: Map<string, unknown[]> }).handlers.clear();
    });

    it('should register and call error handlers', async () => {
      const handler = jest.fn();
      registerErrorHandler('WebsiteError', handler);

      const error = new WebsiteError('Test error', 'TEST');
      await errorRegistry.handleError(error);

      expect(handler).toHaveBeenCalledWith(error);
    });

    it('should call global error handlers', async () => {
      const globalHandler = jest.fn();
      const specificHandler = jest.fn();

      registerErrorHandler('*', globalHandler);
      registerErrorHandler('ServerError', specificHandler);

      const websiteError = new WebsiteError('Test', 'TEST');
      const serverError = new ServerError('Test', 'TEST');

      await errorRegistry.handleError(websiteError);
      await errorRegistry.handleError(serverError);

      expect(globalHandler).toHaveBeenCalledTimes(2);
      expect(specificHandler).toHaveBeenCalledTimes(1);
      expect(specificHandler).toHaveBeenCalledWith(serverError);
    });

    it('should handle handler errors gracefully', async () => {
      const faultyHandler = jest.fn(() => {
        throw new Error('Handler error');
      });

      registerErrorHandler('WebsiteError', faultyHandler);

      const error = new WebsiteError('Test', 'TEST');

      // Should not throw despite handler error
      await expect(errorRegistry.handleError(error)).resolves.toBeUndefined();
      expect(faultyHandler).toHaveBeenCalled();
    });
  });

  describe('Error Serialization and Deserialization', () => {
    it('should serialize and deserialize error correctly', () => {
      const originalError = new WebsiteNotFoundError('site-123', {
        operation: 'loadWebsite',
        context: { userId: '456' },
      });

      const serialized = originalError.serialize();
      const deserialized = ErrorUtils.fromSerialized(serialized);

      expect(deserialized.message).toBe(originalError.message);
      expect(deserialized.code).toBe(originalError.code);
      expect(deserialized.category).toBe(originalError.category);
      expect(deserialized.severity).toBe(originalError.severity);
      expect(deserialized.name).toBe(originalError.name);
      expect(deserialized.metadata.operation).toBe('loadWebsite');
      expect(deserialized.metadata.context?.userId).toBe('456');
    });

    it('should handle nested error serialization', () => {
      const cause = new Error('Root cause');
      const wrappedCause = ErrorUtils.wrap(cause);
      const topError = new WebsiteError(
        'Top level',
        'TOP_LEVEL',
        undefined,
        undefined,
        undefined,
        undefined,
        wrappedCause
      );

      const serialized = topError.serialize();
      expect(serialized.cause).toBeDefined();
      expect(serialized.cause?.message).toBe('Root cause');

      const deserialized = ErrorUtils.fromSerialized(serialized);
      expect(deserialized.getRootCause().message).toBe('Root cause');
    });

    it('should convert to JSON properly', () => {
      const error = new ServerStartError(3000, 'Port in use');
      const jsonString = JSON.stringify(error);
      const parsed = JSON.parse(jsonString);

      expect(parsed.name).toBe('ServerStartError');
      expect(parsed.message).toBe('Failed to start server on port 3000: Port in use');
      expect(parsed.code).toBe('SERVER_START_FAILED');
    });
  });
});
