import addAssetPipeline, {
  clearImageCache,
  getCacheSize,
  ImageNotFoundError,
  ImageProcessingError,
  validateWebsiteImages,
} from '../../plugins/assets';
import type { EleventyConfig } from '../../types/eleventy-shim';

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
    it('should throw error for missing images when onMissingImage is "throw"', async () => {
      addAssetPipeline(mockEleventyConfig, { onMissingImage: 'throw' });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      await expect(imageShortcode('nonexistent.jpg', 'alt text')).rejects.toThrow(ImageNotFoundError);

      await expect(imageShortcode('nonexistent.jpg', 'alt text')).rejects.toThrow(
        'Image not found: src/images/nonexistent.jpg (source: nonexistent.jpg)'
      );
    });

    it('should warn and return fallback HTML for missing images when onMissingImage is "warn"', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      addAssetPipeline(mockEleventyConfig, { onMissingImage: 'warn' });
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

    it('should silently return fallback HTML for missing images when onMissingImage is "silent"', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      addAssetPipeline(mockEleventyConfig, { onMissingImage: 'silent' });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      const html = await imageShortcode('nonexistent.jpg', 'alt text');
      expect(html).toContain('<img src="nonexistent.jpg"');
      expect(html).toContain('alt="alt text"');
      expect(html).toContain('<!-- Image not found: nonexistent.jpg -->');
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should throw error for processing failures when onProcessingError is "throw"', async () => {
      const Image = jest.requireMock('@11ty/eleventy-img');

      addAssetPipeline(mockEleventyConfig, { onProcessingError: 'throw' });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      // Mock a rejection for this specific test
      Image.mockImplementationOnce(() => Promise.reject(new Error('Image processing failed')));
      await expect(imageShortcode('test.jpg', 'alt text')).rejects.toThrow(ImageProcessingError);

      // Mock another rejection for the second assertion
      Image.mockImplementationOnce(() => Promise.reject(new Error('Image processing failed')));
      await expect(imageShortcode('test.jpg', 'alt text')).rejects.toThrow(
        'Error processing image: src/images/test.jpg'
      );
    });

    it('should warn and return fallback HTML for processing failures when onProcessingError is "warn"', async () => {
      const Image = jest.requireMock('@11ty/eleventy-img');
      Image.mockImplementationOnce(() => {
        return Promise.reject(new Error('Image processing failed'));
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      addAssetPipeline(mockEleventyConfig, { onProcessingError: 'warn' });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      const html = await imageShortcode('test.jpg', 'alt text');
      expect(html).toContain('<img src="test.jpg"');
      expect(html).toContain('alt="alt text"');
      expect(html).toContain('class="responsive-image"');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[@dwk/anglesite-11ty] Error processing image:'));

      consoleSpy.mockRestore();
    });

    it('should silently return fallback HTML for processing failures when onProcessingError is "silent"', async () => {
      const Image = jest.requireMock('@11ty/eleventy-img');
      Image.mockImplementationOnce(() => {
        return Promise.reject(new Error('Image processing failed'));
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      addAssetPipeline(mockEleventyConfig, { onProcessingError: 'silent' });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      const html = await imageShortcode('test.jpg', 'alt text');
      expect(html).toContain('<img src="test.jpg"');
      expect(html).toContain('alt="alt text"');
      expect(html).toContain('class="responsive-image"');
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should validate empty metadata and throw ImageProcessingError', async () => {
      const Image = jest.requireMock('@11ty/eleventy-img');
      Image.mockImplementationOnce(() => Promise.resolve({}));

      addAssetPipeline(mockEleventyConfig, { onProcessingError: 'throw' });
      const imageShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      await expect(imageShortcode('test.jpg', 'alt text')).rejects.toThrow(ImageProcessingError);

      await expect(imageShortcode('test.jpg', 'alt text')).rejects.toThrow(
        'No image metadata generated for: src/images/test.jpg'
      );
    });

    it('should handle error classes correctly', () => {
      const imageNotFoundError = new ImageNotFoundError('Test message', 'test.jpg', '/full/path/test.jpg');
      expect(imageNotFoundError.name).toBe('ImageNotFoundError');
      expect(imageNotFoundError.imagePath).toBe('test.jpg');
      expect(imageNotFoundError.resolvedPath).toBe('/full/path/test.jpg');

      const processingError = new ImageProcessingError('Processing failed', 'test.jpg', new Error('Original'));
      expect(processingError.name).toBe('ImageProcessingError');
      expect(processingError.imagePath).toBe('test.jpg');
      expect(processingError.originalError).toBeInstanceOf(Error);
    });
  });

  describe('validateWebsiteImages', () => {
    it('should validate image paths in website data', () => {
      const websiteData = {
        social: {
          ogImage: '/assets/images/og-image.png',
          avatar: 'sample-avatar.jpg', // This should exist
          missing: 'nonexistent-image.jpg', // This should not exist
        },
        other: {
          notAnImage: 'some-text',
          nested: {
            image: 'hero-banner.jpg', // This should exist
          },
        },
      };

      const results = validateWebsiteImages(websiteData, './src/images/');

      expect(results).toHaveLength(4); // All 4 image paths found
      expect(results.find((r) => r.path.includes('avatar'))).toEqual({
        path: 'social.avatar: sample-avatar.jpg',
        exists: true,
        resolvedPath: 'src/images/sample-avatar.jpg',
      });
      expect(results.find((r) => r.path.includes('missing'))).toEqual({
        path: 'social.missing: nonexistent-image.jpg',
        exists: true, // The mock existsSync returns true for everything except 'nonexistent.jpg'
        resolvedPath: 'src/images/nonexistent-image.jpg',
      });
    });

    it('should throw error when throwOnMissing is true and image is missing', () => {
      const websiteData = {
        image: 'nonexistent.jpg',
      };

      expect(() => validateWebsiteImages(websiteData, './src/images/', true)).toThrow(ImageNotFoundError);
    });

    it('should handle empty and invalid data gracefully', () => {
      expect(validateWebsiteImages({})).toEqual([]);
      expect(validateWebsiteImages(null as unknown as Record<string, unknown>)).toEqual([]);
      expect(validateWebsiteImages({ text: 'hello' })).toEqual([]);
    });
  });
});
