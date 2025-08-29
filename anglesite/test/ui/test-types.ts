/**
 * @file Type definitions for test mocks
 * Provides proper types for mock objects to avoid using 'any'
 */

import { BrowserWindow } from 'electron';

/**
 * Type for mock window objects in tests
 */
export type MockWindow = Pick<BrowserWindow, 'isDestroyed' | 'webContents'> & {
  webContents: {
    send: jest.Mock;
    isLoading: jest.Mock;
    executeJavaScript: jest.Mock;
    once: jest.Mock;
  };
};

/**
 * Type for partial mock windows
 */
export type PartialMockWindow = {
  isDestroyed: () => boolean;
  webContents?: {
    send?: jest.Mock;
    isLoading?: jest.Mock;
    executeJavaScript?: jest.Mock;
    once?: jest.Mock;
  } | null;
};

/**
 * Type-safe casting for mock windows.
 */
export function asMockWindow(
  window: PartialMockWindow
): Parameters<typeof BrowserWindow.getAllWindows>[0] extends readonly unknown[] ? never : never {
  return window as never;
}

/**
 * Type for mock store
 */
export interface MockStore {
  get: jest.Mock;
  set: jest.Mock;
}

/**
 * Type for mock native theme
 */
export interface MockNativeTheme {
  shouldUseDarkColors: boolean;
  themeSource: string;
  on: jest.Mock;
}
