/**
 * @file Tests for the Eleventy configuration.
 */

// Mock the dependencies that .eleventy.js requires
jest.mock('@11ty/eleventy-plugin-webc', () => ({}));
jest.mock('@dwk/anglesite-11ty', () => jest.fn(() => ({ name: '@dwk/anglesite-11ty' })));
jest.mock('fs', () => ({
  existsSync: jest.fn((path: string) => {
    // Mock that the base layout exists
    return path.includes('base.webc');
  }),
}));
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
}));

// Now require the module
const eleventyConfig = require('../app/eleventy/.eleventy.js');

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

  it('should configure plugins correctly', () => {
    eleventyConfig(mockConfig);

    expect(mockConfig.addPlugin).toHaveBeenCalledTimes(2);
    expect(mockConfig.setFreezeReservedData).toHaveBeenCalledWith(false);
  });

  it('should add the anglesite-11ty plugin', () => {
    const anglesitePlugin = require('@dwk/anglesite-11ty');
    eleventyConfig(mockConfig);

    expect(mockConfig.addPlugin).toHaveBeenCalledWith(anglesitePlugin);
  });

  it('should add WebC plugin with correct component paths', () => {
    eleventyConfig(mockConfig);

    // Check that WebC plugin was added (it's the second call to addPlugin)
    expect(mockConfig.addPlugin).toHaveBeenCalledTimes(2);

    // Find the WebC plugin call (not the anglesite plugin)
    const webCCall = mockConfig.addPlugin.mock.calls.find(
      (call: unknown[]) => call[1] && typeof call[1] === 'object' && call[1] !== null && 'components' in call[1]
    );

    expect(webCCall).toBeDefined();
    expect(webCCall?.[1]).toEqual({
      components: 'src/_includes/**/*.webc',
    });
  });

  it('should set data file base name to anglesite when base layout exists', () => {
    const mockFs = require('fs');
    mockFs.existsSync.mockReturnValue(true);

    eleventyConfig(mockConfig);

    expect(mockConfig.setDataFileBaseName).toHaveBeenCalledWith('anglesite');
  });

  it('should return correct configuration object', () => {
    const config = eleventyConfig(mockConfig);

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

  it('should define correct directory structure', () => {
    const config = eleventyConfig(mockConfig);

    expect(config.dir).toBeDefined();
    expect(config.dir.includes).toBe('_includes');
    expect(config.dir.layouts).toBe('_includes');
    expect(config.dir.input).toBe('src');
    expect(config.dir.output).toBe('_site');
  });

  it('should configure WebC as the template engine for markdown and HTML', () => {
    const config = eleventyConfig(mockConfig);

    expect(config.markdownTemplateEngine).toBe('webc');
    expect(config.htmlTemplateEngine).toBe('webc');
  });

  it('should support the correct template formats', () => {
    const config = eleventyConfig(mockConfig);

    expect(config.templateFormats).toContain('11ty.js');
    expect(config.templateFormats).toContain('webc');
    expect(config.templateFormats).toContain('md');
    expect(config.templateFormats).toContain('html');
    expect(config.templateFormats).toHaveLength(4);
  });
});
