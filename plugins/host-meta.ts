import * as fs from 'fs';
import * as path from 'path';
import { create } from 'xmlbuilder2';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
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

/**
 * Generates XRD (Extensible Resource Descriptor) document for host metadata
 * @see https://tools.ietf.org/rfc/rfc6415.txt
 * @param website The website configuration object.
 * @returns The contents of the host-meta XRD file.
 */
export function generateHostMetaXrd(website: AnglesiteWebsiteConfiguration): string {
  if (!website?.host_meta?.enabled) {
    return '';
  }

  const hostMeta = website.host_meta;

  // Create XML document using xmlbuilder2
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const xrd = doc.ele('XRD', {
    xmlns: 'http://docs.oasis-open.org/ns/xri/xrd-1.0',
  });

  // Add subject if specified
  if (hostMeta.subject) {
    if (!validateUrl(hostMeta.subject)) {
      console.warn(`[@dwk/anglesite-11ty] Host-meta subject is not a valid URL: ${hostMeta.subject}`);
    }
    xrd.ele('Subject').txt(hostMeta.subject);
  }

  // Add aliases
  if (hostMeta.aliases && hostMeta.aliases.length > 0) {
    for (const alias of hostMeta.aliases) {
      if (!validateUrl(alias)) {
        console.warn(`[@dwk/anglesite-11ty] Host-meta alias is not a valid URL: ${alias}`);
      }
      xrd.ele('Alias').txt(alias);
    }
  }

  // Add properties
  if (hostMeta.properties && hostMeta.properties.length > 0) {
    for (const prop of hostMeta.properties) {
      xrd.ele('Property', { type: prop.type }).txt(prop.value);
    }
  }

  // Add links
  if (hostMeta.links && hostMeta.links.length > 0) {
    for (const link of hostMeta.links) {
      const linkAttribs: Record<string, string> = { rel: link.rel };

      // Handle template links differently
      if (link.template) {
        // Validate template URI contains {uri} placeholder
        if (!link.href || !link.href.includes('{uri}')) {
          console.warn(
            `[@dwk/anglesite-11ty] Host-meta template link missing {uri} placeholder: ${link.href || 'undefined'}`
          );
        }
        if (link.href) {
          linkAttribs.template = link.href;
        }
      } else {
        // Validate non-template URLs
        if (link.href && !validateUrl(link.href)) {
          console.warn(`[@dwk/anglesite-11ty] Host-meta link href is not a valid URL: ${link.href}`);
        }
        if (link.href) {
          linkAttribs.href = link.href;
        }
      }

      if (link.type) {
        linkAttribs.type = link.type;
      }

      xrd.ele('Link', linkAttribs);
    }
  }

  return doc.end({ prettyPrint: true, indent: '  ' });
}

/**
 * Generates JSON Resource Descriptor (JRD) document for host metadata
 * @see https://tools.ietf.org/rfc/rfc6415.txt RFC 6415 Section 3.1
 * @param website The website configuration object
 * @returns The contents of the host-meta JRD file
 */
export function generateHostMetaJrd(website: AnglesiteWebsiteConfiguration): string {
  if (!website?.host_meta?.enabled) {
    return '';
  }

  const hostMeta = website.host_meta;
  const jrd: Record<string, unknown> = {};

  // Add subject if specified
  if (hostMeta.subject) {
    if (!validateUrl(hostMeta.subject)) {
      console.warn(`[@dwk/anglesite-11ty] Host-meta subject is not a valid URL: ${hostMeta.subject}`);
    }
    jrd.subject = hostMeta.subject;
  }

  // Add aliases
  if (hostMeta.aliases && hostMeta.aliases.length > 0) {
    for (const alias of hostMeta.aliases) {
      if (!validateUrl(alias)) {
        console.warn(`[@dwk/anglesite-11ty] Host-meta alias is not a valid URL: ${alias}`);
      }
    }
    jrd.aliases = hostMeta.aliases;
  }

  // Add properties
  if (hostMeta.properties && hostMeta.properties.length > 0) {
    const properties: Record<string, string> = {};
    for (const prop of hostMeta.properties) {
      properties[prop.type] = prop.value;
    }
    jrd.properties = properties;
  }

  // Add links
  if (hostMeta.links && hostMeta.links.length > 0) {
    const links: Record<string, string>[] = [];
    for (const link of hostMeta.links) {
      const jrdLink: Record<string, string> = { rel: link.rel };

      // Handle template links differently
      if (link.template) {
        // Validate template URI contains {uri} placeholder
        if (!link.href || !link.href.includes('{uri}')) {
          console.warn(
            `[@dwk/anglesite-11ty] Host-meta template link missing {uri} placeholder: ${link.href || 'undefined'}`
          );
        }
        if (link.href) {
          jrdLink.template = link.href;
        }
      } else {
        // Validate non-template URLs
        if (link.href && !validateUrl(link.href)) {
          console.warn(`[@dwk/anglesite-11ty] Host-meta link href is not a valid URL: ${link.href}`);
        }
        if (link.href) {
          jrdLink.href = link.href;
        }
      }

      if (link.type) {
        jrdLink.type = link.type;
      }

      links.push(jrdLink);
    }
    jrd.links = links;
  }

  return JSON.stringify(jrd, null, 2);
}

/**
 * Generates HTTP headers configuration for host-meta files
 * @param format The host-meta format(s) being generated
 * @returns Headers configuration lines for _headers file
 */
export function generateHostMetaHeaders(format: 'xml' | 'json' | 'both'): string[] {
  const headers: string[] = [];

  if (format === 'xml' || format === 'both') {
    headers.push('/.well-known/host-meta');
    headers.push('  Content-Type: application/xrd+xml; charset=utf-8');
    headers.push('  Cache-Control: public, max-age=86400');
    headers.push('');
  }

  if (format === 'json' || format === 'both') {
    const path = format === 'both' ? '/.well-known/host-meta.json' : '/.well-known/host-meta';
    headers.push(path);
    headers.push('  Content-Type: application/jrd+json; charset=utf-8');
    headers.push('  Cache-Control: public, max-age=86400');
    headers.push('');
  }

  return headers;
}

/**
 * Adds a plugin for generating a host-meta file.
 * Uses Eleventy's data cascade to access website configuration.
 * Automatically adds appropriate Content-Type headers for .well-known files.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addHostMeta(eleventyConfig: EleventyConfig): void {
  // Create host-meta file during the build process
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
        console.warn('[@dwk/anglesite-11ty] Host-meta plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      console.warn('[@dwk/anglesite-11ty] Host-meta plugin: No website configuration found');
      return;
    }

    if (!websiteConfig.host_meta?.enabled) {
      return;
    }

    const wellKnownDir = path.join(dir.output, '.well-known');
    const format = websiteConfig.host_meta.format || 'xml';

    try {
      // Ensure .well-known directory exists
      fs.mkdirSync(wellKnownDir, { recursive: true });

      // Generate XML format
      if (format === 'xml' || format === 'both') {
        const xrdContent = generateHostMetaXrd(websiteConfig);
        if (xrdContent.trim()) {
          const xmlPath = path.join(wellKnownDir, 'host-meta');
          fs.writeFileSync(xmlPath, xrdContent);
          console.log(`[@dwk/anglesite-11ty] Wrote ${xmlPath}`);
        }
      }

      // Generate JSON format
      if (format === 'json' || format === 'both') {
        const jrdContent = generateHostMetaJrd(websiteConfig);
        if (jrdContent.trim()) {
          const jsonPath = path.join(wellKnownDir, format === 'both' ? 'host-meta.json' : 'host-meta');
          fs.writeFileSync(jsonPath, jrdContent);
          console.log(`[@dwk/anglesite-11ty] Wrote ${jsonPath}`);
        }
      }

      // Add appropriate headers to _headers file
      const headersPath = path.join(dir.output, '_headers');
      const hostMetaHeaders = generateHostMetaHeaders(format);

      if (hostMetaHeaders.length > 0) {
        try {
          // Check if _headers file exists
          let existingHeaders = '';
          try {
            existingHeaders = fs.readFileSync(headersPath, 'utf-8');
          } catch {
            // File doesn't exist, that's fine
          }

          // Only add headers if they're not already present
          const headersText = hostMetaHeaders.join('\n');
          if (existingHeaders && !existingHeaders.includes('/.well-known/host-meta')) {
            const newHeaders = existingHeaders + (existingHeaders ? '\n' : '') + headersText;
            fs.writeFileSync(headersPath, newHeaders);
            console.log(`[@dwk/anglesite-11ty] Updated ${headersPath} with host-meta headers`);
          } else if (!existingHeaders) {
            // File doesn't exist, create new headers file
            fs.writeFileSync(headersPath, headersText);
            console.log(`[@dwk/anglesite-11ty] Created ${headersPath} with host-meta headers`);
          }
        } catch (headerError) {
          console.warn(
            `[@dwk/anglesite-11ty] Could not update _headers file: ${headerError instanceof Error ? headerError.message : String(headerError)}`
          );
        }
      }
    } catch (error) {
      console.error(
        `[@dwk/anglesite-11ty] Failed to write host-meta: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
