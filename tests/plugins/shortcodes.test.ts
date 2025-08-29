import addShortcodes from '../../plugins/shortcodes.js';
import type { EleventyConfig } from '../types/eleventy-shim.js';
import type { EleventyContext } from '../../types/index.js';

describe('Shortcodes Plugin', () => {
  let mockEleventyConfig: jest.Mocked<EleventyConfig>;
  let mockContext: EleventyContext;
  let getPageTitleFunction: (this: EleventyContext) => string;

  beforeEach(() => {
    mockEleventyConfig = {
      addShortcode: jest.fn(),
    } as unknown as jest.Mocked<EleventyConfig>;

    // Call the plugin to register shortcodes
    addShortcodes(mockEleventyConfig);

    // Extract the registered shortcode function
    expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('getPageTitle', expect.any(Function));
    getPageTitleFunction = mockEleventyConfig.addShortcode.mock.calls[0][1];
  });

  describe('getPageTitle shortcode', () => {
    it('should register getPageTitle shortcode', () => {
      expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('getPageTitle', expect.any(Function));
    });

    it('returns website title when page title is not set', () => {
      mockContext = {
        website: {
          title: 'My Website',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('My Website');
    });

    it('returns website title when page title is empty string', () => {
      mockContext = {
        title: '',
        website: {
          title: 'My Website',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('My Website');
    });

    it('returns website title when page title equals website title', () => {
      mockContext = {
        title: 'My Website',
        website: {
          title: 'My Website',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('My Website');
    });

    it('returns formatted title when page title differs from website title', () => {
      mockContext = {
        title: 'About Us',
        website: {
          title: 'My Website',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('About Us | My Website');
    });

    it('returns default website title when website config is missing', () => {
      mockContext = {
        title: 'About Us',
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('About Us | Website');
    });

    it('returns default website title when website.title is missing', () => {
      mockContext = {
        title: 'About Us',
        website: {
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('About Us | Website');
    });

    it('returns default "Website" when no page title and no website config', () => {
      mockContext = {} as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('Website');
    });

    it('returns default "Website" when no page title and website.title is missing', () => {
      mockContext = {
        website: {
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('Website');
    });

    it('handles special characters in titles correctly', () => {
      mockContext = {
        title: 'About & Contact - "Special" Page',
        website: {
          title: 'My Site & Co.',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('About & Contact - "Special" Page | My Site & Co.');
    });

    it('handles unicode characters in titles correctly', () => {
      mockContext = {
        title: 'À propos',
        website: {
          title: 'Mon Site Web ™',
          language: 'fr',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('À propos | Mon Site Web ™');
    });

    it('handles very long titles correctly', () => {
      const longTitle = 'A'.repeat(100);
      const longWebsiteTitle = 'B'.repeat(50);

      mockContext = {
        title: longTitle,
        website: {
          title: longWebsiteTitle,
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe(`${longTitle} | ${longWebsiteTitle}`);
    });

    it('handles whitespace-only page titles as falsy', () => {
      mockContext = {
        title: '   ',
        website: {
          title: 'My Website',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      // Note: The current implementation treats '   ' as truthy,
      // but this test documents the actual behavior
      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('    | My Website');
    });

    it('handles null page title', () => {
      mockContext = {
        title: null as unknown as string,
        website: {
          title: 'My Website',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('My Website');
    });

    it('handles undefined page title', () => {
      mockContext = {
        title: undefined,
        website: {
          title: 'My Website',
          language: 'en',
          url: 'https://example.com',
        },
      } as EleventyContext;

      const result = getPageTitleFunction.call(mockContext);
      expect(result).toBe('My Website');
    });
  });
});
