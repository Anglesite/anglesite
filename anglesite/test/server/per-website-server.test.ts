/**
 * @file Tests for per-website server management
 */

import * as fs from 'fs';
import * as path from 'path';
import { startWebsiteServer, stopWebsiteServer, WebsiteServer } from '../../src/main/server/per-website-server';
import { EleventyUrlResolver } from '../../src/main/server/eleventy-url-resolver';
import { createLoggingTestHelper, buildErrorPatterns, LoggingTestHelper } from '../utils/logging-test-utils';

// Import app modules mock to ensure it's loaded
import '../mocks/app-modules';

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('@11ty/eleventy');
jest.mock('@11ty/eleventy-dev-server');
jest.mock('../../src/main/server/eleventy-url-resolver');
jest.mock('../../src/main/ui/multi-window-manager', () => ({
  sendLogToWebsite: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

// Mock Eleventy
jest.mock('@11ty/eleventy', () => {
  return jest.fn().mockImplementation(() => ({
    write: jest.fn(),
  }));
});

// Mock EleventyDevServer
jest.mock('@11ty/eleventy-dev-server', () => {
  return jest.fn().mockImplementation(() => ({
    serve: jest.fn(),
    watcher: {
      on: jest.fn(),
      close: jest.fn(),
    },
    watchFiles: jest.fn(),
    close: jest.fn(),
  }));
});

const mockEleventy = require('@11ty/eleventy');
const mockEleventyDevServer = require('@11ty/eleventy-dev-server');
const mockEleventyUrlResolver = EleventyUrlResolver as jest.MockedClass<typeof EleventyUrlResolver>;
// Enhanced file watcher module imported but not directly used in this test file
// const mockEnhancedFileWatcherModule = require('../../src/main/server/enhanced-file-watcher');

describe('Per-Website Server', () => {
  let originalConsole: typeof console;
  let loggingHelper: LoggingTestHelper;
  let mockMultiWindowManager: {
    sendLogToWebsite?: jest.MockedFunction<(websiteName: string, message: string, level?: string) => void>;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup logging helper
    loggingHelper = createLoggingTestHelper();

    // Store original console
    originalConsole = { ...console };

    // Setup default path mocks
    mockPath.join.mockImplementation((...args) => args.join('/'));

    // Setup multi-window-manager mock
    mockMultiWindowManager = require('../../src/main/ui/multi-window-manager');
    mockMultiWindowManager.sendLogToWebsite = jest.fn();

    // Mock URL resolver
    mockEleventyUrlResolver.prototype.initialize = jest.fn().mockResolvedValue(undefined);

    // Reset Eleventy mock
    mockEleventy.mockClear();
    mockEleventyDevServer.mockClear();
  });

  afterEach(() => {
    // Clean up test helpers
    loggingHelper.restore();

    // Restore console
    Object.assign(console, originalConsole);
  });

  describe('sendLogToWindow', () => {
    it('should handle missing sendLogToWebsite function', async () => {
      // Test by temporarily removing the function
      const originalFunction = mockMultiWindowManager.sendLogToWebsite;
      delete mockMultiWindowManager.sendLogToWebsite;

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      mockFs.existsSync.mockReturnValue(false);

      try {
        await startWebsiteServer('/test/path', 'test-site', 3000);
      } catch {
        // Expected to fail, we're testing the log function
      }

      // Restore the function
      if (originalFunction) {
        mockMultiWindowManager.sendLogToWebsite = originalFunction;
      }
      consoleSpy.mockRestore();
    });
  });

  describe('startWebsiteServer', () => {
    beforeEach(() => {
      // Setup successful path and directory mocks
      mockFs.existsSync.mockImplementation((filePath: fs.PathLike) => {
        const pathStr = String(filePath);
        if (pathStr.includes('_site')) return false; // output dir doesn't exist initially
        if (pathStr.includes('/src')) return true; // src directory exists
        return false;
      });

      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.rmSync.mockImplementation(() => {});

      // Mock successful Eleventy instance
      const mockEleventyInstance = {
        write: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      // Mock successful dev server
      const mockDevServerInstance = {
        serve: jest.fn(),
        watcher: {
          on: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        },
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventyDevServer.mockReturnValue(mockDevServerInstance);

      // Mock console methods
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should successfully start a website server', async () => {
      const server = await startWebsiteServer('/test/website', 'test-site', 3000);

      expect(server).toBeDefined();
      expect(server.eleventy).toBeDefined();
      expect(server.devServer).toBeDefined();
      expect(server.inputDir).toBe('/test/website/src');
      expect(server.outputDir).toBe('/test/website/_site');
      expect(server.port).toBe(3000);
      expect(server.urlResolver).toBeDefined();
      expect(server.restoreConsole).toBeDefined();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/test/website/_site', { recursive: true });
      expect(mockEleventy).toHaveBeenCalledWith('/test/website/src', '/test/website/_site', expect.any(Object));
    });

    it('should handle missing source directory', async () => {
      mockFs.existsSync.mockImplementation((filePath: fs.PathLike) => {
        const pathStr = String(filePath);
        if (pathStr.includes('/src')) return false; // src directory doesn't exist
        if (pathStr.includes('_site')) return false;
        return false;
      });

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toThrow(
        'Source directory does not exist: /test/website/src'
      );
    });

    it('should handle Eleventy build errors', async () => {
      const buildError = new Error('Build failed');
      const mockEleventyInstance = {
        write: jest.fn().mockRejectedValue(buildError),
        setConfigPathOverride: jest.fn(),
        setRunMode: jest.fn(),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toThrow('Build failed');

      // Verify: Proper error logging occurred (format-independent)
      loggingHelper.expectErrorLogged(buildErrorPatterns.buildFailed('test-site'));
    });

    it('should handle Eleventy build errors with stack trace', async () => {
      const buildError = new Error('Build failed');
      buildError.stack = 'Error: Build failed\n    at test line';

      const mockEleventyInstance = {
        write: jest.fn().mockRejectedValue(buildError),
        setConfigPathOverride: jest.fn(),
        setRunMode: jest.fn(),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toThrow('Build failed');

      // Verify: Error logging includes build failure
      loggingHelper.expectErrorLogged(buildErrorPatterns.buildFailed('test-site'));
    });

    it('should handle Eleventy build errors with originalError', async () => {
      const originalError = new Error('Original error');
      originalError.stack = 'Original stack trace';

      const buildError = new Error('Build failed') as Error & { originalError?: Error };
      buildError.originalError = originalError;

      const mockEleventyInstance = {
        write: jest.fn().mockRejectedValue(buildError),
        setConfigPathOverride: jest.fn(),
        setRunMode: jest.fn(),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toThrow('Build failed');

      // Verify: Both main and original errors are logged
      loggingHelper.expectErrorLogged(buildErrorPatterns.buildFailed('test-site'));
      loggingHelper.expectErrorLogged(buildErrorPatterns.originalError('test-site'));
    });

    it('should handle Eleventy build errors with cause', async () => {
      const cause = 'Root cause error';
      const buildError = new Error('Build failed') as Error & { cause?: string };
      buildError.cause = cause;

      const mockEleventyInstance = {
        write: jest.fn().mockRejectedValue(buildError),
        setConfigPathOverride: jest.fn(),
        setRunMode: jest.fn(),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toThrow('Build failed');

      // Verify: Build failure and cause are logged
      loggingHelper.expectErrorLogged(buildErrorPatterns.buildFailed('test-site'));
      loggingHelper.expectErrorLogged(buildErrorPatterns.errorCause('test-site'));
    });

    it('should handle non-Error build failures', async () => {
      const buildError = 'String error';
      const mockEleventyInstance = {
        write: jest.fn().mockRejectedValue(buildError),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toBe('String error');
    });

    it('should capture server URL from logger messages', async () => {
      let logCallback: (msg: string) => void = () => {};
      let infoCallback: (msg: string) => void = () => {};

      const mockDevServerInstance = {
        serve: jest.fn(() => {
          // Simulate the server immediately logging its URL
          setTimeout(() => {
            logCallback('Server at http://localhost:3001/');
          }, 50);
        }),
        watcher: {
          on: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        },
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };

      mockEleventyDevServer.mockImplementation(
        (
          name: string,
          outputDir: string,
          options: { logger: { log: (msg: string) => void; info: (msg: string) => void; error: (msg: string) => void } }
        ) => {
          logCallback = options.logger.log;
          infoCallback = options.logger.info;
          return mockDevServerInstance;
        }
      );

      const server = await startWebsiteServer('/test/website', 'test-site', 3000);

      // The server should have captured the URL from the mocked log message
      expect(server.actualUrl).toBe('http://localhost:3001');
      expect(server.port).toBe(3001);

      // Test info callback as well
      infoCallback('Server at http://localhost:3002/');
    });

    it('should handle file watcher events', async () => {
      let changeCallback: (path: string) => void = () => {};
      const mockEleventyInstance = {
        write: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      const mockDevServerInstance = {
        serve: jest.fn(),
        watcher: {
          on: jest.fn().mockImplementation((event: string, callback: (path: string) => void) => {
            if (event === 'change') {
              changeCallback = callback;
            }
          }),
          close: jest.fn().mockResolvedValue(undefined),
        },
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventyDevServer.mockReturnValue(mockDevServerInstance);

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Simulate file change
      await changeCallback('/test/website/src/index.html');

      expect(mockEleventyInstance.write).toHaveBeenCalledTimes(2); // Initial build + rebuild
    });

    it('should skip rebuilds for build directory changes', async () => {
      let changeCallback: (path: string) => void = () => {};
      const mockEleventyInstance = {
        write: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      const mockDevServerInstance = {
        serve: jest.fn(),
        watcher: {
          on: jest.fn().mockImplementation((event: string, callback: (path: string) => void) => {
            if (event === 'change') {
              changeCallback = callback;
            }
          }),
          close: jest.fn().mockResolvedValue(undefined),
        },
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventyDevServer.mockReturnValue(mockDevServerInstance);

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Simulate build directory change
      await changeCallback('/test/website/_site/index.html');

      expect(mockEleventyInstance.write).toHaveBeenCalledTimes(1); // Only initial build
    });

    it('should handle rebuild errors', async () => {
      let changeCallback: (path: string) => void = () => {};
      const rebuildError = new Error('Rebuild failed');
      const mockEleventyInstance = {
        write: jest
          .fn()
          .mockResolvedValueOnce(undefined) // Initial build succeeds
          .mockRejectedValueOnce(rebuildError), // Rebuild fails
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      const mockDevServerInstance = {
        serve: jest.fn(),
        watcher: {
          on: jest.fn().mockImplementation((event: string, callback: (path: string) => void) => {
            if (event === 'change') {
              changeCallback = callback;
            }
          }),
          close: jest.fn().mockResolvedValue(undefined),
        },
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventyDevServer.mockReturnValue(mockDevServerInstance);

      jest.spyOn(console, 'error').mockImplementation();

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Simulate file change that triggers failed rebuild
      await changeCallback('/test/website/src/index.html');

      // Verify: Rebuild failure is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.rebuildFailed('test-site'));
    });

    it('should handle non-Error rebuild failures', async () => {
      let changeCallback: (path: string) => void = () => {};
      const rebuildError = 'String rebuild error';
      const mockEleventyInstance = {
        write: jest
          .fn()
          .mockResolvedValueOnce(undefined) // Initial build succeeds
          .mockRejectedValueOnce(rebuildError), // Rebuild fails
      };
      mockEleventy.mockReturnValue(mockEleventyInstance);

      const mockDevServerInstance = {
        serve: jest.fn(),
        watcher: {
          on: jest.fn().mockImplementation((event: string, callback: (path: string) => void) => {
            if (event === 'change') {
              changeCallback = callback;
            }
          }),
          close: jest.fn().mockResolvedValue(undefined),
        },
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventyDevServer.mockReturnValue(mockDevServerInstance);

      jest.spyOn(console, 'error').mockImplementation();

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Simulate file change that triggers failed rebuild
      await changeCallback('/test/website/src/index.html');

      // Verify: Rebuild failure is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.rebuildFailed('test-site'));
    });

    it('should handle missing watcher', async () => {
      const mockDevServerInstance = {
        serve: jest.fn(),
        watcher: null, // No watcher
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockEleventyDevServer.mockReturnValue(mockDevServerInstance);

      // Should not throw an error
      const server = await startWebsiteServer('/test/website', 'test-site', 3000);
      expect(server).toBeDefined();
    });

    it('should handle console override for Eleventy logs', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log');
      const consoleErrorSpy = jest.spyOn(console, 'error');
      const consoleWarnSpy = jest.spyOn(console, 'warn');

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Test console.log override
      console.log('Test [11ty] message');
      console.log('Regular message');

      // Test console.error override
      console.error('Test Eleventy error');
      console.error('Regular error');

      // Test console.warn override
      console.warn('Test eleventy warning');
      console.warn('Regular warning');

      expect(consoleLogSpy).toHaveBeenCalledWith('Test [11ty] message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Test Eleventy error');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Test eleventy warning');
    });

    it('should handle general startup errors', async () => {
      // Mock fs.existsSync to throw an error
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      jest.spyOn(console, 'error').mockImplementation();

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toThrow('File system error');

      // Verify: Server startup failure is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.serverStartFailed('test-site'));
    });

    it('should handle non-Error startup failures', async () => {
      // Mock fs.existsSync to throw a string error
      mockFs.existsSync.mockImplementation(() => {
        throw 'String file system error';
      });

      jest.spyOn(console, 'error').mockImplementation();

      await expect(startWebsiteServer('/test/website', 'test-site', 3000)).rejects.toBe('String file system error');

      // Verify: Server startup failure is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.serverStartFailed('test-site'));
    });

    it('should restore console methods on startup errors', async () => {
      const originalLog = console.log;

      mockFs.existsSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      try {
        await startWebsiteServer('/test/website', 'test-site', 3000);
      } catch {
        // Expected to fail
      }

      expect(console.log).toBe(originalLog);
    });

    it('should call Eleventy configuration function', async () => {
      // Create a mock Eleventy config object to test the configuration function
      const mockEleventyConfig = {
        setFreezeReservedData: jest.fn(),
        addPlugin: jest.fn(),
        addGlobalData: jest.fn(),
      };

      // Mock the requires inside the config function
      jest.doMock('@dwk/anglesite-11ty', () => ({
        default: 'anglesite-plugin',
      }));

      let configFunction: ((config: unknown) => unknown) | undefined;

      mockEleventy.mockImplementation(
        (input: string, output: string, options: { config: (config: unknown) => unknown }) => {
          configFunction = options.config;
          return {
            write: jest.fn().mockResolvedValue(undefined),
          };
        }
      );

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Call the configuration function with our mock config
      expect(configFunction).toBeDefined();
      const result = configFunction!(mockEleventyConfig);

      expect(mockEleventyConfig.setFreezeReservedData).toHaveBeenCalledWith(false);
      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith('anglesite-plugin', {
        webComponents: '_includes/**/*.webc',
      });
      // WebC plugin should NOT be registered separately - it's handled by anglesite-11ty
      expect(mockEleventyConfig.addPlugin).not.toHaveBeenCalledWith('webc-plugin', expect.any(Object));
      expect(mockEleventyConfig.addGlobalData).toHaveBeenCalledWith('eleventy', expect.any(Function));

      expect(result).toEqual({
        templateFormats: ['11ty.js', 'webc', 'md', 'html'],
        markdownTemplateEngine: 'webc',
        htmlTemplateEngine: 'webc',
        dir: {
          input: '.',
          output: '../_site',
          includes: '_includes',
          layouts: '_includes',
        },
      });
    });

    it('should configure WebC plugin through anglesite-11ty to prevent conflicts', async () => {
      // Create a mock Eleventy config object to test WebC configuration
      const mockEleventyConfig = {
        setFreezeReservedData: jest.fn(),
        addPlugin: jest.fn(),
        addGlobalData: jest.fn(),
      };

      // Mock the anglesite-11ty plugin
      jest.doMock('@dwk/anglesite-11ty', () => ({
        default: jest.fn(),
      }));

      let configFunction: ((config: unknown) => unknown) | undefined;

      mockEleventy.mockImplementation(
        (input: string, output: string, options: { config: (config: unknown) => unknown }) => {
          configFunction = options.config;
          return {
            write: jest.fn().mockResolvedValue(undefined),
          };
        }
      );

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Call the configuration function with our mock config
      expect(configFunction).toBeDefined();
      configFunction!(mockEleventyConfig);

      // Verify anglesite-11ty plugin is called with WebC configuration
      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        'anglesite-plugin', // The mock string being used
        expect.objectContaining({
          webComponents: '_includes/**/*.webc',
        })
      );

      // Verify WebC plugin is NOT registered directly
      const pluginCalls = mockEleventyConfig.addPlugin.mock.calls;
      const webCDirectCall = pluginCalls.find(
        (call) => call[0] && typeof call[0] === 'string' && call[0].includes('webc')
      );
      expect(webCDirectCall).toBeUndefined();

      // Should only be called once for anglesite-11ty (not separately for WebC)
      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledTimes(1);
    });

    it('should test global data function in Eleventy config', async () => {
      const originalEnv = process.env.ELEVENTY_VERSION;

      let configFunction: ((config: unknown) => unknown) | undefined;
      let globalDataFunction: (() => { generator: string }) | undefined;

      const mockEleventyConfig = {
        setFreezeReservedData: jest.fn(),
        addPlugin: jest.fn(),
        addGlobalData: jest.fn().mockImplementation((key: string, fn: () => { generator: string }) => {
          if (key === 'eleventy') {
            globalDataFunction = fn;
          }
        }),
      };

      mockEleventy.mockImplementation(
        (input: string, output: string, options: { config: (config: unknown) => unknown }) => {
          configFunction = options.config;
          return {
            write: jest.fn().mockResolvedValue(undefined),
          };
        }
      );

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Call the configuration function
      expect(configFunction).toBeDefined();
      configFunction!(mockEleventyConfig);

      // Test with ELEVENTY_VERSION set
      process.env.ELEVENTY_VERSION = '2.0.0';
      expect(globalDataFunction).toBeDefined();
      expect(globalDataFunction!()).toEqual({
        generator: 'Eleventy v2.0.0',
      });

      // Test without ELEVENTY_VERSION
      delete process.env.ELEVENTY_VERSION;
      expect(globalDataFunction!()).toEqual({
        generator: 'Eleventy',
      });

      // Restore original env
      if (originalEnv) {
        process.env.ELEVENTY_VERSION = originalEnv;
      }
    });

    it('should handle error logger callback', async () => {
      let errorCallback: (msg: string) => void = () => {};

      const mockDevServerInstance = {
        serve: jest.fn(),
        watcher: {
          on: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        },
        watchFiles: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };

      mockEleventyDevServer.mockImplementation(
        (
          name: string,
          outputDir: string,
          options: { logger: { log: (msg: string) => void; info: (msg: string) => void; error: (msg: string) => void } }
        ) => {
          errorCallback = options.logger.error;
          return mockDevServerInstance;
        }
      );

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await startWebsiteServer('/test/website', 'test-site', 3000);

      // Test the error callback
      errorCallback('Test error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith('[test-site] Test error message');
    });
  });

  describe('stopWebsiteServer', () => {
    let mockServer: WebsiteServer;

    beforeEach(() => {
      mockServer = {
        eleventy: {},
        devServer: {
          watcher: {
            close: jest.fn().mockResolvedValue(undefined),
          },
          close: jest.fn().mockResolvedValue(undefined),
        },
        inputDir: '/test/src',
        outputDir: '/test/_site',
        port: 3000,
        actualUrl: 'http://localhost:3000',
        urlResolver: {} as EleventyUrlResolver,
        restoreConsole: jest.fn(),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.rmSync.mockImplementation(() => {});
    });

    it('should successfully stop a website server', async () => {
      await stopWebsiteServer(mockServer);

      expect(mockServer.restoreConsole).toHaveBeenCalled();
      expect(mockServer.devServer.watcher.close).toHaveBeenCalled();
      expect(mockServer.devServer.close).toHaveBeenCalled();
      expect(mockFs.rmSync).toHaveBeenCalledWith('/test/_site', { recursive: true, force: true });
    });

    it('should handle missing restoreConsole function', async () => {
      mockServer.restoreConsole = undefined;

      await expect(stopWebsiteServer(mockServer)).resolves.not.toThrow();
    });

    it('should handle missing watcher', async () => {
      mockServer.devServer.watcher = null;

      await expect(stopWebsiteServer(mockServer)).resolves.not.toThrow();
    });

    it('should handle watcher close errors', async () => {
      const watcherError = new Error('Watcher close failed');
      mockServer.devServer.watcher.close.mockRejectedValue(watcherError);

      jest.spyOn(console, 'error').mockImplementation();

      await stopWebsiteServer(mockServer);

      // Verify: Watcher close error is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.watcherCloseFailed(3000));
    });

    it('should handle missing devServer', async () => {
      mockServer.devServer = null;

      await expect(stopWebsiteServer(mockServer)).resolves.not.toThrow();
      expect(mockFs.rmSync).toHaveBeenCalled();
    });

    it('should handle devServer without close method', async () => {
      mockServer.devServer = {
        watcher: {
          close: jest.fn().mockResolvedValue(undefined),
        },
      };

      await expect(stopWebsiteServer(mockServer)).resolves.not.toThrow();
    });

    it('should handle devServer close errors', async () => {
      const closeError = new Error('Server close failed');
      mockServer.devServer.close.mockRejectedValue(closeError);

      jest.spyOn(console, 'error').mockImplementation();

      await stopWebsiteServer(mockServer);

      // Verify: Server close error is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.serverCloseFailed(3000));
    });

    it('should handle missing output directory', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await stopWebsiteServer(mockServer);

      expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('should handle output directory cleanup errors', async () => {
      const cleanupError = new Error('Cleanup failed');
      mockFs.rmSync.mockImplementation(() => {
        throw cleanupError;
      });

      jest.spyOn(console, 'error').mockImplementation();

      await stopWebsiteServer(mockServer);

      // Verify: Directory cleanup error is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.directoryCleanupFailed());
    });

    it('should handle general stop errors', async () => {
      const generalError = new Error('General stop error');
      mockServer.restoreConsole = jest.fn().mockImplementation(() => {
        throw generalError;
      });

      jest.spyOn(console, 'error').mockImplementation();

      await stopWebsiteServer(mockServer);

      // Verify: General server stop error is logged correctly
      loggingHelper.expectErrorLogged(buildErrorPatterns.serverStopFailed(3000));
    });
  });
});
