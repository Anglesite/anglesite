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
import { createPluginLogger } from '../lib/build-logger.js';

/**
 * Plugin-specific logger for RSL operations
 */
const logger = createPluginLogger('RSL');

/**
 * Extended website configuration that includes RSL settings.
 *
 * Extends the base AnglesiteWebsiteConfiguration to include optional RSL
 * (Really Simple Licensing) configuration. This interface is used throughout
 * the RSL plugin to access both website metadata and licensing information.
 *
 * The RSL configuration is optional - if not provided, the plugin will skip
 * RSL generation. When present, it controls license templates, collection
 * configurations, and output formats for generated RSL files.
 * @augments AnglesiteWebsiteConfiguration
 * @example
 * ```typescript
 * const config: ExtendedWebsiteConfig = {
 *   title: 'My Website',
 *   url: 'https://example.com',
 *   language: 'en',
 *   rsl: {
 *     enabled: true,
 *     defaultLicense: 'CC-BY-4.0',
 *     collections: {
 *       posts: { outputFormats: ['individual', 'collection'] },
 *       blog: { outputFormats: ['collection'] }
 *     },
 *     defaultOutputFormats: ['sitewide']
 *   }
 * };
 * ```
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
 * Extended collection item with RSL-specific data.
 *
 * Extends the standard EleventyCollectionItem to include RSL licensing metadata.
 * This interface represents individual content items (pages, posts, etc.) that
 * can have licensing information attached for RSL generation.
 *
 * The RSL-specific fields allow content to specify custom licensing either
 * through direct license configuration or license template names. If neither
 * is provided, the item will inherit the collection or site-wide license.
 * @augments EleventyCollectionItem
 * @example
 * ```typescript
 * // Content with custom RSL license configuration
 * const item: RSLCollectionItem = {
 *   url: '/posts/my-article/',
 *   content: '<p>Article content...</p>',
 *   data: {
 *     title: 'My Article',
 *     author: 'John Doe',
 *     date: new Date('2024-01-01'),
 *     rsl: {
 *       license: 'CC-BY-4.0',
 *       attribution: 'John Doe',
 *       permissions: ['commercial', 'derivative']
 *     }
 *   }
 * };
 *
 * // Content using license template
 * const templateItem: RSLCollectionItem = {
 *   url: '/posts/another-article/',
 *   data: {
 *     title: 'Another Article',
 *     license: 'creative-commons-by' // References license template
 *   }
 * };
 * ```
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
    logger.warn(`Failed to read website configuration for RSL: ${error}`);
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
        logger.warn(
          `Failed to resolve license ${item.data.license} for ${item.url}: ${resolution.warnings.join(', ')}`
        );
      }
    } else {
      itemLicense = item.data.license;
    }
  }

  return getEffectiveLicenseConfiguration(rslConfig, collectionName, itemLicense);
}

/**
 * Converts Eleventy collection item to RSL content asset.
 *
 * Transforms an Eleventy collection item (page, post, etc.) into an RSL
 * content asset with the metadata needed for RSL XML generation. This
 * includes resolving the canonical URL, determining content type, and
 * extracting modification dates and size information.
 *
 * The function handles URL resolution by preferring the item's URL, falling
 * back to permalink data, and using the root path as a final fallback.
 * Content size is determined from the template content length when available.
 * @param item - Collection item from Eleventy build results
 * @param baseUrl - Base URL for the site to resolve relative URLs
 * @returns Content asset with URL, type, modification date, and size
 * @example
 * ```typescript
 * const item: RSLCollectionItem = {
 *   url: '/posts/my-article/',
 *   templateContent: '<h1>My Article</h1><p>Content...</p>',
 *   data: {
 *     title: 'My Article',
 *     date: new Date('2024-01-01')
 *   }
 * };
 *
 * const asset = convertItemToAsset(item, 'https://example.com');
 * // Result:
 * // {
 * //   url: 'https://example.com/posts/my-article/',
 * //   type: 'text/html',
 * //   lastmod: new Date('2024-01-01'),
 * //   size: 35
 * // }
 * ```
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
      logger.error(`Failed to generate individual RSL for ${item.url}:`, error);
      return { success: false, url: item.url, error };
    }
  });

  // Wait for all individual files to complete
  const itemResults = await Promise.allSettled(itemPromises);

  // Log results
  const successCount = itemResults.filter((result) => result.status === 'fulfilled' && result.value.success).length;

  if (successCount < items.length) {
    logger.warn(`Generated ${successCount}/${items.length} individual RSL files for collection '${collectionName}'`);
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

    logger.info(`Generated collection RSL: ${rslFilePath}`);
  } catch (error) {
    logger.error(`Failed to generate collection RSL for ${collectionName}:`, error);
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
      logger.warn(`Generated site RSL has validation errors: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      logger.info(`Site RSL validation warnings: ${validation.warnings.join(', ')}`);
    }

    // Write site-wide RSL file
    const rslFilePath = path.join(outputDir, 'rsl.xml');
    fs.writeFileSync(rslFilePath, rslXml, 'utf-8');

    logger.info(`Generated site-wide RSL: ${rslFilePath} (${uniqueAssets.length} assets)`);
  } catch (error) {
    logger.error('Failed to generate site-wide RSL:', error);
  }
}

/**
 * Main RSL plugin function for Eleventy.
 *
 * This plugin adds Really Simple Licensing (RSL) support to Eleventy sites,
 * automatically generating RSL XML files for content licensing information.
 * The plugin hooks into Eleventy's build process and generates RSL files
 * after the site is built.
 *
 * **Key Features:**
 * - Automatic RSL XML generation for individual content items
 * - Collection-level RSL files for grouped content
 * - Site-wide RSL files covering all content
 * - Flexible license configuration via templates or direct specification
 * - Content discovery for static assets
 * - Validation of generated RSL XML
 *
 * **Configuration:**
 * RSL configuration is defined in the website's `_data/website.json` file
 * under the `rsl` property. If no configuration is provided or RSL is
 * disabled, the plugin will skip generation.
 *
 * **Generated Files:**
 * - Individual: `[content-path]/[filename].rsl.xml` for each content item
 * - Collection: `[collection]/[collection].rsl.xml` for each collection
 * - Site-wide: `rsl.xml` at the site root
 * @param eleventyConfig - Eleventy configuration object to register plugin hooks
 * @example
 * ```typescript
 * // In .eleventy.js or eleventy.config.js
 * import addRSL from './plugins/rsl.js';
 *
 * export default function(eleventyConfig) {
 *   // Add RSL plugin
 *   eleventyConfig.addPlugin(addRSL);
 *
 *   return {
 *     dir: {
 *       input: 'src',
 *       output: '_site'
 *     }
 *   };
 * }
 * ```
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
      logger.info('No build results, skipping RSL generation');
      return;
    }

    // Get website configuration
    const websiteConfig = await getWebsiteConfiguration(results, dir.input);
    if (!websiteConfig) {
      logger.info('No website configuration found, skipping RSL generation');
      return;
    }

    // Check if RSL is enabled
    if (!websiteConfig.rsl?.enabled && websiteConfig.rsl?.enabled !== undefined) {
      logger.info('RSL generation is disabled');
      return;
    }

    // Normalize and validate RSL configuration
    const rslConfig = normalizeRSLConfiguration(websiteConfig.rsl || {});
    const validation = validateRSLConfiguration(rslConfig);

    if (!validation.valid) {
      logger.error(`Invalid RSL configuration: ${validation.errors.join(', ')}`);
      return;
    }

    if (validation.errors.length > 0) {
      logger.warn(
        `RSL configuration warnings: ${validation.errors.filter((e) => e.severity === 'warning').join(', ')}`
      );
    }

    logger.info('Starting RSL generation...');

    try {
      // Discover content assets
      const baseUrl = websiteConfig.url || 'https://example.com';
      const discoveredAssets = await discoverContentAssets(dir.input, rslConfig.contentDiscovery || {}, baseUrl);

      logger.info(`Discovered ${discoveredAssets.length} assets`);

      if (!collections) {
        logger.warn('No collections available, generating site-wide RSL only');
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

      logger.info(`Processing ${allRSLCollections.length} collections: ${allRSLCollections.join(', ')}`);

      // Generate RSL files for all collections in parallel
      const collectionPromises = allRSLCollections.map(async (collectionName) => {
        try {
          if (!collections) {
            throw new Error('Collections API is not available');
          }

          const collectionItems = collections.getFilteredByTag(collectionName);
          if (collectionItems && collectionItems.length > 0) {
            logger.info(`Generating RSL for collection '${collectionName}' (${collectionItems.length} items)`);
            await generateCollectionRSLFiles(
              collectionName,
              collectionItems as RSLCollectionItem[],
              rslConfig,
              websiteConfig,
              dir.output,
              discoveredAssets
            );
          } else {
            logger.info(`No items found for collection '${collectionName}'`);
          }
        } catch (error) {
          logger.error(`Failed to process collection ${collectionName}:`, error);
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
        logger.error(`${failedCollections.length} collection(s) failed to process:`);
        failedCollections.forEach(({ collectionName, result }) => {
          logger.error(`- ${collectionName}: ${(result as PromiseRejectedResult).reason}`);
        });
      }

      const successfulCollections = collectionResults.filter((result) => result.status === 'fulfilled').length;
      logger.info(`Successfully processed ${successfulCollections}/${allRSLCollections.length} collections`);

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

      logger.info('RSL generation complete');
    } catch (error) {
      logger.error('Failed to generate RSL files:', error);
    }
  });

  logger.info('RSL plugin initialized');
}
