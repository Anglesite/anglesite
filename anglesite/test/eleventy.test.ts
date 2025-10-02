/**
 * @file Tests for the Eleventy configuration.
 */

// Mock the dependencies that eleventy.config.js requires
jest.mock('@11ty/eleventy-plugin-webc', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@dwk/anglesite-11ty', () => ({
  __esModule: true,
  default: jest.fn(() => ({ name: '@dwk/anglesite-11ty' })),
}));
jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn((path: string) => {
      // Mock that the base layout exists
      return path.includes('base.webc');
    }),
  },
  existsSync: jest.fn((path: string) => {
    // Mock that the base layout exists
    return path.includes('base.webc');
  }),
}));
jest.mock('path', () => ({
  __esModule: true,
  default: {
    join: jest.fn((...args: string[]) => args.join('/')),
  },
  join: jest.fn((...args: string[]) => args.join('/')),
}));

// Now import the module using ESM import
import eleventyConfigModule from '../src/main/eleventy/eleventy.config.js';
const eleventyConfig = eleventyConfigModule;

/**
 * Describes the Eleventy configuration tests.
 */
describe('Eleventy Configuration', () => {
  let mockConfig: {
    addBundle: jest.Mock;
    addPlugin: jest.Mock;
    setDataFileBaseName: jest.Mock;
    setFreezeReservedData: jest.Mock;
    addGlobalData: jest.Mock;
  };
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Mock console methods to prevent noise in test output
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Create a mock Eleventy config object with all required methods
    mockConfig = {
      addBundle: jest.fn(),
      addPlugin: jest.fn(),
      setDataFileBaseName: jest.fn(),
      setFreezeReservedData: jest.fn(),
      addGlobalData: jest.fn(),
    };
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should configure plugins correctly', async () => {
    await eleventyConfig(mockConfig);

    expect(mockConfig.addPlugin).toHaveBeenCalledTimes(2);
    expect(mockConfig.setFreezeReservedData).toHaveBeenCalledWith(false);
  });

  it('should add the anglesite-11ty plugin', async () => {
    // Import the plugin to get the mock
    const anglesitePluginModule = await import('@dwk/anglesite-11ty');
    await eleventyConfig(mockConfig);

    // The mock returns the function itself, so we check for the mocked function
    expect(mockConfig.addPlugin).toHaveBeenCalledWith(expect.any(Function), {
      skipWebC: true,
    });
  });

  it('should add WebC plugin with correct component paths', async () => {
    await eleventyConfig(mockConfig);

    // Check that WebC plugin was added (it's the second call to addPlugin)
    expect(mockConfig.addPlugin).toHaveBeenCalledTimes(2);

    // Find the WebC plugin call (not the anglesite plugin)
    const webCCall = mockConfig.addPlugin.mock.calls.find(
      (call: unknown[]) => call[1] && typeof call[1] === 'object' && call[1] !== null && 'components' in call[1]
    );

    expect(webCCall).toBeDefined();
    expect(webCCall?.[1]).toEqual({
      components: '_includes/**/*.webc', // Standardized path
    });
  });

  it('should set data file base name to anglesite when base layout exists', async () => {
    const mockFs = require('fs');
    mockFs.existsSync.mockReturnValue(true);

    await eleventyConfig(mockConfig);

    expect(mockConfig.setDataFileBaseName).toHaveBeenCalledWith('anglesite');
  });

  it('should return correct configuration object', async () => {
    const config = await eleventyConfig(mockConfig);

    expect(config).toEqual({
      templateFormats: ['11ty.js', 'webc', 'md', 'html'],
      markdownTemplateEngine: 'webc',
      htmlTemplateEngine: 'webc',
      dir: {
        input: 'src',
        output: '_site',
        includes: '_includes',
        layouts: '_includes',
      },
    });
  });

  it('should define correct directory structure', async () => {
    const config = await eleventyConfig(mockConfig);

    expect(config.dir).toBeDefined();
    expect(config.dir.includes).toBe('_includes');
    expect(config.dir.layouts).toBe('_includes');
    expect(config.dir.input).toBe('src');
    expect(config.dir.output).toBe('_site');
  });

  it('should configure WebC as the template engine for markdown and HTML', async () => {
    const config = await eleventyConfig(mockConfig);

    expect(config.markdownTemplateEngine).toBe('webc');
    expect(config.htmlTemplateEngine).toBe('webc');
  });

  it('should support the correct template formats', async () => {
    const config = await eleventyConfig(mockConfig);

    expect(config.templateFormats).toContain('11ty.js');
    expect(config.templateFormats).toContain('webc');
    expect(config.templateFormats).toContain('md');
    expect(config.templateFormats).toContain('html');
    expect(config.templateFormats).toHaveLength(4);
  });
});
