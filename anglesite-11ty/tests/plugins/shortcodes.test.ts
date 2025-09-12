import addShortcodes from '../../plugins/shortcodes';
import type { EleventyConfig } from '../types/eleventy-shim';
import type { EleventyContext } from '../types/context';

describe('shortcodes plugin', () => {
  const mockEleventyConfig = {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      layouts: '_includes',
      data: '_data',
    },
    on: jest.fn(),
    addPlugin: jest.fn(),
    addBundle: jest.fn(),
    setFreezeReservedData: jest.fn(),
    addPassthroughCopy: jest.fn(),
    addLayoutAlias: jest.fn(),
    setDataFileBaseName: jest.fn(),
    addJavaScriptFunction: jest.fn(),
    addShortcode: jest.fn(),
    addFilter: jest.fn(),
    addTransform: jest.fn(),
    addTemplateFormats: jest.fn(),
    addExtension: jest.fn(),
    setUseGitIgnore: jest.fn(),
    setUseEditorIgnore: jest.fn(),
    addCollection: jest.fn(),
    addTemplate: jest.fn(),
  } as unknown as EleventyConfig;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('plugin initialization', () => {
    it('should add both getPageTitle and rslScript shortcodes', () => {
      addShortcodes(mockEleventyConfig);

      expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('getPageTitle', expect.any(Function));
      expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('rslScript', expect.any(Function));
      expect(mockEleventyConfig.addShortcode).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPageTitle shortcode', () => {
    let getPageTitleShortcode: (...args: unknown[]) => string;

    beforeEach(() => {
      addShortcodes(mockEleventyConfig);
      getPageTitleShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'getPageTitle'
      )[1];
    });

    it('should return page title with website title when both are present', () => {
      const context: EleventyContext = {
        title: 'About Us',
        website: {
          title: 'My Awesome Site',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('About Us | My Awesome Site');
    });

    it('should return only website title when page title is missing', () => {
      const context: EleventyContext = {
        website: {
          title: 'My Awesome Site',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('My Awesome Site');
    });

    it('should return only website title when page title equals website title', () => {
      const context: EleventyContext = {
        title: 'My Awesome Site',
        website: {
          title: 'My Awesome Site',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('My Awesome Site');
    });

    it('should use default "Website" when website title is missing', () => {
      const context: EleventyContext = {
        title: 'About Us',
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('About Us | Website');
    });

    it('should return "Website" when both titles are missing', () => {
      const context: EleventyContext = {};

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('Website');
    });

    it('should handle empty string page title', () => {
      const context: EleventyContext = {
        title: '',
        website: {
          title: 'My Awesome Site',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('My Awesome Site');
    });

    it('should handle empty string website title', () => {
      const context: EleventyContext = {
        title: 'About Us',
        website: {
          title: '',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('About Us | Website');
    });

    it('should handle undefined website object', () => {
      const context: EleventyContext = {
        title: 'About Us',
        website: undefined,
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('About Us | Website');
    });

    it('should handle null website object', () => {
      const context: EleventyContext = {
        title: 'About Us',
        website: null as unknown,
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('About Us | Website');
    });

    it('should trim whitespace from titles', () => {
      const context: EleventyContext = {
        title: '  About Us  ',
        website: {
          title: '  My Awesome Site  ',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('  About Us   |   My Awesome Site  ');
    });

    it('should handle special characters in titles', () => {
      const context: EleventyContext = {
        title: 'About Us & Contact',
        website: {
          title: 'My Awesome Site™',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('About Us & Contact | My Awesome Site™');
    });

    it('should handle unicode characters in titles', () => {
      const context: EleventyContext = {
        title: 'À propos',
        website: {
          title: 'Mon Site Génial',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('À propos | Mon Site Génial');
    });

    it('should handle very long titles', () => {
      const longTitle = 'This is a very long page title that might be used for SEO purposes and contains many words';
      const longWebsiteTitle = 'This is also a very long website title with many descriptive words';

      const context: EleventyContext = {
        title: longTitle,
        website: {
          title: longWebsiteTitle,
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe(`${longTitle} | ${longWebsiteTitle}`);
    });

    it('should handle numeric titles', () => {
      const context: EleventyContext = {
        title: '404',
        website: {
          title: 'Site 2024',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('404 | Site 2024');
    });

    it('should handle boolean false values as falsy', () => {
      const context: EleventyContext = {
        title: false as unknown,
        website: {
          title: 'My Awesome Site',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('My Awesome Site');
    });

    it('should handle zero as falsy value', () => {
      const context: EleventyContext = {
        title: 0 as unknown,
        website: {
          title: 'My Awesome Site',
        },
      };

      const result = getPageTitleShortcode.call(context);

      expect(result).toBe('My Awesome Site');
    });
  });
});
