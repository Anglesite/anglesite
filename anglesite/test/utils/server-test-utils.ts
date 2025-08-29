/**
 * @file Test utilities for server testing with consistent mocking patterns
 */

import { LoggerMock } from './logging-test-utils';

/**
 * Mock setup for per-website server tests
 */
export class ServerTestSetup {
  public mockFs: jest.Mocked<typeof import('fs')>;
  public mockPath: jest.Mocked<typeof import('path')>;
  public mockEleventy: jest.MockedFunction<any>;
  public mockEleventyDevServer: jest.MockedFunction<any>;
  public mockEleventyUrlResolver: jest.MockedClass<any>;
  public mockMultiWindowManager: { sendLogToWebsite: jest.MockedFunction<any> };
  public loggerMock: LoggerMock;

  constructor() {
    // Setup all mocks
    this.setupFsMocks();
    this.setupPathMocks();
    this.setupEleventyMocks();
    this.setupMultiWindowManagerMocks();
    this.setupLoggerMock();
  }

  private setupFsMocks(): void {
    const fs = require('fs');
    this.mockFs = fs as jest.Mocked<typeof import('fs')>;
    this.mockFs.existsSync.mockReturnValue(true);
    this.mockFs.mkdirSync.mockImplementation();
    this.mockFs.rmSync.mockImplementation();
  }

  private setupPathMocks(): void {
    const path = require('path');
    this.mockPath = path as jest.Mocked<typeof import('path')>;
    this.mockPath.join.mockImplementation((...args) => args.join('/'));
    this.mockPath.resolve.mockImplementation((...args) => '/' + args.join('/'));
  }

  private setupEleventyMocks(): void {
    // Mock Eleventy constructor
    this.mockEleventy = jest.fn().mockImplementation(() => ({
      write: jest.fn().mockResolvedValue(undefined),
      setConfigPathOverride: jest.fn(),
      setRunMode: jest.fn(),
    }));

    // Mock EleventyDevServer constructor
    this.mockEleventyDevServer = jest.fn().mockImplementation(() => ({
      serve: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      watcher: {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      },
      watchFiles: jest.fn(),
    }));
  }

  private setupMultiWindowManagerMocks(): void {
    this.mockMultiWindowManager = {
      sendLogToWebsite: jest.fn(),
    };

    // Mock the dynamic import
    jest.doMock('../../app/ui/multi-window-manager', () => this.mockMultiWindowManager, { virtual: true });
  }

  private setupLoggerMock(): void {
    this.loggerMock = new LoggerMock();

    // Mock the logger import
    jest.doMock(
      '../../app/utils/logging',
      () => ({
        logger: this.loggerMock,
        sanitize: {
          path: jest.fn((path: string) => `[sanitized]${path}`),
          error: jest.fn((error: unknown) => `[sanitized]${String(error)}`),
          message: jest.fn((msg: string) => `[sanitized]${msg}`),
        },
        LogLevel: {
          ERROR: 'error',
          WARN: 'warn',
          INFO: 'info',
          DEBUG: 'debug',
        },
      }),
      { virtual: true }
    );
  }

  /**
   * Create a mock Eleventy instance with configurable behavior
   */
  createEleventyInstance(
    options: {
      writeError?: Error;
      writeDelay?: number;
    } = {}
  ): any {
    const writeImpl = options.writeError
      ? jest.fn().mockRejectedValue(options.writeError)
      : options.writeDelay
        ? jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, options.writeDelay)))
        : jest.fn().mockResolvedValue(undefined);

    const instance = {
      write: writeImpl,
      setConfigPathOverride: jest.fn(),
      setRunMode: jest.fn(),
    };

    this.mockEleventy.mockReturnValue(instance);
    return instance;
  }

  /**
   * Create a mock EleventyDevServer instance with configurable behavior
   */
  createDevServerInstance(
    options: {
      serverError?: Error;
      watcherError?: Error;
      port?: number;
    } = {}
  ): any {
    const instance = {
      serve: options.serverError ? jest.fn().mockRejectedValue(options.serverError) : jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      watcher: {
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'change' && options.watcherError) {
            setTimeout(() => callback('/test/file.md'), 100);
          }
        }),
        close: options.watcherError
          ? jest.fn().mockRejectedValue(options.watcherError)
          : jest.fn().mockResolvedValue(undefined),
      },
      watchFiles: jest.fn(),
    };

    this.mockEleventyDevServer.mockReturnValue(instance);
    return instance;
  }

  /**
   * Reset all mocks to clean state
   */
  resetAllMocks(): void {
    jest.clearAllMocks();
    this.loggerMock.clear();
  }

  /**
   * Verify standard server startup sequence
   */
  expectServerStartupSequence(websiteName: string): void {
    expect(this.mockMultiWindowManager.sendLogToWebsite).toHaveBeenCalledWith(
      websiteName,
      expect.stringContaining('Starting Eleventy server'),
      'startup'
    );

    expect(this.mockMultiWindowManager.sendLogToWebsite).toHaveBeenCalledWith(
      websiteName,
      expect.stringContaining('Building website files'),
      'info'
    );
  }

  /**
   * Verify standard server shutdown sequence
   */
  expectServerShutdownSequence(): void {
    // Add expectations for proper cleanup sequence
    // This will be extended based on the actual shutdown logic
  }
}

/**
 * Create a server test setup instance
 */
export function createServerTestSetup(): ServerTestSetup {
  return new ServerTestSetup();
}

/**
 * Common test data for server tests
 */
export const serverTestData = {
  validWebsiteName: 'test-site',
  validInputDir: '/test/website',
  validPort: 3000,
  buildError: new Error('Build failed'),
  networkError: new Error('EADDRINUSE: address already in use'),
  fileSystemError: new Error('ENOENT: no such file or directory'),
};
