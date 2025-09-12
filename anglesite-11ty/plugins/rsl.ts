/**
 * RSL Plugin Integration
 * Main plugin entry point for RSL 1.0 generation in Eleventy
 */

import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig, EleventyCollectionApi, EleventyCollectionItem } from '@11ty/eleventy';
import type { AnglesiteWebsiteConfiguration } from '../types/website.js';

// RSL modules
import type {
  RSLConfiguration,
  RSLContentAsset,
  RSLLicenseConfiguration,
  RSLOutputFormat,
  RSLCollectionConfig,
} from './rsl/types.js';
import {
  normalizeRSLConfiguration,
  getEffectiveLicenseConfiguration,
  validateRSLConfiguration,
  getAllRSLCollections,
} from './rsl/rsl-config.js';
import { discoverContentAssets } from './rsl/content-discovery.js';
import { resolveLicense } from './rsl/license-resolver.js';
import { generateIndividualRSL, generateCollectionRSL, generateSiteRSL, validateRSLXML } from './rsl/rsl-generator.js';

/**
 * Extended website configuration that includes RSL settings
 */
interface ExtendedWebsiteConfig extends AnglesiteWebsiteConfiguration {
  rsl?: RSLConfiguration;
}

/**
 * Eleventy after-build event data
 */
interface EleventyAfterEvent {
  dir: {
    input: string;
    output: string;
  };
  results: EleventyCollectionItem[];
}

/**
 * Extended collection item with RSL-specific data
 */
interface RSLCollectionItem extends EleventyCollectionItem {
  content?: string;
  data: {
    title?: string;
    author?: string;
    date?: Date;
    tags?: string | string[];
    permalink?: string;
    page?: {
      date: Date;
      url: string;
    };
    // RSL-specific metadata
    rsl?: RSLLicenseConfiguration;
    license?: string | RSLLicenseConfiguration;
  };
}

/**
 * Extended collection API
 */
interface ExtendedCollectionApi extends EleventyCollectionApi {
  getFilteredByTag(tag: string): EleventyCollectionItem[];
}

/**
 * Gets website configuration from Eleventy data
 * @param results - Eleventy build results
 * @param inputDir - Input directory path
 * @returns Website configuration or null if not found
 */
async function getWebsiteConfiguration(
  results: EleventyCollectionItem[],
  inputDir: string
): Promise<ExtendedWebsiteConfig | null> {
  // Try to get configuration from page data first (for tests)
  const firstResult = results[0] as RSLCollectionItem;
  if (firstResult?.data && 'website' in firstResult.data) {
    return firstResult.data.website as ExtendedWebsiteConfig;
  }

  // Fallback to reading from filesystem (for real builds)
  try {
    const configPath = path.join(inputDir, '_data', 'website.json');
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configContent) as ExtendedWebsiteConfig;
    }
  } catch (error) {
    console.warn('Failed to read website configuration for RSL:', error);
  }

  return null;
}

/**
 * Resolves license configuration for a collection item
 * @param item - Collection item
 * @param rslConfig - RSL configuration
 * @param collectionName - Collection name
 * @returns Promise resolving to effective license configuration
 */
async function resolveItemLicense(
  item: RSLCollectionItem,
  rslConfig: RSLConfiguration,
  collectionName?: string
): Promise<RSLLicenseConfiguration> {
  let itemLicense: RSLLicenseConfiguration | undefined;

  // Check for item-specific license
  if (item.data.rsl) {
    itemLicense = item.data.rsl;
  } else if (item.data.license) {
    if (typeof item.data.license === 'string') {
      // Resolve license template
      const resolution = await resolveLicense(item.data.license, rslConfig);
      if (resolution.success) {
        itemLicense = resolution.license;
      } else {
        console.warn(`Failed to resolve license ${item.data.license} for ${item.url}:`, resolution.warnings);
      }
    } else {
      itemLicense = item.data.license;
    }
  }

  return getEffectiveLicenseConfiguration(rslConfig, collectionName, itemLicense);
}

/**
 * Converts Eleventy collection item to RSL content asset
 * @param item - Collection item
 * @param baseUrl - Base URL for the site
 * @returns Content asset
 */
function convertItemToAsset(item: RSLCollectionItem, baseUrl: string): RSLContentAsset {
  const url = new URL(item.url || item.data?.permalink || '/', baseUrl).toString();

  return {
    url,
    type: 'text/html', // Most Eleventy content is HTML
    lastmod: item.data?.page?.date || item.data?.date || item.date || new Date(),
    size: item.templateContent?.length || 0,
  };
}

/**
 * Generates individual RSL files for each item in a collection
 * @param items - Collection items to process
 * @param collectionName - Name of the collection
 * @param rslConfig - RSL configuration
 * @param baseUrl - Base URL for the site
 * @param outputDir - Output directory
 * @returns Promise that resolves when all individual files are generated
 */
async function generateIndividualRSLFiles(
  items: RSLCollectionItem[],
  collectionName: string,
  rslConfig: RSLConfiguration,
  baseUrl: string,
  outputDir: string
): Promise<void> {
  const generationOptions = {
    prettyPrint: true,
    includeSchemaLocation: true,
    metadata: {
      generator: 'Anglesite 11ty',
      generatedAt: new Date(),
    },
  };

  // Process individual items in parallel for better performance
  const itemPromises = items.map(async (item) => {
    try {
      const itemAsset = convertItemToAsset(item, baseUrl);
      const itemLicense = await resolveItemLicense(item, rslConfig, collectionName);

      const rslXml = generateIndividualRSL(itemAsset, itemLicense, generationOptions);

      // Write individual RSL file
      const itemPath = path.dirname(path.join(outputDir, item.url || ''));
      const rslFileName = `${path.basename(item.url || 'index', '.html')}.rsl.xml`;
      const rslFilePath = path.join(itemPath, rslFileName);

      fs.mkdirSync(itemPath, { recursive: true });
      fs.writeFileSync(rslFilePath, rslXml, 'utf-8');

      return { success: true, url: item.url };
    } catch (error) {
      console.error(`Failed to generate individual RSL for ${item.url}:`, error);
      return { success: false, url: item.url, error };
    }
  });

  // Wait for all individual files to complete
  const itemResults = await Promise.allSettled(itemPromises);

  // Log results
  const successCount = itemResults.filter((result) => result.status === 'fulfilled' && result.value.success).length;

  if (successCount < items.length) {
    console.warn(`Generated ${successCount}/${items.length} individual RSL files for collection '${collectionName}'`);
  }
}

/**
 * Generates a collection-level RSL file
 * @param items - Collection items to include
 * @param collectionName - Name of the collection
 * @param collectionConfig - Collection-specific configuration
 * @param rslConfig - RSL configuration
 * @param websiteConfig - Website configuration
 * @param baseUrl - Base URL for the site
 * @param outputDir - Output directory
 * @param discoveredAssets - Discovered assets to include
 * @returns Promise that resolves when collection file is generated
 */
async function generateCollectionRSLFile(
  items: RSLCollectionItem[],
  collectionName: string,
  collectionConfig: RSLCollectionConfig,
  rslConfig: RSLConfiguration,
  websiteConfig: ExtendedWebsiteConfig,
  baseUrl: string,
  outputDir: string,
  discoveredAssets: RSLContentAsset[]
): Promise<void> {
  try {
    const collectionAssets = items.map((item) => convertItemToAsset(item, baseUrl));

    // Add any discovered assets that belong to this collection
    const collectionDiscoveredAssets = discoveredAssets.filter((asset) => asset.url.includes(`/${collectionName}/`));
    collectionAssets.push(...collectionDiscoveredAssets);

    const collectionLicense = getEffectiveLicenseConfiguration(rslConfig, collectionName);

    const rslXml = generateCollectionRSL(
      collectionAssets,
      collectionLicense,
      {
        name: collectionConfig.filename || collectionName,
        description: `${collectionName} collection from ${websiteConfig.title || 'website'}`,
        url: new URL(`/${collectionName}/`, baseUrl).toString(),
      },
      {
        prettyPrint: true,
        includeSchemaLocation: true,
        metadata: {
          generator: 'Anglesite 11ty',
          generatedAt: new Date(),
        },
      }
    );

    // Write collection RSL file
    const collectionDir = path.join(outputDir, collectionName);
    const rslFileName = `${collectionConfig.filename || collectionName}.rsl.xml`;
    const rslFilePath = path.join(collectionDir, rslFileName);

    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(rslFilePath, rslXml, 'utf-8');

    console.log(`Generated collection RSL: ${rslFilePath}`);
  } catch (error) {
    console.error(`Failed to generate collection RSL for ${collectionName}:`, error);
  }
}

/**
 * Generates RSL files for a collection in all requested formats
 * @param collectionName - Name of the collection
 * @param items - Collection items
 * @param rslConfig - RSL configuration
 * @param websiteConfig - Website configuration
 * @param outputDir - Output directory
 * @param discoveredAssets - All discovered assets
 * @returns Promise that resolves when generation is complete
 */
async function generateCollectionRSLFiles(
  collectionName: string,
  items: RSLCollectionItem[],
  rslConfig: RSLConfiguration,
  websiteConfig: ExtendedWebsiteConfig,
  outputDir: string,
  discoveredAssets: RSLContentAsset[]
): Promise<void> {
  const collectionConfig = rslConfig.collections?.[collectionName] || {};
  const outputFormats = collectionConfig.outputFormats || rslConfig.defaultOutputFormats || ['collection'];
  const baseUrl = websiteConfig.url || 'https://example.com';

  for (const format of outputFormats) {
    if (format === 'individual') {
      await generateIndividualRSLFiles(items, collectionName, rslConfig, baseUrl, outputDir);
    }

    if (format === 'collection') {
      await generateCollectionRSLFile(
        items,
        collectionName,
        collectionConfig,
        rslConfig,
        websiteConfig,
        baseUrl,
        outputDir,
        discoveredAssets
      );
    }
  }
}

/**
 * Generates site-wide RSL file
 * @param allItems - All collection items
 * @param rslConfig - RSL configuration
 * @param websiteConfig - Website configuration
 * @param outputDir - Output directory
 * @param discoveredAssets - All discovered assets
 * @returns Promise that resolves when generation is complete
 */
async function generateSiteRSLFile(
  allItems: RSLCollectionItem[],
  rslConfig: RSLConfiguration,
  websiteConfig: ExtendedWebsiteConfig,
  outputDir: string,
  discoveredAssets: RSLContentAsset[]
): Promise<void> {
  try {
    const baseUrl = websiteConfig.url || 'https://example.com';

    // Convert all items to assets
    const contentAssets = allItems.map((item) => convertItemToAsset(item, baseUrl));

    // Combine with discovered assets
    const allAssets = [...contentAssets, ...discoveredAssets];

    // Remove duplicates by URL
    const uniqueAssets = allAssets.filter((asset, index) => allAssets.findIndex((a) => a.url === asset.url) === index);

    const siteLicense = getEffectiveLicenseConfiguration(rslConfig);

    const rslXml = generateSiteRSL(
      uniqueAssets,
      siteLicense,
      {
        title: websiteConfig.title,
        description: websiteConfig.description,
        url: baseUrl,
        author: websiteConfig.author?.name,
        language: websiteConfig.language || 'en',
      },
      {
        prettyPrint: true,
        includeSchemaLocation: true,
        metadata: {
          generator: 'Anglesite 11ty',
          generatedAt: new Date(),
        },
      }
    );

    // Validate the generated XML
    const validation = validateRSLXML(rslXml);
    if (!validation.valid) {
      console.warn('Generated site RSL has validation errors:', validation.errors);
    }
    if (validation.warnings.length > 0) {
      console.info('Site RSL validation warnings:', validation.warnings);
    }

    // Write site-wide RSL file
    const rslFilePath = path.join(outputDir, 'rsl.xml');
    fs.writeFileSync(rslFilePath, rslXml, 'utf-8');

    console.log(`Generated site-wide RSL: ${rslFilePath} (${uniqueAssets.length} assets)`);
  } catch (error) {
    console.error('Failed to generate site-wide RSL:', error);
  }
}

/**
 * Main RSL plugin function for Eleventy
 * @param eleventyConfig - Eleventy configuration object
 */
export default function addRSL(eleventyConfig: EleventyConfig): void {
  // Store collections reference for later use
  let collections: ExtendedCollectionApi | null = null;
  eleventyConfig.addCollection('_rslCollectionCapture', function (collectionApi: EleventyCollectionApi) {
    collections = collectionApi as ExtendedCollectionApi;
    return [];
  });

  // Hook into Eleventy's after-build event
  eleventyConfig.on('eleventy.after', async ({ dir, results }: EleventyAfterEvent) => {
    if (!results || results.length === 0) {
      console.log('RSL: No build results, skipping RSL generation');
      return;
    }

    // Get website configuration
    const websiteConfig = await getWebsiteConfiguration(results, dir.input);
    if (!websiteConfig) {
      console.log('RSL: No website configuration found, skipping RSL generation');
      return;
    }

    // Check if RSL is enabled
    if (!websiteConfig.rsl?.enabled && websiteConfig.rsl?.enabled !== undefined) {
      console.log('RSL: RSL generation is disabled');
      return;
    }

    // Normalize and validate RSL configuration
    const rslConfig = normalizeRSLConfiguration(websiteConfig.rsl || {});
    const validation = validateRSLConfiguration(rslConfig);

    if (!validation.valid) {
      console.error('RSL: Invalid RSL configuration:', validation.errors);
      return;
    }

    if (validation.errors.length > 0) {
      console.warn(
        'RSL: RSL configuration warnings:',
        validation.errors.filter((e) => e.severity === 'warning')
      );
    }

    console.log('RSL: Starting RSL generation...');

    try {
      // Discover content assets
      const baseUrl = websiteConfig.url || 'https://example.com';
      const discoveredAssets = await discoverContentAssets(dir.input, rslConfig.contentDiscovery || {}, baseUrl);

      console.log(`RSL: Discovered ${discoveredAssets.length} assets`);

      if (!collections) {
        console.warn('RSL: No collections available, generating site-wide RSL only');
        await generateSiteRSLFile(
          results as RSLCollectionItem[],
          rslConfig,
          websiteConfig,
          dir.output,
          discoveredAssets
        );
        return;
      }

      // Discover and process all collections (explicit + auto-discovered)
      const allRSLCollections = getAllRSLCollections(collections, rslConfig);
      const defaultFormats = rslConfig.defaultOutputFormats || ['sitewide'];

      // Track which output formats are requested
      const requestedFormats = new Set<RSLOutputFormat>();

      // Add default formats first
      defaultFormats.forEach((format) => requestedFormats.add(format));

      // Add collection-specific formats
      Object.values(rslConfig.collections || {}).forEach((config) => {
        (config.outputFormats || []).forEach((format) => requestedFormats.add(format));
      });

      console.log(`RSL: Processing ${allRSLCollections.length} collections: ${allRSLCollections.join(', ')}`);

      // Generate RSL files for all collections in parallel
      const collectionPromises = allRSLCollections.map(async (collectionName) => {
        try {
          if (!collections) {
            throw new Error('Collections API is not available');
          }

          const collectionItems = collections.getFilteredByTag(collectionName);
          if (collectionItems && collectionItems.length > 0) {
            console.log(`RSL: Generating RSL for collection '${collectionName}' (${collectionItems.length} items)`);
            await generateCollectionRSLFiles(
              collectionName,
              collectionItems as RSLCollectionItem[],
              rslConfig,
              websiteConfig,
              dir.output,
              discoveredAssets
            );
          } else {
            console.log(`RSL: No items found for collection '${collectionName}'`);
          }
        } catch (error) {
          console.error(`RSL: Failed to process collection ${collectionName}:`, error);
          throw error; // Re-throw to be handled by Promise.allSettled
        }
      });

      // Process all collections in parallel with error resilience
      const collectionResults = await Promise.allSettled(collectionPromises);

      // Log any failed collections
      const failedCollections = collectionResults
        .map((result, index) => ({ result, collectionName: allRSLCollections[index] }))
        .filter(({ result }) => result.status === 'rejected');

      if (failedCollections.length > 0) {
        console.error(`RSL: ${failedCollections.length} collection(s) failed to process:`);
        failedCollections.forEach(({ collectionName, result }) => {
          console.error(`RSL: - ${collectionName}: ${(result as PromiseRejectedResult).reason}`);
        });
      }

      const successfulCollections = collectionResults.filter((result) => result.status === 'fulfilled').length;
      console.log(`RSL: Successfully processed ${successfulCollections}/${allRSLCollections.length} collections`);

      // Generate site-wide RSL if requested
      if (requestedFormats.has('sitewide')) {
        await generateSiteRSLFile(
          results as RSLCollectionItem[],
          rslConfig,
          websiteConfig,
          dir.output,
          discoveredAssets
        );
      }

      console.log('RSL: RSL generation complete');
    } catch (error) {
      console.error('RSL: Failed to generate RSL files:', error);
    }
  });

  console.log('RSL: RSL plugin initialized');
}
