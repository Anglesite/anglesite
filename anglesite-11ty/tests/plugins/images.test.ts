import addImages from '../../plugins/images';
import type { EleventyConfig } from '../types/eleventy-shim';
import Image from '@11ty/eleventy-img';

// Mock @11ty/eleventy-img
const mockGenerateHTML = jest.fn();

jest.mock('@11ty/eleventy-img', () => {
  const mockImg = jest.fn();
  mockImg.generateHTML = mockGenerateHTML;
  return {
    __esModule: true,
    default: mockImg,
    generateHTML: mockGenerateHTML,
  };
});

describe('images plugin', () => {
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
    addAsyncShortcode: jest.fn(),
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

    // Get the mock function from the module
    // Image is already imported

    // Mock successful image processing
    Image.mockResolvedValue({
      avif: [{ url: '/img/test-300.avif', width: 300, height: 200 }],
      webp: [{ url: '/img/test-300.webp', width: 300, height: 200 }],
      jpeg: [{ url: '/img/test-300.jpeg', width: 300, height: 200, size: 15000 }],
    });

    // Ensure the generateHTML method is available on the Image function
    Image.generateHTML = mockGenerateHTML;

    mockGenerateHTML.mockReturnValue(
      '<picture><source srcset="/img/test-300.avif"><img src="/img/test-300.jpeg" alt="test"></picture>'
    );
  });

  describe('plugin initialization', () => {
    it('should add async shortcodes when available', () => {
      addImages(mockEleventyConfig);

      expect(mockEleventyConfig.addAsyncShortcode).toHaveBeenCalledWith('image', expect.any(Function));
      expect(mockEleventyConfig.addAsyncShortcode).toHaveBeenCalledWith('imageUrl', expect.any(Function));
      expect(mockEleventyConfig.addAsyncShortcode).toHaveBeenCalledWith('imageMetadata', expect.any(Function));
      expect(mockEleventyConfig.addAsyncShortcode).toHaveBeenCalledTimes(3);
    });

    it('should skip initialization when addAsyncShortcode is not available', () => {
      const configWithoutAsync = { ...mockEleventyConfig };
      delete (configWithoutAsync as Partial<EleventyConfig>).addAsyncShortcode;

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      addImages(configWithoutAsync as EleventyConfig);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Anglesite Images] addAsyncShortcode not available. Image plugin requires Eleventy 1.0 or higher.'
      );

      consoleSpy.mockRestore();
    });

    it('should apply custom options', () => {
      const options = {
        outputDir: 'assets/img/',
        urlPath: '/assets/img/',
        formats: ['webp', 'jpeg'] as const,
        widths: [400, 800],
        loading: 'eager' as const,
        decoding: 'sync' as const,
      };

      addImages(mockEleventyConfig, options);

      // Verify the shortcode was registered
      expect(mockEleventyConfig.addAsyncShortcode).toHaveBeenCalledWith('image', expect.any(Function));
    });
  });

  describe('image shortcode', () => {
    let imageShortcode: (...args: unknown[]) => Promise<string>;
    let Image: jest.Mock;

    beforeEach(() => {
      addImages(mockEleventyConfig);
      imageShortcode = (mockEleventyConfig.addAsyncShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];
      // Image is already imported
    });

    it('should process images with required parameters', async () => {
      const result = await imageShortcode('test.jpg', 'Test image', '100vw');

      expect(Image).toHaveBeenCalledWith(
        'test.jpg',
        expect.objectContaining({
          widths: [300, 600, 1200],
          formats: ['avif', 'webp', 'jpeg'],
          outputDir: '_site/img/',
          urlPath: '/img/',
        })
      );

      expect(mockGenerateHTML).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          alt: 'Test image',
          sizes: '100vw',
          loading: 'lazy',
          decoding: 'async',
        })
      );

      expect(result).toBe(
        '<picture><source srcset="/img/test-300.avif"><img src="/img/test-300.jpeg" alt="test"></picture>'
      );
    });

    it('should throw error when src is missing', async () => {
      await expect(imageShortcode('', 'Test alt', '100vw')).rejects.toThrow('Image shortcode requires a src parameter');
    });

    it('should throw error when alt is missing', async () => {
      await expect(imageShortcode('test.jpg', '', '100vw')).rejects.toThrow(
        'Image shortcode requires an alt parameter for accessibility: test.jpg'
      );
    });

    it('should use default sizes when not provided', async () => {
      await imageShortcode('test.jpg', 'Test image');

      expect(mockGenerateHTML).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          sizes: '100vw', // default value
        })
      );
    });
  });

  describe('imageUrl shortcode', () => {
    let imageUrlShortcode: (...args: unknown[]) => Promise<string>;
    let Image: jest.Mock;

    beforeEach(() => {
      addImages(mockEleventyConfig);
      imageUrlShortcode = (mockEleventyConfig.addAsyncShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'imageUrl'
      )[1];
      // Image is already imported
    });

    it('should return single image URL', async () => {
      Image.mockResolvedValueOnce({
        webp: [{ url: '/img/test-600.webp', width: 600, height: 400 }],
      });

      const result = await imageUrlShortcode('test.jpg', 600, 'webp');

      expect(Image).toHaveBeenCalledWith(
        'test.jpg',
        expect.objectContaining({
          widths: [600],
          formats: ['webp'],
        })
      );

      expect(result).toBe('/img/test-600.webp');
    });

    it('should use default width and format', async () => {
      Image.mockResolvedValueOnce({
        webp: [{ url: '/img/test-600.webp' }],
      });

      const result = await imageUrlShortcode('test.jpg');

      expect(Image).toHaveBeenCalledWith(
        'test.jpg',
        expect.objectContaining({
          widths: [600], // default
          formats: ['webp'], // default
        })
      );

      expect(result).toBe('/img/test-600.webp');
    });

    it('should throw error when src is missing', async () => {
      await expect(imageUrlShortcode('')).rejects.toThrow('ImageUrl shortcode requires a src parameter');
    });

    it('should return empty string when format not found', async () => {
      Image.mockResolvedValueOnce({
        jpeg: [{ url: '/img/test-600.jpeg' }],
      });

      const result = await imageUrlShortcode('test.jpg', 600, 'webp'); // requesting webp but only jpeg available
      expect(result).toBe('');
    });
  });

  describe('imageMetadata shortcode', () => {
    let imageMetadataShortcode: (...args: unknown[]) => Promise<unknown>;
    let Image: jest.Mock;

    beforeEach(() => {
      addImages(mockEleventyConfig);
      imageMetadataShortcode = (mockEleventyConfig.addAsyncShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'imageMetadata'
      )[1];
      // Image is already imported
    });

    it('should return image metadata', async () => {
      Image.mockResolvedValueOnce({
        jpeg: [
          {
            url: '/img/test-300.jpeg',
            width: 300,
            height: 200,
            size: 15000,
          },
        ],
      });

      const result = await imageMetadataShortcode('test.jpg');

      expect(Image).toHaveBeenCalledWith(
        'test.jpg',
        expect.objectContaining({
          widths: [300], // first width from default widths
          formats: ['jpeg'],
        })
      );

      expect(result).toEqual({
        url: '/img/test-300.jpeg',
        width: 300,
        height: 200,
        format: 'jpeg',
        size: 15000,
      });
    });

    it('should throw error when src is missing', async () => {
      await expect(imageMetadataShortcode('')).rejects.toThrow('ImageMetadata shortcode requires a src parameter');
    });

    it('should return null when no image data available', async () => {
      Image.mockResolvedValueOnce({});

      const result = await imageMetadataShortcode('test.jpg');
      expect(result).toBeNull();
    });

    it('should handle missing size property', async () => {
      Image.mockResolvedValueOnce({
        jpeg: [
          {
            url: '/img/test-300.jpeg',
            width: 300,
            height: 200,
            // size missing
          },
        ],
      });

      const result = await imageMetadataShortcode('test.jpg');

      expect(result).toEqual({
        url: '/img/test-300.jpeg',
        width: 300,
        height: 200,
        format: 'jpeg',
        size: 0, // fallback value
      });
    });
  });

  describe('configuration options', () => {
    let Image: jest.Mock;

    beforeEach(() => {
      // Image is already imported
    });

    it('should respect custom output directory', async () => {
      addImages(mockEleventyConfig, {
        outputDir: 'assets/images/',
        urlPath: '/assets/images/',
      });

      const imageShortcode = (mockEleventyConfig.addAsyncShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      await imageShortcode('test.jpg', 'Test image', '100vw');

      expect(Image).toHaveBeenCalledWith(
        'test.jpg',
        expect.objectContaining({
          outputDir: '_site/assets/images/',
          urlPath: '/assets/images/',
        })
      );
    });

    it('should respect custom formats and widths', async () => {
      addImages(mockEleventyConfig, {
        formats: ['webp', 'jpeg'],
        widths: [400, 800, 1600],
      });

      const imageShortcode = (mockEleventyConfig.addAsyncShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      await imageShortcode('test.jpg', 'Test image', '100vw');

      expect(Image).toHaveBeenCalledWith(
        'test.jpg',
        expect.objectContaining({
          formats: ['webp', 'jpeg'],
          widths: [400, 800, 1600],
        })
      );
    });

    it('should respect custom loading and decoding attributes', async () => {
      addImages(mockEleventyConfig, {
        loading: 'eager',
        decoding: 'sync',
      });

      const imageShortcode = (mockEleventyConfig.addAsyncShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'image'
      )[1];

      await imageShortcode('test.jpg', 'Test image', '100vw');

      expect(mockGenerateHTML).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          loading: 'eager',
          decoding: 'sync',
        })
      );
    });
  });
});
