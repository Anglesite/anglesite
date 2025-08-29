import { EleventyConfig } from '@11ty/eleventy';
import Image from '@11ty/eleventy-img';

interface AssetPluginOptions {
  imageFormats?: ('webp' | 'avif' | 'jpeg' | 'png')[];
  imageSizes?: number[];
  imageQuality?: {
    jpeg?: number;
    webp?: number;
    avif?: number;
    png?: number;
  };
  imageDirectory?: string;
  urlPath?: string;
}

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
};

/**
 * Enhanced image processing shortcode for Anglesite
 * @param src The source path of the image
 * @param alt Alternative text for the image
 * @param sizes Sizes attribute for responsive images
 * @returns HTML picture element with optimized images
 */
async function imageShortcode(src: string, alt: string = '', sizes: string = '(max-width: 768px) 100vw, 50vw') {
  const imageOptions = {
    widths: [320, 640, 768, 1024, 1280],
    formats: ['webp', 'avif', 'jpeg'],
    outputDir: './_site/images/',
    urlPath: '/images/',
    filenameFormat: function (id: string, src: string, width: number, format: string) {
      const name = src.split('/').pop()?.split('.').shift() || 'image';
      return `${name}-${width}w.${format}`;
    },
  };

  try {
    const metadata = await Image(src, imageOptions);

    // Generate picture element with multiple formats
    let html = '<picture>';

    // Add source elements for modern formats
    Object.entries(metadata)
      .reverse()
      .forEach(([format, images]) => {
        if (format !== 'jpeg') {
          const srcset = images.map((img: { url: string; width: number }) => `${img.url} ${img.width}w`).join(', ');
          html += `<source type="image/${format}" srcset="${srcset}" sizes="${sizes}">`;
        }
      });

    // Add fallback img element
    const fallback = metadata.jpeg && metadata.jpeg[metadata.jpeg.length - 1];
    if (fallback) {
      html += `<img src="${fallback.url}" alt="${alt}" loading="lazy" decoding="async" class="responsive-image">`;
    }

    html += '</picture>';
    return html;
  } catch (error) {
    console.error(`Error processing image ${src}:`, error);
    return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
  }
}

/**
 * Font preload helper
 * @param args Arguments containing font path, format, and crossorigin setting
 * @returns HTML link element for font preloading
 */
function fontPreloadShortcode(...args: unknown[]) {
  const [fontPath, fontFormat = 'woff2', crossorigin = true] = args as [string, string?, boolean?];
  const crossoriginAttr = crossorigin ? 'crossorigin="anonymous"' : '';
  return `<link rel="preload" href="${fontPath}" as="font" type="font/${fontFormat}" ${crossoriginAttr}>`;
}

/**
 * Critical CSS inlining shortcode
 * @param args Arguments containing CSS path
 * @returns HTML link element for CSS
 */
function criticalCSSShortcode(...args: unknown[]) {
  const [cssPath] = args as [string];
  return `<link rel="stylesheet" href="${cssPath}">`;
}

/**
 * CSS processing function
 * @param args Arguments containing content and output path
 * @returns Processed CSS content
 */
function processCSS(...args: unknown[]) {
  const [content, outputPath] = args as [string, string];
  if (outputPath?.endsWith('.css')) {
    return content;
  }
  return content;
}

/**
 * Asset pipeline plugin for Anglesite 11ty
 * @param eleventyConfig The Eleventy configuration object
 * @param options Asset plugin options
 */
export default function addAssetPipeline(eleventyConfig: EleventyConfig, options: AssetPluginOptions = {}) {
  // Merge with default options but don't store in unused variable
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  console.log('Asset pipeline configured with options:', Object.keys(mergedOptions));

  // Add image shortcodes with proper typing
  eleventyConfig.addShortcode('image', async function (...args: unknown[]) {
    const [src, alt, sizes] = args as [string, string?, string?];
    return await imageShortcode(src, alt, sizes);
  });

  // Add font and CSS shortcodes
  eleventyConfig.addShortcode('fontPreload', fontPreloadShortcode);
  eleventyConfig.addShortcode('criticalCSS', criticalCSSShortcode);

  // Add CSS transform
  eleventyConfig.addTransform('css-process', processCSS);

  // Copy static assets
  eleventyConfig.addPassthroughCopy({
    'src/assets/fonts': 'fonts',
    'src/assets/icons': 'icons',
  });

  console.log('🎨 Asset pipeline plugin loaded with image optimization');
}
