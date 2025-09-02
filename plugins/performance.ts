// ABOUTME: Performance optimization plugin for Anglesite 11ty
// ABOUTME: Provides CSS/JS minification, critical CSS inlining, and performance transforms

import { EleventyConfig } from '@11ty/eleventy';
import { minify as minifyHTML } from 'html-minifier-terser';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

/**
 * Configuration options for the performance plugin
 */
interface PerformancePluginOptions {
  /** Enable HTML minification (default: true) */
  minifyHTML?: boolean;
  /** HTML minifier options */
  htmlMinifierOptions?: Record<string, unknown>;
  /** Enable CSS minification (default: true) */
  minifyCSS?: boolean;
  /** Enable JS minification (default: true) */
  minifyJS?: boolean;
  /** Enable critical CSS inlining (default: true) */
  inlineCriticalCSS?: boolean;
  /** Maximum size for critical CSS inlining in bytes (default: 8192) */
  criticalCSSMaxSize?: number;
  /** Enable resource hints generation (default: true) */
  generateResourceHints?: boolean;
  /** Enable async/defer script optimization (default: true) */
  optimizeScripts?: boolean;
  /** Enable lazy loading for iframes and fallback images (default: true) */
  enableLazyLoading?: boolean;
  /** Output directory for generated assets (default: '_site') */
  outputDir?: string;
  /** Enable performance budget warnings (default: false) */
  performanceBudget?: boolean;
  /** Performance budget thresholds */
  budgetThresholds?: {
    /** Max CSS size in KB (default: 100) */
    maxCSSSize?: number;
    /** Max JS size in KB (default: 200) */
    maxJSSize?: number;
    /** Max image count per page (default: 50) */
    maxImages?: number;
  };
}

/**
 * Default configuration options for the performance plugin
 */
const DEFAULT_OPTIONS: Required<PerformancePluginOptions> = {
  minifyHTML: true,
  htmlMinifierOptions: {
    removeAttributeQuotes: true,
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    removeComments: true,
    sortClassName: true,
    sortAttributes: true,
    html5: true,
    decodeEntities: true,
    removeOptionalTags: false,
    minifyCSS: true,
    minifyJS: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
  },
  minifyCSS: true,
  minifyJS: true,
  inlineCriticalCSS: true,
  criticalCSSMaxSize: 8192, // 8KB
  generateResourceHints: true,
  optimizeScripts: true,
  enableLazyLoading: true,
  outputDir: '_site',
  performanceBudget: false,
  budgetThresholds: {
    maxCSSSize: 100, // 100KB
    maxJSSize: 200, // 200KB
    maxImages: 50,
  },
};

/**
 * Cache for storing minified content to avoid re-processing
 */
const minificationCache = new Map<string, string>();

/**
 * Generates a cache key for content based on hash
 * @param content - The content to generate a key for
 * @param options - Options used in caching
 * @returns MD5 hash key for cache
 */
function getCacheKey(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Extracts all external CSS files from HTML content
 * @param content - The HTML content to parse
 * @returns Array of CSS file URLs
 */
function extractCSSFiles(content: string): string[] {
  const cssRegex = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g;
  const cssFiles: string[] = [];
  let match;

  while ((match = cssRegex.exec(content)) !== null) {
    cssFiles.push(match[1]);
  }

  return cssFiles;
}

/**
 * Extracts all external JS files from HTML content
 * @param content - The HTML content to parse
 * @returns Array of JavaScript file URLs
 */
function extractJSFiles(content: string): string[] {
  const jsRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/g;
  const jsFiles: string[] = [];
  let match;

  while ((match = jsRegex.exec(content)) !== null) {
    jsFiles.push(match[1]);
  }

  return jsFiles;
}

/**
 * Basic CSS minification function
 * @param css - The CSS content to minify
 * @returns Minified CSS content
 */
function minifyCSS(css: string): string {
  const cacheKey = getCacheKey(css);
  if (minificationCache.has(cacheKey)) {
    return minificationCache.get(cacheKey)!;
  }

  const minified = css
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/;\s*}/g, '}') // Remove last semicolon in rules
    .replace(/,\s+/g, ',') // Remove space after commas
    .replace(/:\s+/g, ':') // Remove space after colons
    .replace(/{\s+/g, '{') // Remove space after opening braces
    .replace(/}\s+/g, '}') // Remove space after closing braces
    .replace(/\s+{/g, '{') // Remove space before opening braces
    .replace(/;\s+/g, ';') // Remove space after semicolons
    .trim();

  minificationCache.set(cacheKey, minified);
  return minified;
}

/**
 * Basic JS minification function (removes comments and excess whitespace)
 * @param js - The JavaScript content to minify
 * @returns Minified JavaScript content
 */
function minifyJS(js: string): string {
  const cacheKey = getCacheKey(js);
  if (minificationCache.has(cacheKey)) {
    return minificationCache.get(cacheKey)!;
  }

  const minified = js
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/;\s*}/g, '}') // Clean up semicolons
    .trim();

  minificationCache.set(cacheKey, minified);
  return minified;
}

/**
 * Inlines critical CSS by reading CSS files and inlining small ones
 * @param content - The HTML content to process
 * @param outputDir - The output directory containing CSS files
 * @param maxSize - Maximum size for CSS files to inline
 * @returns Modified HTML content with inlined CSS
 */
function inlineCriticalCSS(content: string, outputDir: string, maxSize: number): string {
  const cssFiles = extractCSSFiles(content);
  let modifiedContent = content;

  for (const cssFile of cssFiles) {
    // Skip external URLs
    if (cssFile.startsWith('http://') || cssFile.startsWith('https://')) {
      continue;
    }

    const cssPath = join(outputDir, cssFile.startsWith('/') ? cssFile.slice(1) : cssFile);

    if (existsSync(cssPath)) {
      const cssContent = readFileSync(cssPath, 'utf8');

      // Only inline if under size limit
      if (cssContent.length <= maxSize) {
        const minifiedCSS = minifyCSS(cssContent);
        const inlineStyle = `<style>${minifiedCSS}</style>`;

        // Replace the link tag with inline styles
        const linkRegex = new RegExp(
          `<link[^>]+href=["']${cssFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
          'g'
        );
        modifiedContent = modifiedContent.replace(linkRegex, inlineStyle);
      }
    }
  }

  return modifiedContent;
}

/**
 * Generates resource hints for external resources
 * @param content - The HTML content to process
 * @returns Modified HTML content with resource hints
 */
function generateResourceHints(content: string): string {
  const hints: string[] = [];
  const cssFiles = extractCSSFiles(content);
  const jsFiles = extractJSFiles(content);

  // Add preload hints for critical CSS (first few CSS files)
  cssFiles.slice(0, 2).forEach((cssFile) => {
    if (!cssFile.startsWith('http')) {
      hints.push(`<link rel="preload" href="${cssFile}" as="style">`);
    }
  });

  // Add preload hints for critical JS (first JS file)
  if (jsFiles.length > 0 && !jsFiles[0].startsWith('http')) {
    hints.push(`<link rel="preload" href="${jsFiles[0]}" as="script">`);
  }

  if (hints.length > 0) {
    const hintsHTML = hints.join('\n  ');
    return content.replace('</head>', `  ${hintsHTML}\n</head>`);
  }

  return content;
}

/**
 * Optimizes script tags by adding async/defer attributes appropriately
 * @param content - The HTML content to process
 * @returns Modified HTML content with optimized script tags
 */
function optimizeScripts(content: string): string {
  // Add defer to non-inline scripts that don't already have async/defer
  return content.replace(/<script([^>]*)src=(["'][^"']+["'])([^>]*?)(?!.*(?:async|defer))>/g, (match, before, src, after) => {
    // Check if async or defer is already present in the full match
    if (match.includes('async') || match.includes('defer')) {
      return match;
    }
    return `<script${before}src=${src}${after} defer>`;
  });
}

/**
 * Adds lazy loading to iframes and other resources
 * @param content - The HTML content to process
 * @returns Modified HTML content with lazy loading attributes
 */
function addLazyLoading(content: string): string {
  let optimizedContent = content;

  // Add loading="lazy" to iframes that don't already have it
  optimizedContent = optimizedContent.replace(/<iframe([^>]*)(?!.*loading=)>/g, (match, attrs) => {
    if (match.includes('loading=')) {
      return match;
    }
    return `<iframe${attrs} loading="lazy">`;
  });

  // Add loading="lazy" to img tags that don't already have it (backup for non-processed images)
  optimizedContent = optimizedContent.replace(/<img([^>]*)(?!.*loading=)>/g, (match, attrs) => {
    if (match.includes('loading=')) {
      return match;
    }
    return `<img${attrs} loading="lazy">`;
  });

  return optimizedContent;
}

/**
 * Checks performance budget and logs warnings
 * @param content - The HTML content to analyze
 * @param outputDir - The output directory containing assets
 * @param thresholds - Performance budget thresholds
 */
function checkPerformanceBudget(
  content: string,
  outputDir: string,
  thresholds: Required<PerformancePluginOptions>['budgetThresholds']
): void {
  const cssFiles = extractCSSFiles(content);
  const jsFiles = extractJSFiles(content);
  const images = content.match(/<img[^>]+>/g) || [];

  // Check CSS size
  let totalCSSSize = 0;
  cssFiles.forEach((cssFile) => {
    if (!cssFile.startsWith('http')) {
      const cssPath = join(outputDir, cssFile.startsWith('/') ? cssFile.slice(1) : cssFile);
      if (existsSync(cssPath)) {
        const stats = require('fs').statSync(cssPath); // eslint-disable-line @typescript-eslint/no-require-imports
        totalCSSSize += stats.size;
      }
    }
  });

  if (totalCSSSize > (thresholds.maxCSSSize || 100) * 1024) {
    console.warn(
      `[@dwk/anglesite-11ty] Performance Budget Warning: CSS size (${Math.round(totalCSSSize / 1024)}KB) exceeds threshold (${thresholds.maxCSSSize || 100}KB)`
    );
  }

  // Check JS size
  let totalJSSize = 0;
  jsFiles.forEach((jsFile) => {
    if (!jsFile.startsWith('http')) {
      const jsPath = join(outputDir, jsFile.startsWith('/') ? jsFile.slice(1) : jsFile);
      if (existsSync(jsPath)) {
        const stats = require('fs').statSync(jsPath); // eslint-disable-line @typescript-eslint/no-require-imports
        totalJSSize += stats.size;
      }
    }
  });

  if (totalJSSize > (thresholds.maxJSSize || 200) * 1024) {
    console.warn(
      `[@dwk/anglesite-11ty] Performance Budget Warning: JS size (${Math.round(totalJSSize / 1024)}KB) exceeds threshold (${thresholds.maxJSSize || 200}KB)`
    );
  }

  // Check image count
  if (images.length > (thresholds.maxImages || 50)) {
    console.warn(
      `[@dwk/anglesite-11ty] Performance Budget Warning: Image count (${images.length}) exceeds threshold (${thresholds.maxImages || 50})`
    );
  }
}

/**
 * Clears the minification cache
 */
export function clearMinificationCache(): void {
  minificationCache.clear();
}

/**
 * Gets the current cache size
 * @returns The number of cached entries
 */
export function getCacheSize(): number {
  return minificationCache.size;
}

/**
 * Performance optimization plugin for Anglesite 11ty
 *
 * This plugin provides comprehensive performance optimizations including:
 * - HTML minification with configurable options
 * - CSS minification and critical CSS inlining
 * - JavaScript minification
 * - Resource hints generation (preload/prefetch)
 * - Script optimization (async/defer)
 * - Performance budget monitoring
 * @param eleventyConfig - The Eleventy configuration object
 * @param options - Plugin configuration options
 */
export default function addPerformanceOptimization(
  eleventyConfig: EleventyConfig,
  options: PerformancePluginOptions = {}
) {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Add HTML transform for comprehensive performance optimization
  eleventyConfig.addTransform('performance-optimization', function (...args: unknown[]) {
    const [content, outputPath] = args as [string, string];
    // Only process HTML files
    if (!outputPath || !outputPath.endsWith('.html')) {
      return content;
    }

    let optimizedContent = content;

    try {
      // 1. Inline critical CSS
      if (mergedOptions.inlineCriticalCSS) {
        optimizedContent = inlineCriticalCSS(
          optimizedContent,
          mergedOptions.outputDir,
          mergedOptions.criticalCSSMaxSize
        );
      }

      // 2. Generate resource hints
      if (mergedOptions.generateResourceHints) {
        optimizedContent = generateResourceHints(optimizedContent);
      }

      // 3. Optimize scripts
      if (mergedOptions.optimizeScripts) {
        optimizedContent = optimizeScripts(optimizedContent);
      }

      // 4. Add lazy loading to additional resources
      if (mergedOptions.enableLazyLoading) {
        optimizedContent = addLazyLoading(optimizedContent);
      }

      // 5. Check performance budget
      if (mergedOptions.performanceBudget) {
        checkPerformanceBudget(optimizedContent, mergedOptions.outputDir, mergedOptions.budgetThresholds);
      }

      // 6. Minify HTML (do this last to preserve other transformations)
      if (mergedOptions.minifyHTML) {
        optimizedContent = minifyHTML(optimizedContent, mergedOptions.htmlMinifierOptions);
      }

      return optimizedContent;
    } catch (error) {
      console.warn(`[@dwk/anglesite-11ty] Performance optimization failed for ${outputPath}:`, error);
      return content; // Return original content on error
    }
  });

  // Add shortcode for inline CSS minification
  eleventyConfig.addShortcode('inlineCSS', function (...args: unknown[]) {
    const [cssPath] = args as [string];
    try {
      const fullPath = join(mergedOptions.outputDir, cssPath.startsWith('/') ? cssPath.slice(1) : cssPath);
      if (existsSync(fullPath)) {
        const cssContent = readFileSync(fullPath, 'utf8');
        const minified = mergedOptions.minifyCSS ? minifyCSS(cssContent) : cssContent;
        return `<style>${minified}</style>`;
      } else {
        console.warn(`[@dwk/anglesite-11ty] CSS file not found for inlining: ${fullPath}`);
        return `<link rel="stylesheet" href="${cssPath}">`;
      }
    } catch (error) {
      console.warn(`[@dwk/anglesite-11ty] Error inlining CSS ${cssPath}:`, error);
      return `<link rel="stylesheet" href="${cssPath}">`;
    }
  });

  // Add shortcode for inline JS minification
  eleventyConfig.addShortcode('inlineJS', function (...args: unknown[]) {
    const [jsPath] = args as [string];
    try {
      const fullPath = join(mergedOptions.outputDir, jsPath.startsWith('/') ? jsPath.slice(1) : jsPath);
      if (existsSync(fullPath)) {
        const jsContent = readFileSync(fullPath, 'utf8');
        const minified = mergedOptions.minifyJS ? minifyJS(jsContent) : jsContent;
        return `<script>${minified}</script>`;
      } else {
        console.warn(`[@dwk/anglesite-11ty] JS file not found for inlining: ${fullPath}`);
        return `<script src="${jsPath}"></script>`;
      }
    } catch (error) {
      console.warn(`[@dwk/anglesite-11ty] Error inlining JS ${jsPath}:`, error);
      return `<script src="${jsPath}"></script>`;
    }
  });

  // Clear cache on build start
  eleventyConfig.on('eleventy.before', () => {
    clearMinificationCache();
  });

  // Log performance stats after build
  eleventyConfig.on('eleventy.after', () => {
    console.log(`[@dwk/anglesite-11ty] Performance optimization complete. Cache entries: ${getCacheSize()}`);
  });
}
