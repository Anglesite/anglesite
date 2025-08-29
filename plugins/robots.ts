import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

/**
 * Generates a robots.txt file based on the website configuration.
 * @see https://www.robotstxt.org/
 * @param website The website configuration object.
 * @returns The contents of the robots.txt file.
 */
export function generateRobotsTxt(website: AnglesiteWebsiteConfiguration): string {
  if (!website) {
    return '';
  }

  let robotsTxt = '';

  // Process robots rules if they exist
  if (website.robots && website.robots.length > 0) {
    for (const rule of website.robots) {
      if ('User-agent' in rule) {
        robotsTxt += `User-agent: ${rule['User-agent']}\n`;
        if (rule.Allow) {
          const allowPaths = Array.isArray(rule.Allow) ? rule.Allow : [rule.Allow];
          for (const path of allowPaths) {
            robotsTxt += `Allow: ${path}\n`;
          }
        }
        if (rule.Disallow) {
          const disallowPaths = Array.isArray(rule.Disallow) ? rule.Disallow : [rule.Disallow];
          for (const path of disallowPaths) {
            robotsTxt += `Disallow: ${path}\n`;
          }
        }
        if (rule['Crawl-delay'] !== undefined) {
          robotsTxt += `Crawl-delay: ${rule['Crawl-delay']}\n`;
        }
        robotsTxt += '\n';
      }
    }
  } else {
    // If no robots rules are defined, add a default "allow all" rule
    robotsTxt += 'User-agent: *\n';
    robotsTxt += 'Disallow:\n\n';
  }

  // Add sitemap reference if sitemap generation is enabled and website URL is provided
  const isSitemapEnabled =
    website.sitemap && (typeof website.sitemap === 'boolean' ? website.sitemap : website.sitemap.enabled !== false);
  if (isSitemapEnabled && website.url) {
    const sitemapFilename =
      typeof website.sitemap === 'object' && website.sitemap.indexFilename
        ? website.sitemap.indexFilename
        : 'sitemap.xml';
    const sitemapUrl = new URL(sitemapFilename, website.url).href;
    robotsTxt += `Sitemap: ${sitemapUrl}\n`;
  }

  return robotsTxt;
}

/**
 * Adds a plugin for generating a robots.txt file.
 * Uses Eleventy's data cascade to access website configuration.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addRobotsTxt(eleventyConfig: EleventyConfig): void {
  // Create robots.txt file during the build process
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
        console.warn('[Eleventy] Robots plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      console.warn('[Eleventy] Robots plugin: No website configuration found');
      return;
    }

    const robotsTxtContent = generateRobotsTxt(websiteConfig);

    if (robotsTxtContent.trim()) {
      const outputPath = path.join(dir.output, 'robots.txt');
      try {
        // Ensure output directory exists
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, robotsTxtContent);
        console.log(`[Eleventy] Wrote ${outputPath}`);
      } catch (error) {
        console.error(
          `[Eleventy] Failed to write robots.txt: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}
