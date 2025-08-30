// ABOUTME: This file provides a plugin for generating .well-known/gpc.json files
// ABOUTME: Following the Global Privacy Control specification for indicating GPC support
import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

interface GpcJson {
  gpc: boolean;
  lastUpdate: string;
}

/**
 * Generates a GPC JSON object based on the website configuration.
 * @see https://privacycg.github.io/gpc-spec/
 * @param website The website configuration object.
 * @returns The GPC JSON object or null if not configured.
 */
export function generateGpcJson(website: AnglesiteWebsiteConfiguration): GpcJson | null {
  if (!website || !website.gpc || !website.gpc.enabled) {
    return null;
  }

  const gpcConfig = website.gpc;
  let lastUpdate: string;

  if (gpcConfig.lastUpdate) {
    lastUpdate = gpcConfig.lastUpdate;
  } else {
    // Default to current date in YYYY-MM-DD format
    lastUpdate = new Date().toISOString().split('T')[0];
  }

  return {
    gpc: gpcConfig.gpc !== undefined ? gpcConfig.gpc : true,
    lastUpdate,
  };
}

/**
 * Adds a plugin for generating a .well-known/gpc.json file.
 * Uses Eleventy's data cascade to access website configuration.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addGpcJson(eleventyConfig: EleventyConfig): void {
  // Create .well-known/gpc.json file during the build process
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
        console.warn('[@dwk/anglesite-11ty] GPC plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      return;
    }

    const gpcJson = generateGpcJson(websiteConfig);

    if (gpcJson) {
      const wellKnownDir = path.join(dir.output, '.well-known');
      const outputPath = path.join(wellKnownDir, 'gpc.json');

      try {
        // Ensure .well-known directory exists
        fs.mkdirSync(wellKnownDir, { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(gpcJson, null, 2));
        console.log(`[@dwk/anglesite-11ty] Wrote ${outputPath}`);
      } catch (error) {
        console.error(
          `[@dwk/anglesite-11ty] Failed to write .well-known/gpc.json: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}
