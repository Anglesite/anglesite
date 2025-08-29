import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

/**
 * Converts a path to a full URL if needed.
 * If the value is already a full URL (http/https) or mailto:, returns as-is.
 * If it's an absolute path starting with /, prepends the website URL.
 * @param value The URL or path to process
 * @param baseUrl The base website URL
 * @returns The full URL
 */
function toFullUrl(value: string, baseUrl?: string): string {
  try {
    // Validate input
    if (typeof value !== 'string' || !value.trim()) {
      return '';
    }

    const trimmedValue = value.trim();

    // Check for dangerous protocols
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    const lowerValue = trimmedValue.toLowerCase();
    if (dangerousProtocols.some((proto) => lowerValue.startsWith(proto))) {
      console.warn('[Eleventy] Security plugin: Dangerous protocol detected');
      return '';
    }

    // Validate and return known safe schemes
    if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmedValue)) {
      // For HTTP URLs, validate structure
      if (trimmedValue.startsWith('http')) {
        try {
          new URL(trimmedValue); // This validates URL structure
        } catch {
          console.warn('[Eleventy] Security plugin: Invalid URL structure');
          return '';
        }
      }
      return trimmedValue;
    }

    // Handle absolute paths
    if (trimmedValue.startsWith('/')) {
      if (baseUrl) {
        try {
          const url = new URL(trimmedValue, baseUrl);
          return url.toString();
        } catch {
          console.warn('[Eleventy] Security plugin: Failed to construct URL');
          return '';
        }
      }
      return trimmedValue;
    }

    // Return as-is for relative paths (though not recommended for security.txt)
    return trimmedValue;
  } catch {
    console.warn('[Eleventy] Security plugin: URL construction error');
    return '';
  }
}

/**
 * Generates a security.txt file based on the website configuration.
 * @see https://securitytxt.org/
 * @param website The website configuration object.
 * @returns The contents of the security.txt file.
 */
export function generateSecurityTxt(website: AnglesiteWebsiteConfiguration): string {
  if (!website || !website.security) {
    return '';
  }

  const security = website.security;
  const baseUrl = website.url;
  let securityTxt = '';

  // Contact field (required)
  if (security.contact) {
    const contacts = Array.isArray(security.contact) ? security.contact : [security.contact];
    for (const contact of contacts) {
      securityTxt += `Contact: ${toFullUrl(contact, baseUrl)}\n`;
    }
  }

  // Expires field (recommended) - calculate from current time if numeric (seconds)
  if (security.expires) {
    let expiresValue: string;
    if (typeof security.expires === 'number') {
      // If number, treat as seconds from now
      const expirationDate = new Date(Date.now() + security.expires * 1000);
      expiresValue = expirationDate.toISOString();
    } else {
      // If string, use as-is (should be ISO 8601 format)
      expiresValue = security.expires;
    }
    securityTxt += `Expires: ${expiresValue}\n`;
  }

  // Encryption field (optional)
  if (security.encryption) {
    const encryptions = Array.isArray(security.encryption) ? security.encryption : [security.encryption];
    if (encryptions.length > 0) {
      for (const encryption of encryptions) {
        securityTxt += `Encryption: ${toFullUrl(encryption, baseUrl)}\n`;
      }
    }
  }

  // Acknowledgments field (optional)
  if (security.acknowledgments) {
    securityTxt += `Acknowledgments: ${toFullUrl(security.acknowledgments, baseUrl)}\n`;
  }

  // Preferred-Languages field (optional)
  if (security.preferred_languages) {
    const languages = Array.isArray(security.preferred_languages)
      ? security.preferred_languages
      : [security.preferred_languages];
    if (languages.length > 0) {
      securityTxt += `Preferred-Languages: ${languages.join(', ')}\n`;
    }
  }

  // Canonical field (optional)
  if (security.canonical) {
    securityTxt += `Canonical: ${toFullUrl(security.canonical, baseUrl)}\n`;
  }

  // Policy field (optional)
  if (security.policy) {
    securityTxt += `Policy: ${toFullUrl(security.policy, baseUrl)}\n`;
  }

  // Hiring field (optional)
  if (security.hiring) {
    securityTxt += `Hiring: ${toFullUrl(security.hiring, baseUrl)}\n`;
  }

  return securityTxt;
}

/**
 * Adds a plugin for generating a .well-known/security.txt file.
 * Uses Eleventy's data cascade to access website configuration.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addSecurityTxt(eleventyConfig: EleventyConfig): void {
  // Create .well-known/security.txt file during the build process
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
        console.warn('[Eleventy] Security plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig || !websiteConfig.security) {
      // Security.txt is optional, so we don't warn if it's not configured
      return;
    }

    const securityTxtContent = generateSecurityTxt(websiteConfig);

    if (securityTxtContent.trim()) {
      const wellKnownDir = path.join(dir.output, '.well-known');
      const outputPath = path.join(wellKnownDir, 'security.txt');

      try {
        // Ensure .well-known directory exists
        fs.mkdirSync(wellKnownDir, { recursive: true });
        fs.writeFileSync(outputPath, securityTxtContent);
        console.log(`[Eleventy] Wrote ${outputPath}`);
      } catch (error) {
        console.error(
          `[Eleventy] Failed to write .well-known/security.txt: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}
