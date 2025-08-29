import { mkdirSync, writeFileSync, existsSync } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

/**
 * Eleventy data structure containing website configuration
 * @internal
 */
interface EleventyData {
  /** Website configuration from data cascade */
  website: AnglesiteWebsiteConfiguration;
}

/**
 * Escapes special characters for safe XML output to prevent XML injection
 *
 * @param unsafe - The potentially unsafe string to escape
 * @returns XML-safe string with escaped entities
 *
 * @example
 * ```typescript
 * escapeXml('AT&T <Company>') // Returns: 'AT&amp;T &lt;Company&gt;'
 * ```
 */
function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Validates a hex color format for Microsoft tile colors
 *
 * Supports both 3-digit and 6-digit hex color codes as per CSS standards.
 *
 * @param color - The color string to validate (e.g., '#ff0000' or '#f00')
 * @returns True if the color is a valid hex format, false otherwise
 *
 * @example
 * ```typescript
 * isValidHexColor('#ff0000') // Returns: true
 * isValidHexColor('#f00')    // Returns: true
 * isValidHexColor('red')     // Returns: false
 * isValidHexColor('#gggggg') // Returns: false
 * ```
 */
function isValidHexColor(color: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
}

/**
 * Validates that a tile image file exists on the filesystem
 *
 * Handles both absolute and relative paths. Relative paths are resolved from
 * the project root 'src' directory. Logs a warning if the image is not found.
 *
 * @param imagePath - The path to the image file (relative or absolute)
 * @returns True if the image file exists, false otherwise
 *
 * @example
 * ```typescript
 * validateImagePath('/assets/images/tile.png')     // Absolute path
 * validateImagePath('assets/images/tile.png')      // Relative to src/
 * validateImagePath('./src/assets/tile.png')       // Relative to project root
 * ```
 */
function validateImagePath(imagePath: string): boolean {
  if (!imagePath) return false;

  // Handle paths - treat web paths (starting with /) as relative to src directory
  const fullPath =
    path.isAbsolute(imagePath) && !imagePath.startsWith('/')
      ? imagePath
      : path.join(process.cwd(), 'src', imagePath.replace(/^\//, ''));

  const exists = existsSync(fullPath);
  if (!exists) {
    console.warn(`[@dwk/anglesite-11ty] BrowserConfig: Image not found: ${fullPath}`);
  }
  return exists;
}

/**
 * Generates the browserconfig.xml content for Windows tile configuration
 *
 * Creates an XML document that defines how Windows should display the website
 * when pinned to the Start screen or taskbar. Validates all input data including
 * tile colors and image paths before including them in the output.
 *
 * @param website - The website configuration object containing browserconfig settings
 * @returns XML string for browserconfig.xml file, or empty string if disabled/invalid
 *
 * @see {@link https://docs.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/platform-apis/dn320426(v=vs.85) | Microsoft browserconfig.xml Documentation}
 *
 * @example
 * ```typescript
 * const websiteConfig = {
 *   browserconfig: {
 *     enabled: true,
 *     tile: {
 *       square150x150logo: '/assets/tile-medium.png',
 *       TileColor: '#da532c'
 *     }
 *   }
 * };
 *
 * const xml = generateBrowserConfig(websiteConfig);
 * // Returns:
 * // <?xml version="1.0" encoding="utf-8"?>
 * // <browserconfig>
 * //   <msapplication>
 * //     <tile>
 * //       <square150x150logo src="/assets/tile-medium.png"/>
 * //       <TileColor>#da532c</TileColor>
 * //     </tile>
 * //   </msapplication>
 * // </browserconfig>
 * ```
 */
export function generateBrowserConfig(website: AnglesiteWebsiteConfiguration): string {
  if (!website?.browserconfig?.enabled) {
    return '';
  }

  const config = website.browserconfig;
  const tile = config.tile;

  if (!tile) {
    return '';
  }

  // Validate TileColor format at runtime
  if (tile.TileColor && !isValidHexColor(tile.TileColor)) {
    console.warn(
      `[@dwk/anglesite-11ty] BrowserConfig: Invalid TileColor format: ${tile.TileColor}. Expected hex color (e.g., #ff0000).`
    );
    return '';
  }

  const xmlParts: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<browserconfig>',
    '  <msapplication>',
    '    <tile>',
  ];

  if (tile.square70x70logo && validateImagePath(tile.square70x70logo)) {
    xmlParts.push(`      <square70x70logo src="${escapeXml(tile.square70x70logo)}"/>`);
  }
  if (tile.square150x150logo && validateImagePath(tile.square150x150logo)) {
    xmlParts.push(`      <square150x150logo src="${escapeXml(tile.square150x150logo)}"/>`);
  }
  if (tile.wide310x150logo && validateImagePath(tile.wide310x150logo)) {
    xmlParts.push(`      <wide310x150logo src="${escapeXml(tile.wide310x150logo)}"/>`);
  }
  if (tile.square310x310logo && validateImagePath(tile.square310x310logo)) {
    xmlParts.push(`      <square310x310logo src="${escapeXml(tile.square310x310logo)}"/>`);
  }
  if (tile.TileColor) {
    xmlParts.push(`      <TileColor>${escapeXml(tile.TileColor)}</TileColor>`);
  }

  xmlParts.push('    </tile>', '  </msapplication>', '</browserconfig>');

  return xmlParts.join('\n');
}

/**
 * Eleventy plugin that generates a .well-known/browserconfig.xml file for Windows tile configuration
 *
 * This plugin hooks into the 'eleventy.after' event to process website configuration data
 * from Eleventy's data cascade and generate the browserconfig.xml file if enabled.
 *
 * The plugin will:
 * - Search through all build results to find website configuration data
 * - Validate tile image paths and color formats
 * - Generate valid XML only if browserconfig is enabled and properly configured
 * - Write the file to the .well-known directory in the output folder
 * - Log success/error messages for debugging
 *
 * Configuration is read from the website.browserconfig object in your data files.
 *
 * @param eleventyConfig - The Eleventy configuration object to modify
 *
 * @example
 * ```typescript
 * // In .eleventy.js or eleventy.config.js
 * import addBrowserConfig from './plugins/browserconfig.js';
 *
 * export default function(eleventyConfig) {
 *   eleventyConfig.addPlugin(addBrowserConfig);
 * }
 * ```
 *
 * @example
 * ```json
 * // In src/_data/website.json
 * {
 *   "browserconfig": {
 *     "enabled": true,
 *     "tile": {
 *       "square70x70logo": "/assets/images/tile-small.png",
 *       "square150x150logo": "/assets/images/tile-medium.png",
 *       "wide310x150logo": "/assets/images/tile-wide.png",
 *       "square310x310logo": "/assets/images/tile-large.png",
 *       "TileColor": "#da532c"
 *     }
 *   }
 * }
 * ```
 */
export default function addBrowserConfig(eleventyConfig: EleventyConfig): void {
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
        console.warn('[@dwk/anglesite-11ty] BrowserConfig plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      return;
    }

    if (!websiteConfig.browserconfig?.enabled) {
      return;
    }

    const browserConfigContent = generateBrowserConfig(websiteConfig);

    if (browserConfigContent.trim()) {
      const wellKnownDir = path.join(dir.output, '.well-known');
      const outputPath = path.join(wellKnownDir, 'browserconfig.xml');

      try {
        mkdirSync(wellKnownDir, { recursive: true });
        writeFileSync(outputPath, browserConfigContent);
        console.log(`[@dwk/anglesite-11ty] Wrote ${outputPath}`);
      } catch (error) {
        console.error(
          `[@dwk/anglesite-11ty] Failed to write .well-known/browserconfig.xml: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}
