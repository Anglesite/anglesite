import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

interface AssetLinkTarget {
  namespace: 'android_app' | 'web';
  package_name?: string;
  sha256_cert_fingerprints?: string[];
  site?: string;
}

interface AssetLinkStatement {
  relation: string[];
  target: AssetLinkTarget;
}

/**
 * Validates an Android package name format
 * @param packageName The package name to validate
 * @returns True if package name is valid
 */
function validatePackageName(packageName: string): boolean {
  // Package name should follow Java package naming conventions
  const packageNamePattern = /^[a-zA-Z][a-zA-Z0-9_.]*[a-zA-Z0-9]$/;
  return packageNamePattern.test(packageName);
}

/**
 * Validates a SHA256 certificate fingerprint format
 * @param fingerprint The fingerprint to validate
 * @returns True if fingerprint is valid
 */
function validateSha256Fingerprint(fingerprint: string): boolean {
  // SHA256 fingerprint should be 64 hex chars separated by colons, uppercase
  const fingerprintPattern = /^[A-F0-9]{2}(:[A-F0-9]{2}){31}$/;
  return fingerprintPattern.test(fingerprint);
}

/**
 * Validates a web site URL
 * @param site The site URL to validate
 * @returns True if site URL is valid
 */
function validateSiteUrl(site: string): boolean {
  try {
    const url = new URL(site);
    // Must use HTTPS for security
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates asset link relations
 * @param relations Array of relation strings
 * @returns True if all relations are valid
 */
function validateRelations(relations: string[]): boolean {
  const validRelations = [
    'delegate_permission/common.handle_all_urls',
    'delegate_permission/common.get_login_creds',
    'delegate_permission/common.share_location',
  ];

  return relations.length > 0 && relations.every((relation) => validRelations.includes(relation));
}

/**
 * Generates the Android Asset Links JSON content
 * @param website The website configuration object
 * @returns JSON string for assetlinks.json file
 */
export function generateAssetLinks(website: AnglesiteWebsiteConfiguration): string {
  if (!website?.assetlinks?.enabled) {
    return '';
  }

  const config = website.assetlinks;
  const statements: AssetLinkStatement[] = [];

  if (config.statements) {
    for (const statement of config.statements) {
      // Validate relations
      if (!validateRelations(statement.relation)) {
        console.warn(`[Eleventy] Asset Links: Invalid relations: ${statement.relation.join(', ')}`);
        continue;
      }

      // Validate target based on namespace
      let validTarget = false;
      const target: AssetLinkTarget = {
        namespace: statement.target.namespace,
      };

      if (statement.target.namespace === 'android_app') {
        // Android app target validation
        if (statement.target.package_name && statement.target.sha256_cert_fingerprints) {
          if (!validatePackageName(statement.target.package_name)) {
            console.warn(`[Eleventy] Asset Links: Invalid package name: ${statement.target.package_name}`);
            continue;
          }

          // Validate all certificate fingerprints
          const validFingerprints: string[] = [];
          for (const fingerprint of statement.target.sha256_cert_fingerprints) {
            if (validateSha256Fingerprint(fingerprint)) {
              validFingerprints.push(fingerprint);
            } else {
              console.warn(`[Eleventy] Asset Links: Invalid certificate fingerprint: ${fingerprint}`);
            }
          }

          if (validFingerprints.length === 0) {
            console.warn(
              `[Eleventy] Asset Links: No valid certificate fingerprints for package: ${statement.target.package_name}`
            );
            continue;
          }

          target.package_name = statement.target.package_name;
          target.sha256_cert_fingerprints = validFingerprints;
          validTarget = true;
        }
      } else if (statement.target.namespace === 'web') {
        // Web target validation
        if (statement.target.site) {
          if (!validateSiteUrl(statement.target.site)) {
            console.warn(`[Eleventy] Asset Links: Invalid site URL (must use HTTPS): ${statement.target.site}`);
            continue;
          }

          target.site = statement.target.site;
          validTarget = true;
        }
      }

      if (validTarget) {
        statements.push({
          relation: statement.relation,
          target,
        });
      }
    }
  }

  // Only return content if there are valid statements
  if (statements.length === 0) {
    return '';
  }

  return JSON.stringify(statements, null, 2);
}

/**
 * Adds a plugin for generating a .well-known/assetlinks.json file.
 * This file enables Android App Links and Digital Asset Links verification.
 * @param eleventyConfig The Eleventy configuration object.
 * @see https://developers.google.com/digital-asset-links/v1/getting-started
 */
export default function addAssetLinks(eleventyConfig: EleventyConfig): void {
  // Create .well-known/assetlinks.json file during the build process
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
        console.warn('[Eleventy] Asset Links plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig || !websiteConfig.assetlinks?.enabled) {
      return;
    }

    const assetLinksContent = generateAssetLinks(websiteConfig);

    if (assetLinksContent.trim()) {
      const wellKnownDir = path.join(dir.output, '.well-known');
      const outputPath = path.join(wellKnownDir, 'assetlinks.json');

      try {
        // Ensure .well-known directory exists
        fs.mkdirSync(wellKnownDir, { recursive: true });
        fs.writeFileSync(outputPath, assetLinksContent);
        console.log(`[Eleventy] Wrote ${outputPath}`);
      } catch (error) {
        console.error(
          `[Eleventy] Failed to write .well-known/assetlinks.json: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}
