import { EleventyConfig } from '@11ty/eleventy';
import Image from '@11ty/eleventy-img';
import * as crypto from 'crypto';
import { existsSync } from 'fs';
import * as path from 'path';

/**
 * Image metadata returned by @11ty/eleventy-img
 */
interface ImageMetadata {
  /** Format-keyed object containing arrays of image variants */
  [format: string]: Array<{
    /** Public URL to the generated image */
    url: string;
    /** Image width in pixels */
    width: number;
    /** Image height in pixels (optional) */
    height?: number;
    /** File size in bytes (optional) */
    size?: number;
  }>;
}

/**
 * Configuration options for the asset pipeline plugin
 */
interface AssetPluginOptions {
  /** Image formats to generate (default: ['webp', 'avif', 'jpeg']) */
  imageFormats?: ('webp' | 'avif' | 'jpeg' | 'png')[];
  /** Image widths to generate (default: [320, 640, 768, 1024, 1280, 1536]) */
  imageSizes?: number[];
  /** Quality settings per format */
  imageQuality?: {
    /** JPEG quality 0-100 (default: 85) */
    jpeg?: number;
    /** WebP quality 0-100 (default: 80) */
    webp?: number;
    /** AVIF quality 0-100 (default: 75) */
    avif?: number;
    /** PNG quality 0-100 (default: 90) */
    png?: number;
  };
  /** Source directory for images (default: './src/images/') */
  imageDirectory?: string;
  /** URL path for generated images (default: '/images/') */
  urlPath?: string;
  /** Static assets to copy through (default: fonts and icons) */
  passthroughCopy?: Record<string, string>;
  /** HTML output format (default: 'picture') */
  outputFormat?: 'picture' | 'img' | 'figure';
  /** Enable metadata caching (default: true) */
  enableCache?: boolean;
  /** Cache duration in milliseconds (default: 3600000 = 1 hour) */
  cacheDuration?: number;
  /** Add lazy loading attribute (default: true) */
  lazyLoading?: boolean;
  /** Image decoding strategy (default: 'async') */
  decoding?: 'async' | 'sync' | 'auto';
  /** Fetch priority hint (default: 'auto') */
  fetchPriority?: 'high' | 'low' | 'auto';
  /** CSS class name for images (default: 'responsive-image') */
  className?: string;
}

/**
 * Default configuration options for the asset pipeline
 * @internal
 */
const DEFAULT_OPTIONS: Required<AssetPluginOptions> = {
  imageFormats: ['webp', 'avif', 'jpeg'],
  imageSizes: [320, 640, 768, 1024, 1280, 1536],
  imageQuality: {
    jpeg: 85,
    webp: 80,
    avif: 75,
    png: 90,
  },
  imageDirectory: './src/images/',
  urlPath: '/images/',
  passthroughCopy: {
    'src/assets/fonts': 'fonts',
    'src/assets/icons': 'icons',
  },
  outputFormat: 'picture',
  enableCache: true,
  cacheDuration: 3600000, // 1 hour
  lazyLoading: true,
  decoding: 'async',
  fetchPriority: 'auto',
  className: 'responsive-image',
};

/**
 * Cache entry for storing image metadata with timestamp
 * @internal
 */
interface CacheEntry {
  /** Cached image metadata */
  metadata: ImageMetadata;
  /** Timestamp when entry was created */
  timestamp: number;
}

/**
 * In-memory cache for image metadata to avoid redundant processing
 * @internal
 */
const metadataCache = new Map<string, CacheEntry>();

/**
 * Generates a cache key for an image based on source and options
 * @param src The source path of the image
 * @param options The image processing options
 * @returns MD5 hash key for cache
 */
function getCacheKey(src: string, options: Record<string, unknown>): string {
  const hash = crypto.createHash('md5');
  hash.update(src);
  hash.update(JSON.stringify(options));
  return hash.digest('hex');
}

/**
 * Gets cached metadata if valid, otherwise returns null
 * @param key The cache key
 * @param cacheDuration The cache duration in milliseconds
 * @returns The cached metadata or null if not found/expired
 */
function getCachedMetadata(key: string, cacheDuration: number): ImageMetadata | null {
  const entry = metadataCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > cacheDuration) {
    metadataCache.delete(key);
    return null;
  }

  return entry.metadata;
}

/**
 * Stores metadata in cache
 * @param key The cache key
 * @param metadata The image metadata to cache
 */
function setCachedMetadata(key: string, metadata: ImageMetadata): void {
  metadataCache.set(key, {
    metadata,
    timestamp: Date.now(),
  });
}

/**
 * Generates an img element with srcset
 * @param metadata The image metadata
 * @param alt Alternative text for the image
 * @param sizes Sizes attribute for responsive images
 * @param options Asset plugin options
 * @returns HTML img element string
 */
function generateImgElement(
  metadata: ImageMetadata,
  alt: string,
  sizes: string,
  options: Required<AssetPluginOptions>
): string {
  const fallbackFormat = metadata.jpeg || metadata.png || Object.values(metadata)[0];
  if (!fallbackFormat || fallbackFormat.length === 0) {
    throw new Error('No valid image metadata found');
  }

  const fallback = fallbackFormat[fallbackFormat.length - 1];
  const srcset = fallbackFormat.map((img) => `${img.url} ${img.width}w`).join(', ');

  const loadingAttr = options.lazyLoading ? 'loading="lazy"' : '';
  const decodingAttr = `decoding="${options.decoding}"`;
  const fetchPriorityAttr = options.fetchPriority !== 'auto' ? `fetchpriority="${options.fetchPriority}"` : '';
  const classAttr = options.className ? `class="${options.className}"` : '';

  return `<img src="${fallback.url}" srcset="${srcset}" sizes="${sizes}" alt="${alt}" ${loadingAttr} ${decodingAttr} ${fetchPriorityAttr} ${classAttr}>`;
}

/**
 * Generates a picture element with multiple formats
 * @param metadata The image metadata
 * @param alt Alternative text for the image
 * @param sizes Sizes attribute for responsive images
 * @param options Asset plugin options
 * @returns HTML picture element string
 */
function generatePictureElement(
  metadata: ImageMetadata,
  alt: string,
  sizes: string,
  options: Required<AssetPluginOptions>
): string {
  let html = '<picture>';

  // Add source elements for modern formats
  Object.entries(metadata)
    .reverse()
    .forEach(([format, images]) => {
      if (format !== 'jpeg' && format !== 'png') {
        const srcset = images.map((img) => `${img.url} ${img.width}w`).join(', ');
        html += `<source type="image/${format}" srcset="${srcset}" sizes="${sizes}">`;
      }
    });

  // Add fallback img element
  const fallbackFormat = metadata.jpeg || metadata.png || Object.values(metadata)[0];
  if (fallbackFormat && fallbackFormat.length > 0) {
    const fallback = fallbackFormat[fallbackFormat.length - 1];
    const srcset = fallbackFormat.map((img) => `${img.url} ${img.width}w`).join(', ');

    const loadingAttr = options.lazyLoading ? 'loading="lazy"' : '';
    const decodingAttr = `decoding="${options.decoding}"`;
    const fetchPriorityAttr = options.fetchPriority !== 'auto' ? `fetchpriority="${options.fetchPriority}"` : '';
    const classAttr = options.className ? `class="${options.className}"` : '';

    html += `<img src="${fallback.url}" srcset="${srcset}" sizes="${sizes}" alt="${alt}" ${loadingAttr} ${decodingAttr} ${fetchPriorityAttr} ${classAttr}>`;
  }

  html += '</picture>';
  return html;
}

/**
 * Generates a figure element with picture and optional caption
 * @param metadata The image metadata
 * @param alt Alternative text for the image
 * @param sizes Sizes attribute for responsive images
 * @param options Asset plugin options
 * @param caption Optional caption for the figure
 * @returns HTML figure element string
 */
function generateFigureElement(
  metadata: ImageMetadata,
  alt: string,
  sizes: string,
  options: Required<AssetPluginOptions>,
  caption?: string
): string {
  const pictureHtml = generatePictureElement(metadata, alt, sizes, options);
  let html = '<figure>';
  html += pictureHtml;
  if (caption) {
    html += `<figcaption>${caption}</figcaption>`;
  }
  html += '</figure>';
  return html;
}

/**
 * Enhanced image processing shortcode for Anglesite that generates optimized responsive images
 * 
 * This function validates image existence, processes images through @11ty/eleventy-img,
 * caches metadata for performance, and outputs configurable HTML formats.
 * 
 * @param src - The source path of the image (relative to imageDirectory or absolute)
 * @param alt - Alternative text for the image (required for accessibility)
 * @param sizes - Sizes attribute for responsive images (default: '(max-width: 768px) 100vw, 50vw')
 * @param options - Asset plugin configuration options
 * @param caption - Optional caption text for figure output format
 * @returns Optimized HTML element (picture, img, or figure) with responsive images
 * 
 * @example
 * ```typescript
 * // Basic usage in template
 * {% image "photo.jpg", "A beautiful landscape" %}
 * 
 * // With custom sizes
 * {% image "hero.jpg", "Hero image", "(min-width: 1024px) 50vw, 100vw" %}
 * 
 * // Figure with caption
 * {% figure "chart.png", "Sales chart", "100vw", "Q4 sales performance" %}
 * ```
 */
async function imageShortcode(
  src: string,
  alt: string = '',
  sizes: string = '(max-width: 768px) 100vw, 50vw',
  options: Required<AssetPluginOptions>,
  caption?: string
) {
  const imageOptions = {
    widths: options.imageSizes,
    formats: options.imageFormats,
    outputDir: `./_site${options.urlPath}`,
    urlPath: options.urlPath,
    filenameFormat: function (id: string, src: string, width: number, format: string) {
      const name = src.split('/').pop()?.split('.').shift() || 'image';
      return `${name}-${width}w.${format}`;
    },
    sharpOptions: {
      quality: options.imageQuality.jpeg,
      webpOptions: { quality: options.imageQuality.webp },
      avifOptions: { quality: options.imageQuality.avif },
      pngOptions: { quality: options.imageQuality.png },
    },
  };

  // Validate image exists
  const imagePath = path.isAbsolute(src) ? src : path.join(options.imageDirectory, src);
  if (!existsSync(imagePath)) {
    console.warn(`[Eleventy] Image not found: ${imagePath}`);
    const classAttr = options.className ? `class="${options.className}"` : '';
    return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" ${classAttr}><!-- Image not found: ${src} -->`;
  }

  try {
    let metadata: ImageMetadata;

    // Check cache if enabled
    if (options.enableCache) {
      const cacheKey = getCacheKey(imagePath, imageOptions);
      const cachedMetadata = getCachedMetadata(cacheKey, options.cacheDuration);

      if (cachedMetadata) {
        metadata = cachedMetadata;
      } else {
        metadata = (await Image(imagePath, imageOptions)) as unknown as ImageMetadata;
        setCachedMetadata(cacheKey, metadata);
      }
    } else {
      metadata = (await Image(imagePath, imageOptions)) as unknown as ImageMetadata;
    }

    // Generate output based on format option
    switch (options.outputFormat) {
      case 'img':
        return generateImgElement(metadata, alt, sizes, options);
      case 'figure':
        return generateFigureElement(metadata, alt, sizes, options, caption);
      case 'picture':
      default:
        return generatePictureElement(metadata, alt, sizes, options);
    }
  } catch (error) {
    console.error(`Error processing image ${imagePath}:`, error);
    const classAttr = options.className ? `class="${options.className}"` : '';
    return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" ${classAttr}>`;
  }
}

/**
 * Font preload helper
 * @param fontPath The path to the font file
 * @param fontFormat The format of the font
 * @param crossorigin Whether to include the crossorigin attribute
 * @returns HTML link element for font preloading
 */
function fontPreloadShortcode(fontPath: string, fontFormat: string = 'woff2', crossorigin: boolean = true) {
  const crossoriginAttr = crossorigin ? 'crossorigin="anonymous"' : '';
  return `<link rel="preload" href="${fontPath}" as="font" type="font/${fontFormat}" ${crossoriginAttr}>`;
}

/**
 * Critical CSS inlining shortcode
 * @deprecated This shortcode is deprecated and will be removed in a future version.
 * For critical CSS, consider using inline styles or a build-time CSS optimization tool.
 * @param cssPath The path to the CSS file
 * @returns HTML link element for CSS
 */
function criticalCSSShortcode(cssPath: string) {
  console.warn(
    '[Eleventy] criticalCSS shortcode is deprecated. Consider using inline styles or build-time CSS optimization.'
  );
  return `<link rel="stylesheet" href="${cssPath}">`;
}

/**
 * Clears the metadata cache
 */
export function clearImageCache(): void {
  metadataCache.clear();
}

/**
 * Gets the current cache size
 * @returns The number of cached entries
 */
export function getCacheSize(): number {
  return metadataCache.size;
}

/**
 * Asset pipeline plugin for Anglesite 11ty that provides optimized image processing and asset management
 * 
 * This plugin adds several shortcodes for working with images and assets:
 * - `image`: Generates responsive picture elements with multiple formats
 * - `img`: Generates simple img elements with srcset
 * - `figure`: Generates figure elements with picture and caption
 * - `fontPreload`: Generates font preload link elements
 * - `criticalCSS`: Generates CSS link elements (deprecated)
 * 
 * Features:
 * - Automatic image optimization and format conversion
 * - Responsive image generation with multiple sizes
 * - In-memory metadata caching for performance
 * - Image existence validation
 * - Configurable output formats and quality settings
 * - Static asset copying
 * 
 * @param eleventyConfig - The Eleventy configuration object to modify
 * @param options - Plugin configuration options (optional, uses defaults if not provided)
 * 
 * @example
 * ```typescript
 * // Basic setup
 * eleventyConfig.addPlugin(addAssetPipeline);
 * 
 * // With custom options
 * eleventyConfig.addPlugin(addAssetPipeline, {
 *   imageFormats: ['webp', 'jpeg'],
 *   imageSizes: [400, 800, 1200],
 *   imageQuality: { jpeg: 90, webp: 85 },
 *   outputFormat: 'img',
 *   enableCache: true
 * });
 * ```
 */
export default function addAssetPipeline(eleventyConfig: EleventyConfig, options: AssetPluginOptions = {}) {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Add image shortcodes with proper typing
  eleventyConfig.addShortcode('image', async function (...args: unknown[]) {
    const [src, alt, sizes, caption] = args as [string, string?, string?, string?];
    return await imageShortcode(src, alt, sizes, mergedOptions, caption);
  });

  // Add alternative shortcodes for specific output formats
  eleventyConfig.addShortcode('img', async function (...args: unknown[]) {
    const [src, alt, sizes] = args as [string, string?, string?];
    const imgOptions = { ...mergedOptions, outputFormat: 'img' as const };
    return await imageShortcode(src, alt, sizes, imgOptions);
  });

  eleventyConfig.addShortcode('figure', async function (...args: unknown[]) {
    const [src, alt, sizes, caption] = args as [string, string?, string?, string?];
    const figureOptions = { ...mergedOptions, outputFormat: 'figure' as const };
    return await imageShortcode(src, alt, sizes, figureOptions, caption);
  });

  // Add font and CSS shortcodes
  eleventyConfig.addShortcode('fontPreload', (...args: unknown[]) => {
    const [fontPath, fontFormat, crossorigin] = args as [string, string?, boolean?];
    return fontPreloadShortcode(fontPath, fontFormat, crossorigin);
  });

  // Add deprecated criticalCSS shortcode for backwards compatibility
  eleventyConfig.addShortcode('criticalCSS', (...args: unknown[]) => {
    const [cssPath] = args as [string];
    return criticalCSSShortcode(cssPath);
  });

  // Clear cache on build start
  eleventyConfig.on('eleventy.before', () => {
    if (mergedOptions.enableCache) {
      clearImageCache();
    }
  });

  // Copy static assets
  eleventyConfig.addPassthroughCopy(mergedOptions.passthroughCopy);
}
