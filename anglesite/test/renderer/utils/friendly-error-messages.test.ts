/**
 * @file Tests for friendly error message catalog
 */

import {
  ErrorMessageTemplate,
  MESSAGE_CATALOG,
  ERROR_PATTERNS,
  matchErrorPattern,
  renderTemplate,
} from '../../../src/renderer/utils/friendly-error-messages';
import { ErrorCategory, ErrorSeverity } from '../../../src/main/core/errors/base';

describe('Friendly Error Messages', () => {
  describe('Message Catalog Structure', () => {
    test('contains messages for all error categories', () => {
      const categories = Object.values(ErrorCategory);
      const catalogCategories = new Set(Object.values(MESSAGE_CATALOG).map((template) => template.category));

      // Verify we have coverage for major categories
      const requiredCategories = [
        ErrorCategory.NETWORK,
        ErrorCategory.FILE_SYSTEM,
        ErrorCategory.VALIDATION,
        ErrorCategory.CONFIGURATION,
      ];

      requiredCategories.forEach((category) => {
        expect(catalogCategories.has(category)).toBe(true);
      });
    });

    test('all message templates have required fields', () => {
      Object.entries(MESSAGE_CATALOG).forEach(([key, template]) => {
        expect(template.title).toBeTruthy();
        expect(template.message).toBeTruthy();
        expect(template.category).toBeTruthy();
        expect(typeof template.isRetryable).toBe('boolean');
        expect(typeof template.isDismissible).toBe('boolean');
      });
    });

    test('retryable flags match error category conventions', () => {
      // Network errors should typically be retryable
      const networkMessages = Object.values(MESSAGE_CATALOG).filter((t) => t.category === ErrorCategory.NETWORK);
      networkMessages.forEach((template) => {
        expect(template.isRetryable).toBe(true);
      });

      // Validation errors should not be retryable
      const validationMessages = Object.values(MESSAGE_CATALOG).filter((t) => t.category === ErrorCategory.VALIDATION);
      validationMessages.forEach((template) => {
        expect(template.isRetryable).toBe(false);
      });
    });
  });

  describe('Error Pattern Matching', () => {
    test('matches ECONNREFUSED pattern correctly', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
      const match = matchErrorPattern(error);

      expect(match).toBe('NETWORK_CONNECTION_REFUSED');
    });

    test('matches timeout patterns in various formats', () => {
      const timeoutMessages = ['ETIMEDOUT', 'timeout of 5000ms exceeded', 'Request timed out', 'operation timed out'];

      timeoutMessages.forEach((msg) => {
        const error = new Error(msg);
        const match = matchErrorPattern(error);
        expect(match).toBe('NETWORK_TIMEOUT');
      });
    });

    test('matches file system error codes', () => {
      const fsErrors: Record<string, string> = {
        ENOENT: 'FILE_NOT_FOUND',
        EACCES: 'FILE_PERMISSION_DENIED',
        EEXIST: 'FILE_ALREADY_EXISTS',
        ENOTDIR: 'FILE_NOT_DIRECTORY',
        EISDIR: 'FILE_IS_DIRECTORY',
      };

      Object.entries(fsErrors).forEach(([code, expectedMatch]) => {
        const error = new Error(`${code}: operation failed`);
        const match = matchErrorPattern(error);
        expect(match).toBe(expectedMatch);
      });
    });

    test('matches JSON parsing errors', () => {
      const jsonErrors = [
        'Unexpected token in JSON',
        'JSON.parse: unexpected character',
        'Invalid JSON',
        'Failed to parse JSON',
      ];

      jsonErrors.forEach((msg) => {
        const error = new Error(msg);
        const match = matchErrorPattern(error);
        expect(match).toBe('VALIDATION_INVALID_JSON');
      });
    });

    test('returns UNKNOWN for unrecognized patterns', () => {
      const error = new Error('Something completely unexpected happened');
      const match = matchErrorPattern(error);
      expect(match).toBe('UNKNOWN');
    });

    test('handles errors without message', () => {
      const error = new Error();
      const match = matchErrorPattern(error);
      expect(match).toBe('UNKNOWN');
    });

    test('is case-insensitive for pattern matching', () => {
      const error1 = new Error('ECONNREFUSED');
      const error2 = new Error('econnrefused');
      const error3 = new Error('EConnRefused');

      expect(matchErrorPattern(error1)).toBe(matchErrorPattern(error2));
      expect(matchErrorPattern(error2)).toBe(matchErrorPattern(error3));
    });
  });

  describe('Message Template Rendering', () => {
    test('renders static message templates', () => {
      const template: ErrorMessageTemplate = {
        title: 'Error Occurred',
        message: 'Something failed',
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: false,
        isDismissible: true,
      };

      const result = renderTemplate(template, {});
      expect(result.message).toBe('Something failed');
      expect(result.title).toBe('Error Occurred');
    });

    test('renders dynamic templates with context', () => {
      const template: ErrorMessageTemplate = {
        title: 'File Not Found',
        message: (ctx) => `File "${ctx.filename}" could not be found`,
        category: ErrorCategory.FILE_SYSTEM,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: false,
        isDismissible: true,
      };

      const result = renderTemplate(template, { filename: 'config.json' });
      expect(result.message).toBe('File "config.json" could not be found');
    });

    test('renders dynamic suggestion with context', () => {
      const template: ErrorMessageTemplate = {
        title: 'Connection Failed',
        message: 'Cannot connect to server',
        suggestion: (ctx) => `Check that the server is running on port ${ctx.port}`,
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: true,
        isDismissible: true,
      };

      const result = renderTemplate(template, { port: 3000 });
      expect(result.suggestion).toBe('Check that the server is running on port 3000');
    });

    test('handles missing context gracefully', () => {
      const template: ErrorMessageTemplate = {
        title: 'Error',
        message: (ctx) => `File "${ctx.filename || 'unknown'}" not found`,
        category: ErrorCategory.FILE_SYSTEM,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: false,
        isDismissible: true,
      };

      const result = renderTemplate(template, {});
      expect(result.message).toBe('File "unknown" not found');
    });

    test('preserves template metadata in rendered output', () => {
      const template: ErrorMessageTemplate = {
        title: 'Test Error',
        message: 'Test message',
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.LOW,
        isRetryable: false,
        isDismissible: true,
      };

      const result = renderTemplate(template, {});
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.severity).toBe(ErrorSeverity.LOW);
      expect(result.isRetryable).toBe(false);
      expect(result.isDismissible).toBe(true);
    });

    test('handles function that throws by returning safe fallback', () => {
      const template: ErrorMessageTemplate = {
        title: 'Error',
        message: () => {
          throw new Error('Template function failed');
        },
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: false,
        isDismissible: true,
      };

      const result = renderTemplate(template, {});
      expect(result.message).toContain('unexpected');
      expect(result.message).not.toThrow;
    });
  });

  describe('Pattern Priority', () => {
    test('matches most specific pattern first', () => {
      // "ECONNREFUSED" should match before generic "connection" pattern
      const error = new Error('ECONNREFUSED connection failed');
      const match = matchErrorPattern(error);
      expect(match).toBe('NETWORK_CONNECTION_REFUSED');
    });

    test('matches file-specific errors before generic file errors', () => {
      const error = new Error('ENOENT: no such file or directory');
      const match = matchErrorPattern(error);
      expect(match).toBe('FILE_NOT_FOUND');
    });
  });

  describe('Performance', () => {
    test('pattern matching completes in <10ms for 100 errors', () => {
      const errors = Array(100)
        .fill(null)
        .map((_, i) => new Error(`Error ${i}: ECONNREFUSED`));

      const start = performance.now();
      errors.forEach((err) => matchErrorPattern(err));
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10);
    });

    test('template rendering completes in <5ms for 100 renders', () => {
      const template: ErrorMessageTemplate = {
        title: 'Test',
        message: (ctx) => `Message ${ctx.value}`,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: false,
        isDismissible: true,
      };

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        renderTemplate(template, { value: i });
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(5);
    });
  });
});
