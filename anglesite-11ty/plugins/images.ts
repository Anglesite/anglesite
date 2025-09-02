import Image from '@11ty/eleventy-img';
import type { EleventyConfig } from '../types/config.js';

export interface ImageOptions {
  /** Output directory for processed images relative to output folder */
  outputDir?: string;
  /** URL path for processed images */
  urlPath?: string;
  /** Default image formats to generate */
  formats?: ('avif' | 'webp' | 'jpeg' | 'png' | 'svg' | 'auto')[];
  /** Default image widths to generate */
  widths?: number[];
  /** Enable automatic lazy loading */
  loading?: 'lazy' | 'eager' | 'auto';
  /** Enable automatic decoding hint */
  decoding?: 'sync' | 'async' | 'auto';
}

/**
 * Adds image optimization functionality using @11ty/eleventy-img.
 * Provides shortcodes for responsive images with automatic format conversion,
 * resizing, and optimization.
 *
 * Generated shortcodes:
 * - {% image src, alt, sizes %}: Generate responsive image with picture element
 * - {% imageUrl src, width, format %}: Get optimized image URL for a specific size/format
 *
 * Features:
 * - Automatic format conversion (AVIF, WebP, JPEG fallbacks)
 * - Responsive image generation with multiple sizes
 * - Lazy loading support
 * - SEO-friendly alt text handling
 * - Caching for build performance
 * @param eleventyConfig The Eleventy configuration object.
 * @param options Configuration options for image processing.
 */
export default function addImages(eleventyConfig: EleventyConfig, options: ImageOptions = {}): void {
  const {
    outputDir = 'img/',
    urlPath = '/img/',
    formats = ['avif', 'webp', 'jpeg'],
    widths = [300, 600, 1200],
    loading = 'lazy',
    decoding = 'async',
  } = options;

  // Check if async shortcodes are supported (Eleventy 1.0+)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configWithAsync = eleventyConfig as any;
  if (!configWithAsync.addAsyncShortcode) {
    console.warn('[Anglesite Images] addAsyncShortcode not available. Image plugin requires Eleventy 1.0 or higher.');
    return;
  }

  // Async shortcode for responsive images with picture element
  configWithAsync.addAsyncShortcode('image', async function (src: string, alt: string, sizes = '100vw') {
    if (!src) {
      throw new Error('Image shortcode requires a src parameter');
    }

    if (!alt) {
      throw new Error(`Image shortcode requires an alt parameter for accessibility: ${src}`);
    }

    const metadata = await Image(src, {
      widths,
      formats,
      outputDir: eleventyConfig.dir?.output ? `${eleventyConfig.dir.output}/${outputDir}` : `_site/${outputDir}`,
      urlPath,
      filenameFormat: function (id: string, src: string, width: number, format: string): string {
        return `${id}-${width}w.${format}`;
      },
    });

    const imageAttributes = {
      alt,
      sizes,
      loading,
      decoding,
    };

    // Use a type assertion since the Image.generateHTML method is not properly typed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (Image as any).generateHTML(metadata, imageAttributes);
  });

  // Async shortcode to get a single optimized image URL
  configWithAsync.addAsyncShortcode(
    'imageUrl',
    async function (src: string, width = 600, format: 'avif' | 'webp' | 'jpeg' | 'png' = 'webp') {
      if (!src) {
        throw new Error('ImageUrl shortcode requires a src parameter');
      }

      const metadata = await Image(src, {
        widths: [width],
        formats: [format],
        outputDir: eleventyConfig.dir?.output ? `${eleventyConfig.dir.output}/${outputDir}` : `_site/${outputDir}`,
        urlPath,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (metadata as any)[format]?.[0]?.url || '';
    }
  );

  // Synchronous shortcode to generate image metadata (useful for JSON-LD, etc.)
  configWithAsync.addAsyncShortcode('imageMetadata', async function (src: string) {
    if (!src) {
      throw new Error('ImageMetadata shortcode requires a src parameter');
    }

    const metadata = await Image(src, {
      widths: [widths[0]], // Just get one size for metadata
      formats: ['jpeg'], // Use JPEG for reliable metadata
      outputDir: eleventyConfig.dir?.output ? `${eleventyConfig.dir.output}/${outputDir}` : `_site/${outputDir}`,
      urlPath,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageData = (metadata as any).jpeg?.[0];
    if (!imageData) {
      return null;
    }

    return {
      url: imageData.url,
      width: imageData.width,
      height: imageData.height,
      format: 'jpeg',
      size: imageData.size || 0,
    };
  });
}
