/**
 * @file TypeScript declarations for custom Jest matchers
 * @description Extends Jest's expect interface with our domain-specific matchers
 */

/// <reference types="@testing-library/jest-dom" />

declare global {
  namespace jest {
    interface Matchers<R> {
      // Matchers from custom-assertions.ts

      /**
       * Validates that the received value is a valid website configuration
       */
      toBeValidWebsiteConfig(): R;

      /**
       * Validates that the received string is a valid website name
       */
      toBeValidWebsiteName(): R;

      /**
       * Validates that the received string is a valid URL
       */
      toBeValidURL(): R;

      /**
       * Validates that the received string is valid JSON
       */
      toBeValidJSON(): R;

      /**
       * Validates that the received value is a valid collection item
       */
      toBeValidCollectionItem(): R;

      /**
       * Validates that the received string is valid XML
       */
      toBeValidXML(): R;

      /**
       * Validates that the received string is a valid file path
       */
      toBeValidFilePath(): R;

      /**
       * Validates that the received mock has called IPC with specific channel and args
       */
      toHaveCalledIPC(channel: string, ...args: unknown[]): R;

      /**
       * Validates that the received mock has called IPC channel specific number of times
       */
      toHaveCalledIPCTimes(channel: string, times: number): R;

      /**
       * Validates that the received object has valid RSL structure
       */
      toHaveValidRSLStructure(): R;

      /**
       * Validates that the received object has valid schema structure
       */
      toHaveValidSchemaStructure(): R;

      /**
       * Validates that the received array has valid file structure
       */
      toHaveValidFileStructure(): R;

      /**
       * Validates that the received object is a valid Electron display
       */
      toBeValidElectronDisplay(): R;

      /**
       * Validates that the received console mock has valid output
       */
      toHaveValidConsoleOutput(level: 'log' | 'error' | 'warn' | 'debug'): R;

      // Matchers from custom-matchers.ts

      /**
       * Assert that a function creates a window successfully without throwing
       */
      toCreateWindowSuccessfully(): R;

      /**
       * Assert that a mock Electron event was emitted synchronously
       */
      toEmitEventSynchronously(eventName: string): R;

      /**
       * Assert that a function executes without throwing
       */
      toExecuteWithoutError(): R;

      /**
       * Assert that a mock was called with a path containing the expected string
       */
      toBeCalledWithPath(expectedPath: string): R;

      /**
       * Assert that a window mock has specific state
       */
      toHaveWindowState(state: { destroyed?: boolean; maximized?: boolean; focused?: boolean; title?: string }): R;

      /**
       * Assert that IPC handler was registered for a channel
       */
      toHandleIpcChannel(channel: string): R;

      /**
       * Assert that a mock returned a successful promise
       */
      toResolveSuccessfully(): R;

      /**
       * Assert that a function handles missing/invalid input gracefully
       */
      toHandleInvalidInputGracefully(): R;
    }
  }
}

export {};
