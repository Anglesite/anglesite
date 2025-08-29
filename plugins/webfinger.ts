import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

/**
 * Validates WebFinger subject format for security
 * @param subject The WebFinger subject to validate
 * @returns True if subject is valid
 */
function validateWebFingerSubject(subject: string): boolean {
  // WebFinger subjects can be acct: URIs or HTTP(S) URLs
  return subject.startsWith('acct:') || subject.startsWith('http://') || subject.startsWith('https://');
}

/**
 * Validates URL format for security
 * @param url The URL to validate
 * @returns True if URL is valid
 */
function validateUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Only allow http(s) URLs for security
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

interface WebFingerResource {
  subject: string;
  aliases?: string[];
  properties?: Record<string, string | null>;
  links?: {
    rel: string;
    href?: string;
    type?: string;
    titles?: Record<string, string>;
    properties?: Record<string, string | null>;
  }[];
}

interface WebFingerResponse {
  subject: string;
  aliases?: string[];
  properties?: Record<string, string | null>;
  links?: {
    rel: string;
    href?: string;
    type?: string;
    titles?: Record<string, string>;
    properties?: Record<string, string | null>;
  }[];
}

/**
 * Generates a WebFinger JSON Resource Descriptor (JRD) for a specific resource.
 * This creates the standard WebFinger response format but as static data.
 * @param resource The WebFinger resource configuration from website.json
 * @returns The WebFinger JRD response object (not a dynamic server response)
 * @see https://tools.ietf.org/rfc/rfc7033.txt RFC 7033 Section 4.4 - JSON Resource Descriptor
 */
export function generateWebFingerResponse(resource: WebFingerResource): WebFingerResponse {
  // Validate subject format for security
  if (!validateWebFingerSubject(resource.subject)) {
    console.warn(`[@dwk/anglesite-11ty] WebFinger subject is not a valid format: ${resource.subject}`);
  }

  const response: WebFingerResponse = {
    subject: resource.subject,
  };

  if (resource.aliases && resource.aliases.length > 0) {
    // Validate aliases are valid URLs
    for (const alias of resource.aliases) {
      if (!validateUrl(alias)) {
        console.warn(`[@dwk/anglesite-11ty] WebFinger alias is not a valid URL: ${alias}`);
      }
    }
    response.aliases = resource.aliases;
  }

  if (resource.properties) {
    response.properties = resource.properties;
  }

  if (resource.links && resource.links.length > 0) {
    // Validate link URLs
    for (const link of resource.links) {
      if (link.href && !validateUrl(link.href)) {
        console.warn(`[@dwk/anglesite-11ty] WebFinger link href is not a valid URL: ${link.href}`);
      }
    }
    response.links = resource.links;
  }

  return response;
}

/**
 * Generates a static WebFinger resource lookup file.
 * LIMITATION: This creates a static JSON file containing all resources,
 * not a dynamic endpoint that responds to ?resource= queries.
 * Clients would need to parse this file client-side to find their resource.
 * @param website The website configuration object
 * @returns JSON string containing all WebFinger resources keyed by subject
 */
export function generateStaticWebFinger(website: AnglesiteWebsiteConfiguration): string {
  if (!website?.webfinger?.enabled || !website.webfinger.resources || website.webfinger.resources.length === 0) {
    return '';
  }

  const responses: Record<string, WebFingerResponse> = {};

  for (const resource of website.webfinger.resources) {
    responses[resource.subject] = generateWebFingerResponse(resource);
  }

  return JSON.stringify(responses, null, 2);
}

/**
 * Creates a human-readable WebFinger endpoint page.
 * This generates an HTML page listing available resources for manual discovery.
 * It does NOT implement the WebFinger protocol query interface (?resource=...).
 * @param website The website configuration object
 * @returns HTML content showing available WebFinger resources
 */
export function generateWebFingerIndex(website: AnglesiteWebsiteConfiguration): string {
  if (!website?.webfinger?.enabled || !website.webfinger.resources || website.webfinger.resources.length === 0) {
    return '';
  }

  const resources = website.webfinger.resources.map((r) => r.subject);

  return `<!DOCTYPE html>
<html>
<head>
  <title>WebFinger Endpoint</title>
  <meta charset="utf-8">
</head>
<body>
  <h1>WebFinger Resources</h1>
  <p>Available resources:</p>
  <ul>
${resources.map((resource) => `    <li><code>${resource}</code></li>`).join('\n')}
  </ul>
  <p>This is a static WebFinger implementation. For dynamic queries, use: <code>/.well-known/webfinger?resource=RESOURCE_URI</code></p>
</body>
</html>`;
}

/**
 * Adds a plugin for generating static WebFinger files.
 * IMPORTANT LIMITATIONS - Static Implementation:
 * - This generates static files, not a dynamic WebFinger server
 * - Does not handle query parameters (?resource=...) dynamically
 * - All resources must be pre-configured in website.json
 * - No runtime resource discovery or user enumeration
 * - Best suited for small, known sets of resources (authors, main site, etc.)
 * Generated Files:
 * - /.well-known/webfinger-resources.json: Static resource data
 * - /.well-known/webfinger: HTML index page listing resources
 * For full RFC 7033 compliance with dynamic queries, you would need:
 * - Server-side implementation to parse ?resource= parameter
 * - Database or API to look up resources dynamically
 * - Proper Content-Type: application/jrd+json headers
 * This static approach works well for:
 * - Personal websites with known authors
 * - Small business sites with fixed contact info
 * - Blogs with static author profiles
 * - Sites that need basic federated identity discovery
 * @param eleventyConfig The Eleventy configuration object.
 * @see https://tools.ietf.org/rfc/rfc7033.txt RFC 7033 - WebFinger
 */
export default function addWebFinger(eleventyConfig: EleventyConfig): void {
  // Create WebFinger files during the build process
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
        console.warn('[@dwk/anglesite-11ty] WebFinger plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      console.warn('[@dwk/anglesite-11ty] WebFinger plugin: No website configuration found');
      return;
    }

    if (!websiteConfig.webfinger?.enabled) {
      return;
    }

    const wellKnownDir = path.join(dir.output, '.well-known');

    try {
      // Ensure .well-known directory exists
      fs.mkdirSync(wellKnownDir, { recursive: true });

      // Generate static resource data file
      const staticData = generateStaticWebFinger(websiteConfig);
      if (staticData.trim()) {
        const staticDataPath = path.join(wellKnownDir, 'webfinger-resources.json');
        fs.writeFileSync(staticDataPath, staticData);
        console.log(`[@dwk/anglesite-11ty] Wrote ${staticDataPath}`);
      }

      // Generate WebFinger index page
      const indexContent = generateWebFingerIndex(websiteConfig);
      if (indexContent.trim()) {
        const indexPath = path.join(wellKnownDir, 'webfinger');
        fs.writeFileSync(indexPath, indexContent);
        console.log(`[@dwk/anglesite-11ty] Wrote ${indexPath}`);
      }
    } catch (error) {
      console.error(
        `[@dwk/anglesite-11ty] Failed to write WebFinger files: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
