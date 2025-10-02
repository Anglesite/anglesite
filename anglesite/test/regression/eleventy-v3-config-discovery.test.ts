/**
 * @file Regression test for Eleventy v3 config auto-discovery bug
 *
 * Bug: When Eleventy v3 auto-discovers .eleventy.js files with ESM syntax,
 * it tries to require() them, causing an error with Node.js v22 without
 * --experimental-require-module flag.
 *
 * Fix: Explicitly set configPath: false to disable auto-discovery when
 * using programmatic configuration.
 */

import { startWebsiteServer } from '../../src/main/server/per-website-server';

// Mock all the dependencies
jest.mock('fs');
jest.mock('@11ty/eleventy');
jest.mock('@11ty/eleventy-dev-server');
jest.mock('../../src/main/server/eleventy-url-resolver');
jest.mock('../../src/main/ui/multi-window-manager', () => ({
  sendLogToWebsite: jest.fn(),
}));
jest.mock('../mocks/app-modules', () => ({}));

describe('Eleventy v3 Config Auto-Discovery Regression', () => {
  let mockEleventy: jest.Mock;
  let eleventyOptionsCapture: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup fs mocks
    const fs = require('fs') as jest.Mocked<typeof import('fs')>;
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.mkdirSync = jest.fn();

    // Capture the options passed to Eleventy constructor
    mockEleventy = require('@11ty/eleventy') as jest.Mock;
    mockEleventy.mockImplementation((input: string, output: string, options: any) => {
      eleventyOptionsCapture = options;
      return {
        write: jest.fn().mockResolvedValue(undefined),
      };
    });

    // Mock dev server
    const mockDevServer = require('@11ty/eleventy-dev-server') as jest.Mock;
    mockDevServer.mockReturnValue({
      serve: jest.fn(),
      watcher: {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      },
      watchFiles: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    });

    // Mock URL resolver
    const { EleventyUrlResolver } = require('../../src/main/server/eleventy-url-resolver');
    EleventyUrlResolver.prototype.initialize = jest.fn().mockResolvedValue(undefined);
  });

  it('should disable config file auto-discovery by setting configPath: false', async () => {
    await startWebsiteServer('/test/website', 'test-site', 3000);

    // Verify Eleventy was called with configPath: false
    expect(mockEleventy).toHaveBeenCalled();
    expect(eleventyOptionsCapture).toBeDefined();
    expect(eleventyOptionsCapture.configPath).toBe(false);
  });

  it('should still provide programmatic config function when disabling auto-discovery', async () => {
    await startWebsiteServer('/test/website', 'test-site', 3000);

    // Verify programmatic config function is provided
    expect(eleventyOptionsCapture.config).toBeDefined();
    expect(typeof eleventyOptionsCapture.config).toBe('function');
  });

  it('should not attempt to load .eleventy.js files from website directory', async () => {
    // This test documents the fix: by setting configPath: false,
    // Eleventy v3 will NOT auto-discover and try to require() .eleventy.js
    // files that might have ESM syntax
    await startWebsiteServer('/test/website', 'test-site', 3000);

    // The mere fact that this doesn't throw the "require() is incompatible"
    // error proves the fix works
    expect(mockEleventy).toHaveBeenCalledWith(
      '/test/website/src',
      '/test/website/_site',
      expect.objectContaining({
        configPath: false,
        config: expect.any(Function),
      })
    );
  });
});
