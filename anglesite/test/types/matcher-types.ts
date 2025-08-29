/**
 * @file Type definitions for custom Jest matchers
 * @module matcher-types
 * @description Provides comprehensive typing for mock objects and function signatures
 * used by custom Jest matchers in the Anglesite test suite. These types ensure
 * type safety when working with Electron window mocks and test utilities.
 */

/**
 * @typedef {unknown[]} MockCall
 * @description Type representing arguments passed to a mocked function call.
 * Used for asserting function invocations in Jest tests.
 */
export type MockCall = unknown[];

/**
 * @interface WindowMock
 * @description Mock object interface that simulates Electron BrowserWindow methods
 * for testing window management functionality without requiring actual Electron windows.
 */
export interface WindowMock {
  /** Mock for checking if window is destroyed */
  isDestroyed?: jest.Mock<boolean>;
  /** Mock for checking if window is maximized */
  isMaximized?: jest.Mock<boolean>;
  /** Mock for checking if window has focus */
  isFocused?: jest.Mock<boolean>;
  /** Mock for getting window title */
  getTitle?: jest.Mock<string>;
  /** Mock for focusing the window */
  focus?: jest.Mock;
  /** Mock for showing the window */
  show?: jest.Mock;
  /** Mock for closing the window */
  close?: jest.Mock;
  /** Mock for getting window bounds */
  getBounds?: jest.Mock;
  /** Mock for setting window bounds */
  setBounds?: jest.Mock;
  /** Mock for maximizing the window */
  maximize?: jest.Mock;
  /** Mock for adding event listeners */
  on?: jest.Mock;
  /** Mock for adding one-time event listeners */
  once?: jest.Mock;
  /** Mock for loading HTML files */
  loadFile?: jest.Mock;
  /** Mock for webContents API */
  webContents?: {
    /** Mock for sending IPC messages */
    send?: jest.Mock;
    /** Mock for checking loading state */
    isLoading?: jest.Mock;
    /** Mock for executing JavaScript in renderer */
    executeJavaScript?: jest.Mock;
    /** Mock for one-time event listeners on webContents */
    once?: jest.Mock;
  };
}

/**
 * Generic type for functions that handle various input types in tests.
 * @template T The input type
 * @param input The input value to handle
 * @returns The result of handling the input
 */
export type InputHandler<T = unknown> = (input: T) => unknown;

/**
 * @interface WindowState
 * @description Configuration object for asserting window state in tests.
 * Used to verify that windows are in expected states during test execution.
 */
export interface WindowState {
  /** Whether the window should be destroyed */
  destroyed?: boolean;
  /** Whether the window should be maximized */
  maximized?: boolean;
  /** Whether the window should have focus */
  focused?: boolean;
  /** Expected window title */
  title?: string;
}

/**
 * @constant {ReadonlyArray} INVALID_INPUTS
 * @description Array of invalid input values used for negative test cases.
 * These values test error handling and validation in functions.
 */
export const INVALID_INPUTS = [undefined, null, '', [], {}, 'non-existent', -1, NaN] as const;

/**
 * Type guard to check if a value is a string.
 * @param value The value to check
 * @returns True if the value is a string, false otherwise
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is a function.
 * @param value The value to check
 * @returns True if the value is a function, false otherwise
 */
export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}
