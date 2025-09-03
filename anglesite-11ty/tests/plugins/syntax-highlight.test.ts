import addSyntaxHighlight from '../../plugins/syntax-highlight.js';
import type { EleventyConfig } from '@11ty/eleventy';

describe('addSyntaxHighlight', () => {
  let mockConfig: jest.Mocked<EleventyConfig>;

  beforeEach(() => {
    mockConfig = {
      addPlugin: jest.fn(),
      addPassthroughCopy: jest.fn(),
    } as jest.Mocked<EleventyConfig>;

    // Mock console.log to avoid noise in test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should add the syntax highlighting plugin with default options', () => {
    addSyntaxHighlight(mockConfig);

    expect(mockConfig.addPlugin).toHaveBeenCalledWith(
      expect.any(Function), // syntaxHighlight plugin
      expect.objectContaining({
        theme: 'none',
        includeCSS: false,
        preAttributes: { tabindex: 0 },
        codeAttributes: {},
        init: expect.any(Function),
      })
    );
  });

  it('should merge user options with defaults', () => {
    const userOptions = {
      theme: 'dark',
      preAttributes: { class: 'custom-pre' },
      codeAttributes: { class: 'custom-code' },
    };

    addSyntaxHighlight(mockConfig, userOptions);

    expect(mockConfig.addPlugin).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        theme: 'dark',
        includeCSS: false, // still default
        preAttributes: { class: 'custom-pre' },
        codeAttributes: { class: 'custom-code' },
        init: expect.any(Function),
      })
    );
  });

  it('should preserve custom init function', () => {
    const customInit = jest.fn();
    const userOptions = {
      init: customInit,
    };

    addSyntaxHighlight(mockConfig, userOptions);

    expect(mockConfig.addPlugin).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        init: customInit,
      })
    );
  });

  describe('CSS auto-copy functionality', () => {
    it('should not copy CSS when includeCSS is false', () => {
      addSyntaxHighlight(mockConfig, {
        theme: 'dark',
        includeCSS: false,
      });

      expect(mockConfig.addPassthroughCopy).not.toHaveBeenCalled();
    });

    it('should not copy CSS when theme is "none"', () => {
      addSyntaxHighlight(mockConfig, {
        theme: 'none',
        includeCSS: true,
      });

      expect(mockConfig.addPassthroughCopy).not.toHaveBeenCalled();
    });

    it('should copy CSS for known theme', () => {
      addSyntaxHighlight(mockConfig, {
        theme: 'dark',
        includeCSS: true,
      });

      expect(mockConfig.addPassthroughCopy).toHaveBeenCalledWith({
        'node_modules/prismjs/themes/prism-dark.css': 'prism-dark.css',
      });
    });

    it('should copy CSS for custom theme name', () => {
      addSyntaxHighlight(mockConfig, {
        theme: 'custom-theme',
        includeCSS: true,
      });

      expect(mockConfig.addPassthroughCopy).toHaveBeenCalledWith({
        'node_modules/prismjs/themes/prism-custom-theme.css': 'prism-custom-theme.css',
      });
    });

    it('should use custom CSS filename when provided', () => {
      addSyntaxHighlight(mockConfig, {
        theme: 'dark',
        includeCSS: true,
        cssFilename: 'my-custom-theme.css',
      });

      expect(mockConfig.addPassthroughCopy).toHaveBeenCalledWith({
        'node_modules/prismjs/themes/prism-dark.css': 'my-custom-theme.css',
      });
    });

    it('should handle all predefined theme mappings', () => {
      const themes = [
        { theme: 'prism', expected: 'prism.css' },
        { theme: 'dark', expected: 'prism-dark.css' },
        { theme: 'funky', expected: 'prism-funky.css' },
        { theme: 'okaidia', expected: 'prism-okaidia.css' },
        { theme: 'twilight', expected: 'prism-twilight.css' },
        { theme: 'coy', expected: 'prism-coy.css' },
        { theme: 'solarizedlight', expected: 'prism-solarizedlight.css' },
        { theme: 'tomorrow', expected: 'prism-tomorrow.css' },
      ];

      themes.forEach(({ theme, expected }) => {
        mockConfig.addPassthroughCopy.mockClear();

        addSyntaxHighlight(mockConfig, {
          theme,
          includeCSS: true,
        });

        expect(mockConfig.addPassthroughCopy).toHaveBeenCalledWith({
          [`node_modules/prismjs/themes/${expected}`]: `prism-${theme}.css`,
        });
      });
    });

    it('should log CSS copy operation', () => {
      const consoleSpy = jest.spyOn(console, 'log');

      addSyntaxHighlight(mockConfig, {
        theme: 'dark',
        includeCSS: true,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Syntax Highlight] Using eleventyConfig.addPassthroughCopy() to copy: node_modules/prismjs/themes/prism-dark.css → prism-dark.css'
      );
    });
  });

  describe('options validation', () => {
    it('should handle empty options object', () => {
      addSyntaxHighlight(mockConfig, {});

      expect(mockConfig.addPlugin).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          theme: 'none',
          includeCSS: false,
        })
      );
    });

    it('should handle undefined options', () => {
      addSyntaxHighlight(mockConfig);

      expect(mockConfig.addPlugin).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          theme: 'none',
          includeCSS: false,
        })
      );
    });

    it('should preserve all user-provided options', () => {
      const userOptions = {
        theme: 'okaidia',
        includeCSS: true,
        cssFilename: 'syntax.css',
        preAttributes: {
          tabindex: 1,
          class: 'language-block',
        },
        codeAttributes: {
          class: 'language-code',
          'data-lang': 'auto',
        },
      };

      addSyntaxHighlight(mockConfig, userOptions);

      expect(mockConfig.addPlugin).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          theme: 'okaidia',
          includeCSS: true,
          cssFilename: 'syntax.css',
          preAttributes: {
            tabindex: 1,
            class: 'language-block',
          },
          codeAttributes: {
            class: 'language-code',
            'data-lang': 'auto',
          },
          init: expect.any(Function),
        })
      );
    });
  });
});
