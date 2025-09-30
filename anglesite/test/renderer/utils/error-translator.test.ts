/**
 * @file Tests for error translator
 */

import {
  FriendlyError,
  translateError,
  TranslationContext,
  sanitizePath,
  sanitizeStackTrace,
} from '../../../src/renderer/utils/error-translator';
import {
  ErrorCategory,
  ErrorSeverity,
  NetworkError,
  FileSystemError,
  ValidationError,
} from '../../../src/main/core/errors/base';

describe('Error Translator', () => {
  describe('AngleError Translation', () => {
    test('translates NetworkError with code lookup', () => {
      const error = new (class extends NetworkError {
        constructor() {
          super('Connection refused', 'NETWORK_CONNECTION_REFUSED', ErrorSeverity.MEDIUM);
        }
      })();

      const friendly = translateError(error);

      expect(friendly.title).toBe('Connection Failed');
      expect(friendly.message).toContain('server');
      expect(friendly.isRetryable).toBe(true);
      expect(friendly.category).toBe(ErrorCategory.NETWORK);
      expect(friendly.originalError).toBe(error);
    });

    test('translates FileSystemError with existing metadata', () => {
      const error = new (class extends FileSystemError {
        constructor() {
          super('File not found', 'FILE_NOT_FOUND', '/path/to/file.txt', ErrorSeverity.MEDIUM);
        }
      })();

      const friendly = translateError(error);

      expect(friendly.title).toBe('File Not Found');
      expect(friendly.category).toBe(ErrorCategory.FILE_SYSTEM);
      expect(friendly.context?.resource).toContain('file.txt');
    });

    test('translates ValidationError with field information', () => {
      const error = new (class extends ValidationError {
        constructor() {
          super('Field is required', 'VALIDATION_REQUIRED_FIELD', 'email', undefined, ErrorSeverity.LOW);
        }
      })();

      const friendly = translateError(error);

      expect(friendly.category).toBe(ErrorCategory.VALIDATION);
      expect(friendly.isRetryable).toBe(false);
    });
  });

  describe('Plain Error Translation', () => {
    test('translates plain Error via pattern matching', () => {
      const error = new Error('ECONNREFUSED: connection refused');
      const friendly = translateError(error, {
        channel: 'get-website-schema',
      });

      expect(friendly.category).toBe(ErrorCategory.NETWORK);
      expect(friendly.isRetryable).toBe(true);
      expect(friendly.context?.channel).toBe('get-website-schema');
    });

    test('translates timeout error', () => {
      const error = new Error('ETIMEDOUT: operation timed out');
      const friendly = translateError(error);

      expect(friendly.title).toBe('Request Timed Out');
      expect(friendly.isRetryable).toBe(true);
    });

    test('translates file not found error', () => {
      const error = new Error('ENOENT: no such file or directory');
      const friendly = translateError(error);

      expect(friendly.title).toBe('File Not Found');
      expect(friendly.category).toBe(ErrorCategory.FILE_SYSTEM);
    });

    test('provides generic fallback for unknown errors', () => {
      const error = new Error('Something completely bizarre happened');
      const friendly = translateError(error);

      expect(friendly.title).toBe('An Error Occurred');
      expect(friendly.message).toContain('unexpected');
      expect(friendly.showDetails).toBe(true);
      expect(friendly.technicalMessage).toBe('Something completely bizarre happened');
    });
  });

  describe('Context Enrichment', () => {
    test('adds IPC channel context', () => {
      const error = new Error('Failed');
      const friendly = translateError(error, {
        channel: 'save-file-content',
        operation: 'save',
      });

      expect(friendly.context?.channel).toBe('save-file-content');
      expect(friendly.context?.operation).toBe('save');
    });

    test('includes retry count in context', () => {
      const error = new Error('ETIMEDOUT');
      const friendly = translateError(error, {
        retryCount: 2,
        maxRetries: 3,
      });

      expect(friendly.context?.retryCount).toBe(2);
      expect(friendly.context?.maxRetries).toBe(3);
    });

    test('passes context to template rendering', () => {
      const error = new Error('ENOENT: file not found');
      const friendly = translateError(error, {
        filename: 'config.json',
      });

      expect(friendly.message).toContain('config.json');
    });

    test('extracts filename from error message if not in context', () => {
      const error = new Error('ENOENT: /path/to/myfile.txt not found');
      const friendly = translateError(error);

      expect(friendly.message).toContain('myfile.txt');
    });
  });

  describe('Security & Sanitization', () => {
    test('sanitizes user paths from messages', () => {
      const error = new Error('ENOENT: /Users/admin/secret/file.txt not found');
      const friendly = translateError(error);

      expect(friendly.message).not.toContain('/Users/admin');
      expect(friendly.message).not.toContain('secret');
      expect(friendly.message).toContain('file.txt');
    });

    test('sanitizes Windows paths', () => {
      const error = new Error('EACCES: C:\\Users\\John\\Documents\\file.txt');
      const friendly = translateError(error);

      expect(friendly.message).not.toContain('C:\\Users\\John');
      expect(friendly.message).toContain('file.txt');
    });

    test('sanitizes stack traces in production', () => {
      const error = new Error('Failed');
      error.stack = 'Error: Failed\n  at /Users/john/app/secret.ts:42\n  at /Users/john/.config/something:10';

      const friendly = translateError(error, {
        environment: 'production',
      });

      expect(friendly.technicalMessage).not.toContain('/Users/john');
      expect(friendly.technicalMessage).not.toContain('secret.ts');
    });

    test('preserves stack traces in development', () => {
      const error = new Error('Failed');
      error.stack = 'Error: Failed\n  at /app/file.ts:42';

      const friendly = translateError(error, {
        environment: 'development',
      });

      expect(friendly.technicalMessage).toContain('file.ts:42');
    });

    test('removes sensitive data patterns from messages', () => {
      const error = new Error('Auth failed: token=abc123secret, password=hunter2');
      const friendly = translateError(error);

      expect(friendly.technicalMessage).not.toContain('abc123secret');
      expect(friendly.technicalMessage).not.toContain('hunter2');
      expect(friendly.technicalMessage).toContain('[REDACTED]');
    });
  });

  describe('Path Sanitization Utility', () => {
    test('extracts basename from Unix path', () => {
      expect(sanitizePath('/Users/admin/Documents/file.txt')).toBe('file.txt');
    });

    test('extracts basename from Windows path', () => {
      expect(sanitizePath('C:\\Users\\Admin\\Documents\\file.txt')).toBe('file.txt');
    });

    test('handles relative paths', () => {
      expect(sanitizePath('../config/file.json')).toBe('file.json');
    });

    test('handles paths with no directory', () => {
      expect(sanitizePath('file.txt')).toBe('file.txt');
    });

    test('handles empty string', () => {
      expect(sanitizePath('')).toBe('');
    });
  });

  describe('Stack Trace Sanitization', () => {
    test('removes user paths from stack trace', () => {
      const stack = `Error: Failed
  at Object.<anonymous> (/Users/john/project/src/file.ts:42:10)
  at Module._compile (node:internal/modules:123:5)`;

      const sanitized = sanitizeStackTrace(stack);

      expect(sanitized).not.toContain('/Users/john');
      expect(sanitized).toContain('file.ts:42:10');
    });

    test('preserves error message in stack trace', () => {
      const stack = 'Error: Something failed\n  at somewhere:123';
      const sanitized = sanitizeStackTrace(stack);

      expect(sanitized).toContain('Something failed');
    });

    test('handles stack with no paths', () => {
      const stack = 'Error: Failed\n  at anonymous';
      const sanitized = sanitizeStackTrace(stack);

      expect(sanitized).toBe(stack);
    });
  });

  describe('Edge Cases', () => {
    test('handles null error gracefully', () => {
      const friendly = translateError(null as any);

      expect(friendly.title).toBe('An Error Occurred');
      expect(friendly.category).toBe(ErrorCategory.SYSTEM);
    });

    test('handles undefined error gracefully', () => {
      const friendly = translateError(undefined as any);

      expect(friendly.title).toBe('An Error Occurred');
    });

    test('handles error with no message', () => {
      const error = new Error();
      const friendly = translateError(error);

      expect(friendly.title).toBeTruthy();
      expect(friendly.message).toBeTruthy();
    });

    test('handles error with circular references', () => {
      const error: any = new Error('Circular');
      error.self = error;
      error.nested = { ref: error };

      expect(() => translateError(error)).not.toThrow();
    });

    test('handles very long error messages', () => {
      const longMessage = 'ECONNREFUSED: ' + 'connection details: '.repeat(100);
      const error = new Error(longMessage);
      const friendly = translateError(error);

      expect(friendly.message.length).toBeLessThan(1000);
      expect(friendly.technicalMessage.length).toBeLessThan(2000);
      // Technical message should be truncated if too long
      if (longMessage.length > 1000) {
        expect(friendly.technicalMessage).toContain('...');
      }
    });

    test('handles error with undefined properties', () => {
      const error: any = new Error('Test');
      error.code = undefined;
      error.category = undefined;

      expect(() => translateError(error)).not.toThrow();
    });
  });

  describe('Translation Options', () => {
    test('respects showDetails flag', () => {
      const error = new Error('Test error');
      const friendly = translateError(error, { showDetails: false });

      expect(friendly.showDetails).toBe(false);
    });

    test('defaults showDetails to true for unknown errors', () => {
      const error = new Error('Unknown bizarre error');
      const friendly = translateError(error);

      expect(friendly.showDetails).toBe(true);
    });

    test('applies custom severity override', () => {
      const error = new Error('ECONNREFUSED');
      const friendly = translateError(error, {
        severityOverride: ErrorSeverity.CRITICAL,
      });

      expect(friendly.severity).toBe(ErrorSeverity.CRITICAL);
    });
  });

  describe('Performance', () => {
    test('translation completes in <5ms', () => {
      const error = new Error('ECONNREFUSED: connection failed');

      const start = performance.now();
      translateError(error);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(5);
    });

    test('batch translation of 100 errors completes in <100ms', () => {
      const errors = Array(100)
        .fill(null)
        .map((_, i) => new Error(`Error ${i}: ECONNREFUSED`));

      const start = performance.now();
      errors.forEach((err) => translateError(err));
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });
});
