import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

/**
 * Generates a web app manifest based on the website configuration.
 * @see https://developer.mozilla.org/en-US/docs/Web/Manifest
 * @param website The website configuration object.
 * @returns The JSON string for the manifest file.
 */
export function generateWebManifest(website: AnglesiteWebsiteConfiguration): string {
  if (!website) {
    return '{}';
  }

  const manifest: Record<string, unknown> = {
    name: website.manifest?.name || website.title,
    start_url: '/',
    display: website.manifest?.display || 'standalone',
    scope: '/',
  };

  if (website.manifest?.short_name || website.title.length <= 12) {
    manifest.short_name = website.manifest?.short_name || website.title;
  } else {
    const words = website.title.split(' ');
    if (words.length > 1) {
      manifest.short_name = words
        .map((word) => word.charAt(0))
        .join('')
        .substring(0, 12);
    } else {
      manifest.short_name = website.title.substring(0, 12);
    }
  }

  if (website.description) {
    manifest.description = website.description;
  }

  if (website.language) {
    manifest.lang = website.language;
  }

  if (website.url) {
    manifest.id = website.url;
  }

  if (website.manifest?.theme_color) {
    manifest.theme_color = website.manifest.theme_color;
  }

  if (website.manifest?.background_color) {
    manifest.background_color = website.manifest.background_color;
  }

  if (website.manifest?.orientation) {
    manifest.orientation = website.manifest.orientation;
  }

  const icons: Array<{
    src: string;
    sizes: string;
    type: string;
    purpose?: string;
  }> = [];

  if (website.favicon?.png) {
    Object.entries(website.favicon.png).forEach(([size, path]) => {
      const numericSize = parseInt(size, 10);
      if (!isNaN(numericSize) && numericSize >= 48) {
        icons.push({
          src: path,
          sizes: `${size}x${size}`,
          type: 'image/png',
        });
      }
    });
  }

  if (website.favicon?.svg) {
    icons.push({
      src: website.favicon.svg,
      sizes: 'any',
      type: 'image/svg+xml',
    });
  }

  if (website.favicon?.appleTouchIcon) {
    icons.push({
      src: website.favicon.appleTouchIcon,
      sizes: '180x180',
      type: 'image/png',
      purpose: 'any maskable',
    });
  }

  if (icons.length > 0) {
    manifest.icons = icons.sort((a, b) => {
      const getSortOrder = (icon: { type: string; sizes: string }) => {
        if (icon.type === 'image/svg+xml') return 0;
        const size = parseInt(icon.sizes.split('x')[0], 10);
        return isNaN(size) ? 999 : size;
      };
      return getSortOrder(a) - getSortOrder(b);
    });
  }

  return JSON.stringify(manifest, null, 2);
}

/**
 * Adds a plugin for generating a web app manifest file.
 * Uses Eleventy's data cascade to access website configuration.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addWebManifest(eleventyConfig: EleventyConfig): void {
  // Create manifest.webmanifest file during the build process
  eleventyConfig.on('eleventy.after', async ({ dir, results }) => {
    if (!results || results.length === 0) {
      return;
    }

    // Try to get website configuration from page data first (for tests)
    // Then fallback to reading from filesystem (for real builds)
    let websiteConfig: AnglesiteWebsiteConfiguration | undefined;

    // Check if the first result has data property (test scenario)
    const firstResult = results[0] as { data?: EleventyData };
    if (firstResult?.data) {
      websiteConfig = firstResult.data.website;
    } else {
      // Real Eleventy build scenario - read from filesystem
      try {
        const websiteDataPath = path.resolve('src', '_data', 'website.json');
        const websiteData = await fs.promises.readFile(websiteDataPath, 'utf-8');
        websiteConfig = JSON.parse(websiteData) as AnglesiteWebsiteConfiguration;
      } catch {
        console.warn('[@dwk/anglesite-11ty] WebManifest plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      console.warn('[@dwk/anglesite-11ty] WebManifest plugin: No website configuration found');
      return;
    }

    const manifestContent = generateWebManifest(websiteConfig);

    const outputPath = path.join(dir.output, 'manifest.webmanifest');
    try {
      // Ensure output directory exists
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, manifestContent);
      console.log(`[@dwk/anglesite-11ty] Wrote ${outputPath}`);
    } catch (error) {
      console.error(
        `[@dwk/anglesite-11ty] Failed to write manifest.webmanifest: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
