import addAssetPipeline, { clearImageCache, getCacheSize } from '../../plugins/assets';
import type { EleventyConfig } from '../types/eleventy-shim';

// Mock the @11ty/eleventy-img library
jest.mock('@11ty/eleventy-img', () => {
  return jest.fn().mockImplementation((src) => {
    const filename = src.split('/').pop() || src;
    const metadata = {
      webp: [
        { url: `/images/${filename}-320w.webp`, width: 320 },
        { url: `/images/${filename}-640w.webp`, width: 640 },
      ],
      avif: [
        { url: `/images/${filename}-320w.avif`, width: 320 },
        { url: `/images/${filename}-640w.avif`, width: 640 },
      ],
      jpeg: [
        { url: `/images/${filename}-320w.jpeg`, width: 320 },
        { url: `/images/${filename}-640w.jpeg`, width: 640 },
      ],
    };
    return Promise.resolve(metadata);
  });
});

// Mock fs.existsSync
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockImplementation((filePath) => {
    // Mock that all test images exist except specific ones
    return !filePath.includes('nonexistent.jpg');
  }),
}));

// Mock crypto for consistent cache keys in tests
jest.mock('crypto', () => {
  return {
    ...jest.requireActual('crypto'),
    createHash: jest.fn().mockImplementation(() => {
      const updates: string[] = [];
      return {
        update: jest.fn().mockImplementation((data) => {
          updates.push(data);
          return this;
        }),
        digest: jest.fn().mockImplementation(() => {
          // Return consistent hash for same inputs
          return `test-hash-${updates.join('-')}`;
        }),
      };
    }),
  };
});

describe('assets plugin', () => {
  const mockEleventyConfig = {
    addShortcode: jest.fn(),
    addPassthroughCopy: jest.fn(),
    on: jest.fn(),
  } as unknown as EleventyConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    clearImageCache();
  });

  it('should register image, img, figure, and fontPreload shortcodes', () => {
    addAssetPipeline(mockEleventyConfig);
    expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('image', expect.any(Function));
    expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('img', expect.any(Function));
    expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('figure', expect.any(Function));
    expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('fontPreload', expect.any(Function));
  });

  it('should register eleventy.before event for cache clearing', () => {
    addAssetPipeline(mockEleventyConfig);
    expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.before', expect.any(Function));
  });

  it('should add passthrough copy with default options', () => {
    addAssetPipeline(mockEleventyConfig);
    expect(mockEleventyConfig.addPassthroughCopy).toHaveBeenCalledWith({
      'src/assets/fonts': 'fonts',
      'src/assets/icons': 'icons',
    });
  });

  it('should add passthrough copy with custom options', () => {
    const options = {
      passthroughCopy: {
        'src/static': 'static',
      },
    };
    addAssetPipeline(mockEleventyConfig, options);
    expect(mockEleventyConfig.addPassthroughCopy).toHaveBeenCalledWith(options.passthroughCopy);
  });

  describe('image shortcode', () => {
    it('should generate a picture element by default', async () => {
      addAssetPipeline(mockEleventyConfig);
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];
      const html = await imageShortcode('test.jpg', 'alt text', 'sizes');
      expect(html).toContain('<picture>');
      expect(html).toContain('<source type="image/webp"');
      expect(html).toContain('<source type="image/avif"');
      expect(html).toContain('<img src="/images/test.jpg-640w.jpeg"');
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('decoding="async"');
      expect(html).toContain('class="responsive-image"');
    });

    it('should support custom loading and decoding attributes', async () => {
      const options = {
        lazyLoading: false,
        decoding: 'sync' as const,
        fetchPriority: 'high' as const,
      };
      addAssetPipeline(mockEleventyConfig, options);
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];
      const html = await imageShortcode('test.jpg', 'alt text');
      expect(html).not.toContain('loading="lazy"');
      expect(html).toContain('decoding="sync"');
      expect(html).toContain('fetchpriority="high"');
    });

    it('should cache metadata when cache is enabled', async () => {
      addAssetPipeline(mockEleventyConfig, { enableCache: true });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      expect(getCacheSize()).toBe(0);

      // First call should populate cache
      await imageShortcode('test.jpg', 'alt text');
      expect(getCacheSize()).toBe(1);

      // Second call should use cache
      await imageShortcode('test.jpg', 'alt text');
      expect(getCacheSize()).toBe(1);

      // Different image should create new cache entry
      await imageShortcode('other.jpg', 'alt text');
      expect(getCacheSize()).toBe(2);
    });

    it('should not cache metadata when cache is disabled', async () => {
      addAssetPipeline(mockEleventyConfig, { enableCache: false });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      await imageShortcode('test.jpg', 'alt text');
      expect(getCacheSize()).toBe(0);
    });
  });

  describe('img shortcode', () => {
    it('should generate an img element with srcset', async () => {
      addAssetPipeline(mockEleventyConfig);
      const imgShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'img'
      )[1];
      const html = await imgShortcode('test.jpg', 'alt text', 'sizes');
      expect(html).not.toContain('<picture>');
      expect(html).toContain('<img src="/images/test.jpg-640w.jpeg"');
      expect(html).toContain('srcset=');
      expect(html).toContain('320w');
      expect(html).toContain('640w');
    });
  });

  describe('figure shortcode', () => {
    it('should generate a figure element with picture', async () => {
      addAssetPipeline(mockEleventyConfig);
      const figureShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'figure'
      )[1];
      const html = await figureShortcode('test.jpg', 'alt text', 'sizes', 'Test caption');
      expect(html).toContain('<figure>');
      expect(html).toContain('<picture>');
      expect(html).toContain('<figcaption>Test caption</figcaption>');
      expect(html).toContain('</figure>');
    });

    it('should generate figure without caption when not provided', async () => {
      addAssetPipeline(mockEleventyConfig);
      const figureShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'figure'
      )[1];
      const html = await figureShortcode('test.jpg', 'alt text', 'sizes');
      expect(html).toContain('<figure>');
      expect(html).not.toContain('<figcaption>');
    });
  });

  describe('fontPreload shortcode', () => {
    it('should generate a preload link', () => {
      addAssetPipeline(mockEleventyConfig);
      const fontPreloadShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'fontPreload'
      )[1];
      const html = fontPreloadShortcode('/fonts/font.woff2');
      expect(html).toBe(
        '<link rel="preload" href="/fonts/font.woff2" as="font" type="font/woff2" crossorigin="anonymous">'
      );
    });

    it('should support custom font format', () => {
      addAssetPipeline(mockEleventyConfig);
      const fontPreloadShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'fontPreload'
      )[1];
      const html = fontPreloadShortcode('/fonts/font.otf', 'otf', false);
      expect(html).toBe('<link rel="preload" href="/fonts/font.otf" as="font" type="font/otf" >');
    });
  });

  describe('cache management', () => {
    it('should clear cache on eleventy.before event', () => {
      addAssetPipeline(mockEleventyConfig, { enableCache: true });

      // Simulate adding items to cache
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      // Add something to cache
      imageShortcode('test.jpg', 'alt text');

      // Get the eleventy.before callback
      const beforeCallback = (mockEleventyConfig.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'eleventy.before'
      )[1];

      // Execute the callback
      beforeCallback();

      // Cache should be cleared
      expect(getCacheSize()).toBe(0);
    });

    it('should not clear cache when cache is disabled', () => {
      addAssetPipeline(mockEleventyConfig, { enableCache: false });

      const beforeCallback = (mockEleventyConfig.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'eleventy.before'
      )[1];

      beforeCallback();
      // Should not throw or cause issues
      expect(getCacheSize()).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle image processing errors gracefully', async () => {
      const Image = jest.requireMock('@11ty/eleventy-img');
      Image.mockImplementationOnce(() => {
        throw new Error('Image processing failed');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      addAssetPipeline(mockEleventyConfig);
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      const html = await imageShortcode('test.jpg', 'alt text');
      expect(html).toContain('<img src="test.jpg"');
      expect(html).toContain('alt="alt text"');
      expect(html).toContain('class="responsive-image"');
      expect(consoleSpy).toHaveBeenCalledWith('Error processing image src/images/test.jpg:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should handle missing images gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      addAssetPipeline(mockEleventyConfig);
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      const html = await imageShortcode('nonexistent.jpg', 'alt text');
      expect(html).toContain('<img src="nonexistent.jpg"');
      expect(html).toContain('alt="alt text"');
      expect(html).toContain('<!-- Image not found: nonexistent.jpg -->');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[@dwk/anglesite-11ty] Image not found:'));

      consoleSpy.mockRestore();
    });
  });
});
