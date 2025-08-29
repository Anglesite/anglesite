import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

interface AppLinkDetail {
  appID?: string;
  appIDs?: string[];
  paths: string[];
  components?: Array<{
    '/'?: string;
    '?'?: Record<string, string>;
    '#'?: string;
  }>;
}

interface AppleAppSiteAssociationContent {
  applinks?: {
    apps: string[];
    details: AppLinkDetail[];
  };
  webcredentials?: {
    apps: string[];
  };
  appclips?: {
    apps: string[];
  };
}

/**
 * Validates an Apple app ID format (team ID + bundle ID)
 * @param appId The app ID to validate
 * @returns True if app ID is valid
 */
function validateAppId(appId: string): boolean {
  // App ID should be in format: TEAM_ID.BUNDLE_ID (e.g., "ABCD123456.com.example.app")
  const appIdPattern = /^[A-Z0-9]{10}\.[a-zA-Z0-9.-]+$/;
  return appIdPattern.test(appId);
}

/**
 * Validates path patterns for security
 * @param paths Array of path patterns
 * @returns True if all paths are valid
 */
function validatePaths(paths: string[]): boolean {
  for (const pathPattern of paths) {
    // Basic validation - ensure no dangerous patterns
    if (pathPattern.includes('..') || pathPattern.includes('//')) {
      console.warn(`[Eleventy] Apple App Site Association: Potentially dangerous path pattern: ${pathPattern}`);
      return false;
    }
  }
  return true;
}

/**
 * Generates the Apple App Site Association JSON content
 * @param website The website configuration object
 * @returns JSON string for apple-app-site-association file
 */
export function generateAppleAppSiteAssociation(website: AnglesiteWebsiteConfiguration): string {
  if (!website?.apple_app_site_association?.enabled) {
    return '';
  }

  const config = website.apple_app_site_association;
  const content: AppleAppSiteAssociationContent = {};

  // App Links configuration
  if (config.applinks) {
    content.applinks = {
      apps: config.applinks.apps || [],
      details: [],
    };

    if (config.applinks.details) {
      for (const detail of config.applinks.details) {
        // Validate app IDs
        if (detail.appID && !validateAppId(detail.appID)) {
          console.warn(`[Eleventy] Apple App Site Association: Invalid app ID format: ${detail.appID}`);
          continue;
        }

        if (detail.appIDs) {
          for (const appId of detail.appIDs) {
            if (!validateAppId(appId)) {
              console.warn(`[Eleventy] Apple App Site Association: Invalid app ID format: ${appId}`);
              continue;
            }
          }
        }

        // Validate paths
        if (!validatePaths(detail.paths)) {
          console.warn(
            `[Eleventy] Apple App Site Association: Invalid paths for app ${detail.appID || detail.appIDs?.join(', ')}`
          );
          continue;
        }

        const validatedDetail: AppLinkDetail = {
          paths: detail.paths,
        };

        // Use either appID or appIDs, not both
        if (detail.appID) {
          validatedDetail.appID = detail.appID;
        } else if (detail.appIDs && detail.appIDs.length > 0) {
          validatedDetail.appIDs = detail.appIDs;
        }

        if (detail.components) {
          validatedDetail.components = detail.components;
        }

        content.applinks.details.push(validatedDetail);
      }
    }
  }

  // Web Credentials configuration
  if (config.webcredentials) {
    const apps: string[] = [];

    if (config.webcredentials.apps) {
      for (const appId of config.webcredentials.apps) {
        if (validateAppId(appId)) {
          apps.push(appId);
        } else {
          console.warn(`[Eleventy] Apple App Site Association: Invalid app ID format for webcredentials: ${appId}`);
        }
      }
    }

    if (apps.length > 0) {
      content.webcredentials = { apps };
    }
  }

  // App Clips configuration
  if (config.appclips) {
    content.appclips = {
      apps: config.appclips.apps || [],
    };
  }

  // Only return content if there's something to output
  if (Object.keys(content).length === 0) {
    return '';
  }

  return JSON.stringify(content, null, 2);
}

/**
 * Adds a plugin for generating a .well-known/apple-app-site-association file.
 * This file enables iOS Universal Links, Password AutoFill, and App Clips.
 * @param eleventyConfig The Eleventy configuration object.
 * @see https://developer.apple.com/documentation/xcode/supporting-associated-domains
 */
export default function addAppleAppSiteAssociation(eleventyConfig: EleventyConfig): void {
  // Create .well-known/apple-app-site-association file during the build process
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
        console.warn('[Eleventy] Apple App Site Association plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig || !websiteConfig.apple_app_site_association?.enabled) {
      return;
    }

    const appleAppSiteAssociationContent = generateAppleAppSiteAssociation(websiteConfig);

    if (appleAppSiteAssociationContent.trim()) {
      const wellKnownDir = path.join(dir.output, '.well-known');
      const outputPath = path.join(wellKnownDir, 'apple-app-site-association');

      try {
        // Ensure .well-known directory exists
        fs.mkdirSync(wellKnownDir, { recursive: true });
        fs.writeFileSync(outputPath, appleAppSiteAssociationContent);
        console.log(`[Eleventy] Wrote ${outputPath}`);
      } catch (error) {
        console.error(
          `[Eleventy] Failed to write .well-known/apple-app-site-association: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}
