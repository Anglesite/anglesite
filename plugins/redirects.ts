import { promises as fs } from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

type RedirectRule = NonNullable<AnglesiteWebsiteConfiguration['redirects']>[number];

/**
 * Valid CloudFlare redirect status codes
 */
const VALID_REDIRECT_CODES = [301, 302, 303, 307, 308] as const;

/**
 * CloudFlare redirects limits
 */
const CLOUDFLARE_LIMITS = {
  MAX_TOTAL_REDIRECTS: 2100,
  MAX_STATIC_REDIRECTS: 2000,
  MAX_DYNAMIC_REDIRECTS: 100,
  MAX_REDIRECT_LENGTH: 1000,
} as const;

/**
 * Validates a redirect rule for CloudFlare compliance
 * @param redirect The redirect rule to validate
 * @returns Array of validation errors, empty if valid
 */
function validateRedirectRule(redirect: RedirectRule): string[] {
  const errors: string[] = [];

  // Validate source path
  if (!redirect.source.startsWith('/')) {
    errors.push(`Source path must start with '/': ${redirect.source}`);
  }

  // Validate redirect code
  if (redirect.code && !VALID_REDIRECT_CODES.includes(redirect.code as (typeof VALID_REDIRECT_CODES)[number])) {
    errors.push(`Invalid redirect code: ${redirect.code}. Must be one of: ${VALID_REDIRECT_CODES.join(', ')}`);
  }

  // Validate URL length
  const redirectLine = `${redirect.source} ${redirect.destination} ${redirect.code || 301}${redirect.force ? '!' : ''}`;
  if (redirectLine.length > CLOUDFLARE_LIMITS.MAX_REDIRECT_LENGTH) {
    errors.push(
      `Redirect line exceeds ${CLOUDFLARE_LIMITS.MAX_REDIRECT_LENGTH} character limit: ${redirectLine.length}`
    );
  }

  // Validate splat usage (only one * allowed per URL)
  const sourceSplats = (redirect.source.match(/\*/g) || []).length;
  if (sourceSplats > 1) {
    errors.push(`Multiple splats (*) not allowed in source path: ${redirect.source}`);
  }

  return errors;
}

/**
 * Formats the redirect status code, defaulting to 301 if not specified.
 * @param code The HTTP redirect status code.
 * @returns The formatted redirect code.
 */
function formatRedirectCode(code?: number): number {
  return code || 301;
}

/**
 * Generates CloudFlare _redirects file content from website configuration.
 * @param website The website configuration object.
 * @returns Object containing the file content and any validation errors
 */
export function generateRedirects(website: AnglesiteWebsiteConfiguration): {
  content: string;
  errors: string[];
  warnings: string[];
} {
  if (!website || !website.redirects || website.redirects.length === 0) {
    return { content: '', errors: [], warnings: [] };
  }

  const redirects = website.redirects;
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];

  // Validate redirect count limits
  if (redirects.length > CLOUDFLARE_LIMITS.MAX_TOTAL_REDIRECTS) {
    errors.push(
      `Too many redirects: ${redirects.length}. CloudFlare limit is ${CLOUDFLARE_LIMITS.MAX_TOTAL_REDIRECTS}`
    );
  }

  let dynamicCount = 0;
  let staticCount = 0;

  for (const redirect of redirects) {
    if (!redirect.source || !redirect.destination) {
      warnings.push('Skipping redirect with missing source or destination');
      continue;
    }

    // Validate individual redirect rule
    const ruleErrors = validateRedirectRule(redirect);
    errors.push(...ruleErrors);

    // Count dynamic vs static redirects
    if (redirect.source.includes('*') || redirect.source.includes(':')) {
      dynamicCount++;
    } else {
      staticCount++;
    }

    const line =
      [redirect.source, redirect.destination, formatRedirectCode(redirect.code).toString()].join(' ') +
      (redirect.force ? '!' : '');

    lines.push(line);
  }

  // Validate dynamic/static limits
  if (dynamicCount > CLOUDFLARE_LIMITS.MAX_DYNAMIC_REDIRECTS) {
    errors.push(
      `Too many dynamic redirects: ${dynamicCount}. CloudFlare limit is ${CLOUDFLARE_LIMITS.MAX_DYNAMIC_REDIRECTS}`
    );
  }
  if (staticCount > CLOUDFLARE_LIMITS.MAX_STATIC_REDIRECTS) {
    errors.push(
      `Too many static redirects: ${staticCount}. CloudFlare limit is ${CLOUDFLARE_LIMITS.MAX_STATIC_REDIRECTS}`
    );
  }

  const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');

  return { content, errors, warnings };
}

/**
 * Adds a redirects plugin to generate CloudFlare _redirects file.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addRedirects(eleventyConfig: EleventyConfig): void {
  eleventyConfig.on('eleventy.after', async ({ dir, results }) => {
    if (!results || results.length === 0) {
      return;
    }

    let websiteConfig: AnglesiteWebsiteConfiguration | undefined;

    // Check if the first result has data property (test scenario)
    const firstResult = results[0] as { data?: EleventyData };
    if (firstResult?.data?.website) {
      websiteConfig = firstResult.data.website;
    } else {
      // Real Eleventy build scenario - read from filesystem
      try {
        const websiteDataPath = path.resolve('src', '_data', 'website.json');
        const websiteData = await fs.readFile(websiteDataPath, 'utf-8');
        websiteConfig = JSON.parse(websiteData) as AnglesiteWebsiteConfiguration;
      } catch (error) {
        console.warn(
          `[Eleventy] Redirects plugin: Could not read website.json from _data directory: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }
    }

    if (!websiteConfig) {
      return;
    }

    const result = generateRedirects(websiteConfig);

    // Log validation errors and warnings
    if (result.errors.length > 0) {
      console.error('[Eleventy] Redirects validation errors:');
      result.errors.forEach((error) => console.error(`  - ${error}`));
      throw new Error('Redirects validation failed. See errors above.');
    }

    if (result.warnings.length > 0) {
      console.warn('[Eleventy] Redirects warnings:');
      result.warnings.forEach((warning) => console.warn(`  - ${warning}`));
    }

    if (result.content.trim()) {
      const outputPath = path.join(dir.output, '_redirects');
      try {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, result.content);
        console.log(`[Eleventy] Wrote ${outputPath}`);
      } catch (error) {
        console.error(
          `[Eleventy] Failed to write _redirects: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }
  });
}
