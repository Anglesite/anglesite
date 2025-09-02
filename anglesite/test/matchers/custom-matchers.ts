/**
 * @file Custom Jest matchers for Anglesite tests
 *
 * These matchers reduce repetitive assertion patterns across the test suite
 * and provide more descriptive error messages for common test scenarios.
 */

import type { MockCall, WindowMock, WindowState, InputHandler } from '../types/matcher-types';
import { INVALID_INPUTS as invalidInputs, isString, isFunction } from '../types/matcher-types';

declare global {
  namespace jest {
    interface Matchers<R> {
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
      toHaveWindowState(state: WindowState): R;

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

/**
 * Custom matcher: toCreateWindowSuccessfully.
 * Verifies that a function creates a window without throwing and returns a defined result.
 */
expect.extend({
  toCreateWindowSuccessfully(received: () => unknown) {
    let result: unknown;
    let error: Error | undefined;

    try {
      result = received();
    } catch (e) {
      error = e as Error;
    }

    const pass = !error && result !== undefined && result !== null;

    return {
      pass,
      message: () => {
        if (error) {
          return `Expected function to create window successfully, but it threw: ${error.message}`;
        }
        if (result === undefined || result === null) {
          return `Expected function to create window successfully, but it returned ${result}`;
        }
        return `Expected function not to create window successfully`;
      },
    };
  },

  /**
   * Custom matcher: toEmitEventSynchronously.
   * Verifies that a mock function triggers an event handler synchronously.
   */
  toEmitEventSynchronously(received: jest.Mock, eventName: string) {
    const mockCalls = received.mock.calls as MockCall[];
    const eventHandler = mockCalls.find((call) => call[0] === eventName);

    const pass = eventHandler !== undefined && isFunction(eventHandler[1]);

    return {
      pass,
      message: () => {
        if (!eventHandler) {
          return `Expected to emit "${eventName}" event, but no handler was registered`;
        }
        if (typeof eventHandler[1] !== 'function') {
          return `Expected to emit "${eventName}" event with a function handler, but got ${typeof eventHandler[1]}`;
        }
        return `Expected not to emit "${eventName}" event synchronously`;
      },
    };
  },

  /**
   * Custom matcher: toExecuteWithoutError.
   * Verifies that a function executes without throwing.
   */
  toExecuteWithoutError(received: () => unknown) {
    let error: Error | undefined;

    try {
      received();
    } catch (e) {
      error = e as Error;
    }

    const pass = !error;

    return {
      pass,
      message: () => {
        if (error) {
          return `Expected function to execute without error, but it threw: ${error.message}`;
        }
        return `Expected function to throw an error`;
      },
    };
  },

  /**
   * Custom matcher: toBeCalledWithPath.
   * Verifies that a mock was called with a path containing the expected string.
   */
  toBeCalledWithPath(received: jest.Mock, expectedPath: string) {
    const calls = received.mock.calls as MockCall[];
    const pathCall = calls.find((call) => call.some((arg) => isString(arg) && arg.includes(expectedPath)));

    const pass = pathCall !== undefined;

    return {
      pass,
      message: () => {
        if (!pathCall) {
          const actualPaths = calls
            .flat()
            .filter((arg) => isString(arg) && arg.includes('/'))
            .join(', ');
          return `Expected to be called with path containing "${expectedPath}"${actualPaths ? `, but was called with: ${actualPaths}` : ', but no paths were found'}`;
        }
        return `Expected not to be called with path containing "${expectedPath}"`;
      },
    };
  },

  /**
   * Custom matcher: toHaveWindowState.
   * Verifies that a window mock has specific state properties.
   */
  toHaveWindowState(received: WindowMock, expectedState: WindowState) {
    const actualState: WindowState = {};
    let mismatches: string[] = [];

    if (expectedState.destroyed !== undefined) {
      actualState.destroyed = received.isDestroyed?.() ?? false;
      if (actualState.destroyed !== expectedState.destroyed) {
        mismatches.push(`destroyed: expected ${expectedState.destroyed}, got ${actualState.destroyed}`);
      }
    }

    if (expectedState.maximized !== undefined) {
      actualState.maximized = received.isMaximized?.() ?? false;
      if (actualState.maximized !== expectedState.maximized) {
        mismatches.push(`maximized: expected ${expectedState.maximized}, got ${actualState.maximized}`);
      }
    }

    if (expectedState.focused !== undefined) {
      actualState.focused = received.isFocused?.() ?? false;
      if (actualState.focused !== expectedState.focused) {
        mismatches.push(`focused: expected ${expectedState.focused}, got ${actualState.focused}`);
      }
    }

    if (expectedState.title !== undefined) {
      actualState.title = received.getTitle?.() ?? '';
      if (actualState.title !== expectedState.title) {
        mismatches.push(`title: expected "${expectedState.title}", got "${actualState.title}"`);
      }
    }

    const pass = mismatches.length === 0;

    return {
      pass,
      message: () => {
        if (mismatches.length > 0) {
          return `Expected window to have state:\n${mismatches.join('\n')}`;
        }
        return `Expected window not to have state: ${JSON.stringify(expectedState)}`;
      },
    };
  },

  /**
   * Custom matcher: toHandleIpcChannel.
   * Verifies that an IPC handler was registered for a specific channel.
   */
  toHandleIpcChannel(received: jest.Mock, channel: string) {
    const calls = received.mock.calls as MockCall[];
    const channelHandler = calls.find((call) => call[0] === channel);

    const pass = channelHandler !== undefined;

    return {
      pass,
      message: () => {
        if (!channelHandler) {
          const registeredChannels = calls
            .map((call) => call[0])
            .filter(Boolean)
            .join(', ');
          return `Expected to handle IPC channel "${channel}"${registeredChannels ? `, but only handles: ${registeredChannels}` : ', but no channels are handled'}`;
        }
        return `Expected not to handle IPC channel "${channel}"`;
      },
    };
  },

  /**
   * Custom matcher: toResolveSuccessfully.
   * Verifies that a promise resolves without rejection.
   */
  async toResolveSuccessfully(received: Promise<unknown>) {
    let resolved = false;
    let rejected = false;
    let error: Error | undefined;

    try {
      await received;
      resolved = true;
    } catch (e) {
      rejected = true;
      error = e as Error;
    }

    const pass = resolved && !rejected;

    return {
      pass,
      message: () => {
        if (rejected) {
          return `Expected promise to resolve successfully, but it rejected with: ${error?.message}`;
        }
        return `Expected promise to reject`;
      },
    };
  },

  /**
   * Custom matcher: toHandleInvalidInputGracefully.
   * Verifies that a function handles various invalid inputs without throwing.
   */
  toHandleInvalidInputGracefully(received: InputHandler) {
    const failures: Array<{ input: unknown; error: Error }> = [];

    for (const input of invalidInputs) {
      try {
        received(input);
      } catch (e) {
        failures.push({ input, error: e as Error });
      }
    }

    const pass = failures.length === 0;

    return {
      pass,
      message: () => {
        if (failures.length > 0) {
          const failureMessages = failures
            .map((f) => `  Input ${JSON.stringify(f.input)}: ${f.error.message}`)
            .join('\n');
          return `Expected function to handle invalid inputs gracefully, but it threw for:\n${failureMessages}`;
        }
        return `Expected function to throw for invalid inputs`;
      },
    };
  },
});

export {}; // Ensure this is a module
