import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

interface NodeInfoDiscovery {
  links: {
    rel: string;
    href: string;
  }[];
}

interface NodeInfoSoftware {
  name: string;
  version: string;
  repository?: string;
  homepage?: string;
}

interface NodeInfoServices {
  inbound: string[];
  outbound: string[];
}

interface NodeInfoUsage {
  users: {
    total?: number;
    activeHalfyear?: number;
    activeMonth?: number;
  };
  localPosts?: number;
  localComments?: number;
}

interface NodeInfo21 {
  version: '2.1';
  software: NodeInfoSoftware;
  protocols: string[];
  services: NodeInfoServices;
  openRegistrations: boolean;
  usage: NodeInfoUsage;
  metadata: Record<string, unknown>;
}

/**
 * Generates the NodeInfo discovery document for .well-known/nodeinfo
 * This provides links to the supported NodeInfo schema versions.
 * @param website The website configuration object
 * @param baseUrl Base URL for constructing nodeinfo endpoints
 * @returns The NodeInfo discovery JSON object
 */
export function generateNodeInfoDiscovery(website: AnglesiteWebsiteConfiguration, baseUrl: string): NodeInfoDiscovery {
  const links = [];

  if (website.nodeinfo?.enabled) {
    // Add supported schema versions
    links.push({
      rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
      href: `${baseUrl}/.well-known/nodeinfo.json`,
    });
  }

  return { links };
}

/**
 * Resolves a URL to an absolute URL, handling both relative paths and full URLs
 * @param url The URL to resolve (can be relative path or full URL)
 * @param baseUrl The base URL to use for relative paths
 * @returns The resolved absolute URL
 */
function resolveUrl(url: string, baseUrl: string): string {
  // If it's already a full URL (starts with http:// or https://), return as-is
  if (url.match(/^https?:\/\//)) {
    return url;
  }

  // If it's a relative path, combine with base URL
  // Ensure baseUrl doesn't end with slash and url starts with slash
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const cleanPath = url.startsWith('/') ? url : `/${url}`;

  return `${cleanBaseUrl}${cleanPath}`;
}

/**
 * Resolves URLs in metadata object, converting relative paths to absolute URLs
 * @param metadata The metadata object that may contain URLs
 * @param baseUrl The base URL to use for relative paths
 * @returns The metadata object with resolved URLs
 */
function resolveMetadataUrls(metadata: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  const urlFields = [
    'tosUrl',
    'privacyPolicyUrl',
    'impressumUrl',
    'donationUrl',
    'repositoryUrl',
    'feedbackUrl',
    'supportUrl',
  ];

  const resolvedMetadata = { ...metadata };

  for (const field of urlFields) {
    if (typeof resolvedMetadata[field] === 'string') {
      resolvedMetadata[field] = resolveUrl(resolvedMetadata[field] as string, baseUrl);
    }
  }

  return resolvedMetadata;
}

/**
 * Generates NodeInfo 2.1 document with server metadata
 * @param website The website configuration object
 * @param baseUrl The base URL to use for resolving relative paths (optional, uses website.url as fallback)
 * @returns The NodeInfo 2.1 JSON object
 */
export function generateNodeInfo21(website: AnglesiteWebsiteConfiguration, baseUrl?: string): NodeInfo21 {
  if (!website.nodeinfo?.enabled) {
    throw new Error('NodeInfo is not enabled in website configuration');
  }

  const nodeInfoConfig = website.nodeinfo;
  const resolvedBaseUrl = baseUrl || website.url;

  if (!resolvedBaseUrl) {
    throw new Error(
      'NodeInfo requires a base URL. Please set website.url in your configuration or pass baseUrl parameter.'
    );
  }

  return {
    version: '2.1',
    software: {
      name: nodeInfoConfig.software?.name || 'anglesite',
      version: nodeInfoConfig.software?.version || '0.1.0',
      repository: nodeInfoConfig.software?.repository
        ? resolveUrl(nodeInfoConfig.software.repository, resolvedBaseUrl)
        : undefined,
      homepage: nodeInfoConfig.software?.homepage
        ? resolveUrl(nodeInfoConfig.software.homepage, resolvedBaseUrl)
        : undefined,
    },
    protocols: nodeInfoConfig.protocols || [],
    services: {
      inbound: nodeInfoConfig.services?.inbound || [],
      outbound: nodeInfoConfig.services?.outbound || [],
    },
    openRegistrations: nodeInfoConfig.openRegistrations || false,
    usage: {
      users: {
        total: nodeInfoConfig.usage?.users?.total,
        activeHalfyear: nodeInfoConfig.usage?.users?.activeHalfyear,
        activeMonth: nodeInfoConfig.usage?.users?.activeMonth,
      },
      localPosts: nodeInfoConfig.usage?.localPosts,
      localComments: nodeInfoConfig.usage?.localComments,
    },
    metadata: nodeInfoConfig.metadata ? resolveMetadataUrls(nodeInfoConfig.metadata, resolvedBaseUrl) : {},
  };
}

/**
 * Validates NodeInfo configuration for required fields
 * @param nodeInfoConfig The NodeInfo configuration object
 * @returns Array of validation error messages
 */
function validateNodeInfoConfig(nodeInfoConfig: unknown): string[] {
  const errors: string[] = [];

  // Type guard to check if the config has the expected structure
  const config = nodeInfoConfig as {
    software?: { name?: string; version?: string };
    protocols?: unknown;
    openRegistrations?: unknown;
  };

  if (!config.software?.name) {
    errors.push('NodeInfo software.name is required');
  }

  if (!config.software?.version) {
    errors.push('NodeInfo software.version is required');
  }

  if (!Array.isArray(config.protocols)) {
    errors.push('NodeInfo protocols must be an array');
  }

  if (config.openRegistrations === undefined) {
    errors.push('NodeInfo openRegistrations is required');
  }

  return errors;
}

/**
 * Adds a plugin for generating NodeInfo files.
 * NodeInfo is a standard for exposing metadata about servers in decentralized networks.
 * This plugin generates:
 * - /.well-known/nodeinfo: Discovery document with links to supported schema versions
 * - /.well-known/nodeinfo/2.1: NodeInfo 2.1 schema document with server metadata
 *
 * The plugin is useful for sites that participate in decentralized social networks
 * or want to expose standardized server metadata.
 * @param eleventyConfig The Eleventy configuration object.
 * @see https://nodeinfo.diaspora.software/ NodeInfo Protocol
 * @see https://github.com/jhass/nodeinfo NodeInfo Specification Repository
 */
export default function addNodeInfo(eleventyConfig: EleventyConfig): void {
  // Create NodeInfo files during the build process
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
        console.warn('[@dwk/anglesite-11ty] NodeInfo plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      console.warn('[@dwk/anglesite-11ty] NodeInfo plugin: No website configuration found');
      return;
    }

    if (!websiteConfig.nodeinfo?.enabled) {
      return;
    }

    // Validate NodeInfo configuration
    const validationErrors = validateNodeInfoConfig(websiteConfig.nodeinfo);
    if (validationErrors.length > 0) {
      console.error('[@dwk/anglesite-11ty] NodeInfo plugin configuration errors:');
      validationErrors.forEach((error) => console.error(`  - ${error}`));
      return;
    }

    const wellKnownDir = path.join(dir.output, '.well-known');
    const baseUrl = websiteConfig.url;

    if (!baseUrl) {
      console.error('[@dwk/anglesite-11ty] NodeInfo plugin requires website.url to be set in configuration');
      return;
    }

    try {
      // Ensure .well-known directory exists
      fs.mkdirSync(wellKnownDir, { recursive: true });

      // Generate NodeInfo discovery document
      const discovery = generateNodeInfoDiscovery(websiteConfig, baseUrl);
      const discoveryPath = path.join(wellKnownDir, 'nodeinfo');
      fs.writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2));
      console.log(`[@dwk/anglesite-11ty] Wrote ${discoveryPath}`);

      // Generate NodeInfo 2.1 document
      const nodeInfo21 = generateNodeInfo21(websiteConfig, baseUrl);
      const nodeInfo21Path = path.join(wellKnownDir, 'nodeinfo.json');
      fs.writeFileSync(nodeInfo21Path, JSON.stringify(nodeInfo21, null, 2));
      console.log(`[@dwk/anglesite-11ty] Wrote ${nodeInfo21Path}`);
    } catch (error) {
      console.error(
        `[@dwk/anglesite-11ty] Failed to write NodeInfo files: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
