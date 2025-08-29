/**
 * @file Test utilities for logging verification and mocking
 * Provides consistent patterns for testing secure logging functionality
 */

import { logger, LogLevel } from '../../app/utils/logging';

/**
 * LoggingTestHelper provides utilities for testing logging functionality
 * without coupling tests to specific log message formats
 */
export class LoggingTestHelper {
  private consoleErrorSpy: jest.SpyInstance;
  private consoleWarnSpy: jest.SpyInstance;
  private consoleLogSpy: jest.SpyInstance;

  constructor() {
    this.consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    this.consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    this.consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  }

  /**
   * Verify that an error was logged with specific content
   */
  expectErrorLogged(partialMessage: string, context?: Record<string, unknown>): void {
    const errorCalls = this.consoleErrorSpy.mock.calls;
    const found = errorCalls.some((call) => {
      const logMessage = call[0] as string;
      const hasMessage = logMessage.includes(partialMessage);

      if (!context) return hasMessage;

      // If context is provided, check that key context values are present
      const contextMatches = Object.entries(context).every(([key, expectedValue]) => {
        if (typeof expectedValue === 'string') {
          return logMessage.includes(expectedValue);
        }
        return true; // For non-string values, we just check the message
      });

      return hasMessage && contextMatches;
    });

    if (!found) {
      const allCalls = errorCalls.map((call) => call[0]).join('\n');
      throw new Error(`Expected error log containing "${partialMessage}" but got:\n${allCalls}`);
    }
  }

  /**
   * Verify that a warning was logged with specific content
   */
  expectWarningLogged(partialMessage: string): void {
    const warnCalls = this.consoleWarnSpy.mock.calls;
    const found = warnCalls.some((call) => {
      const logMessage = call[0] as string;
      return logMessage.includes(partialMessage);
    });

    if (!found) {
      const allCalls = warnCalls.map((call) => call[0]).join('\n');
      throw new Error(`Expected warning log containing "${partialMessage}" but got:\n${allCalls}`);
    }
  }

  /**
   * Verify that an info log was made
   */
  expectInfoLogged(partialMessage: string): void {
    const logCalls = this.consoleLogSpy.mock.calls;
    const found = logCalls.some((call) => {
      const logMessage = call[0] as string;
      return logMessage.includes(partialMessage);
    });

    if (!found) {
      const allCalls = logCalls.map((call) => call[0]).join('\n');
      throw new Error(`Expected info log containing "${partialMessage}" but got:\n${allCalls}`);
    }
  }

  /**
   * Verify that no logs were made (useful for testing silent operations)
   */
  expectNoLogs(): void {
    expect(this.consoleErrorSpy).not.toHaveBeenCalled();
    expect(this.consoleWarnSpy).not.toHaveBeenCalled();
    expect(this.consoleLogSpy).not.toHaveBeenCalled();
  }

  /**
   * Get the number of error logs made
   */
  getErrorLogCount(): number {
    return this.consoleErrorSpy.mock.calls.length;
  }

  /**
   * Get all error log messages for debugging
   */
  getAllErrorLogs(): string[] {
    return this.consoleErrorSpy.mock.calls.map((call) => call[0] as string);
  }

  /**
   * Clear all spy call history
   */
  clearLogs(): void {
    this.consoleErrorSpy.mockClear();
    this.consoleWarnSpy.mockClear();
    this.consoleLogSpy.mockClear();
  }

  /**
   * Restore original console methods
   */
  restore(): void {
    this.consoleErrorSpy.mockRestore();
    this.consoleWarnSpy.mockRestore();
    this.consoleLogSpy.mockRestore();
  }
}

/**
 * Mock the logger for testing with controllable behavior
 */
export class LoggerMock {
  public error = jest.fn();
  public warn = jest.fn();
  public info = jest.fn();
  public debug = jest.fn();

  /**
   * Verify that an error was logged with specific message pattern
   */
  expectError(messagePattern: string | RegExp, context?: Record<string, unknown>): void {
    const errorCalls = this.error.mock.calls;
    const found = errorCalls.some((call) => {
      const [message, callContext] = call;
      const messageMatches =
        typeof messagePattern === 'string' ? message.includes(messagePattern) : messagePattern.test(message);

      if (!context) return messageMatches;

      const contextMatches = Object.entries(context).every(([key, expectedValue]) => {
        return callContext && callContext[key] === expectedValue;
      });

      return messageMatches && contextMatches;
    });

    if (!found) {
      const allCalls = errorCalls.map((call) => `${call[0]} | ${JSON.stringify(call[1])}`).join('\n');
      throw new Error(`Expected error with pattern "${messagePattern}" but got:\n${allCalls}`);
    }
  }

  /**
   * Clear all mock call history
   */
  clear(): void {
    this.error.mockClear();
    this.warn.mockClear();
    this.info.mockClear();
    this.debug.mockClear();
  }
}

/**
 * Create a logging test helper for use in test suites
 */
export function createLoggingTestHelper(): LoggingTestHelper {
  return new LoggingTestHelper();
}

/**
 * Create a mock logger for dependency injection in tests
 */
export function createLoggerMock(): LoggerMock {
  return new LoggerMock();
}

/**
 * Test pattern for verifying build error logging regardless of format changes
 */
export const buildErrorPatterns = {
  buildFailed: (websiteName: string) => `Build failed for ${websiteName}`,
  rebuildFailed: (websiteName: string) => `Rebuild failed for ${websiteName}`,
  serverStartFailed: (websiteName: string) => `Failed to start server for ${websiteName}`,
  originalError: (websiteName: string) => `Original build error for ${websiteName}`,
  errorCause: (websiteName: string) => `Build error cause for ${websiteName}`,
  watcherCloseFailed: (port: number) => `Error closing file watcher for port ${port}`,
  serverCloseFailed: (port: number) => `Error closing dev server for port ${port}`,
  directoryCleanupFailed: () => `Failed to clean up directory`,
  serverStopFailed: (port: number) => `Error stopping server for port ${port}`,
};
