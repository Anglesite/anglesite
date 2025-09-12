/**
 * RSL Configuration Module
 * Handles parsing, validation, and inheritance of RSL configurations
 */

import type {
  RSLConfiguration,
  RSLLicenseConfiguration,
  RSLValidationResult,
  RSLValidationError,
  RSLPermissionType,
  RSLPaymentType,
  RSLOutputFormat,
  RSLLicenseTemplate,
} from './types.js';

/**
 * Default RSL configuration with sensible defaults
 */
export const DEFAULT_RSL_CONFIG: Required<RSLConfiguration> = {
  enabled: true,
  defaultOutputFormats: ['sitewide', 'collection'],
  copyright: '',
  defaultLicense: {
    permits: [
      { type: 'usage', values: ['view', 'download'] },
      { type: 'user', values: ['individual'] },
    ],
    prohibits: [{ type: 'usage', values: ['ai-training', 'crawl'] }],
    payment: {
      type: 'free',
      attribution: true,
    },
    copyright: '',
  },
  collections: {},
  contentDiscovery: {
    enabled: true,
    maxDepth: 10,
    includeExtensions: [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.svg',
      '.webp',
      '.pdf',
      '.doc',
      '.docx',
      '.txt',
      '.md',
      '.mp3',
      '.mp4',
      '.wav',
      '.avi',
      '.mov',
      '.html',
      '.css',
      '.js',
      '.json',
      '.xml',
    ],
    excludeExtensions: ['.tmp', '.log', '.cache'],
    excludeDirectories: ['node_modules', '.git', '_site', 'dist', 'coverage'],
    generateChecksums: true,
  },
  templates: {
    builtin: {},
    apis: {},
    custom: {},
  },
  mainCollection: '',
  autoDiscoverCollections: false,
  includeCollections: [],
  excludeCollections: [],
};

/**
 * Built-in license templates for common scenarios
 */
export const BUILTIN_LICENSE_TEMPLATES: Record<string, RSLLicenseTemplate> = {
  CC0: {
    id: 'CC0',
    name: 'Creative Commons Zero (Public Domain)',
    license: {
      permits: [
        { type: 'usage', values: ['view', 'download', 'modify', 'distribute', 'commercial'] },
        { type: 'user', values: ['individual', 'commercial', 'government'] },
        { type: 'geo', values: ['worldwide'] },
      ],
      prohibits: [],
      payment: { type: 'free', attribution: false },
      standard: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
  },
  'CC-BY-4.0': {
    id: 'CC-BY-4.0',
    name: 'Creative Commons Attribution 4.0',
    license: {
      permits: [
        { type: 'usage', values: ['view', 'download', 'modify', 'distribute', 'commercial'] },
        { type: 'user', values: ['individual', 'commercial', 'government'] },
        { type: 'geo', values: ['worldwide'] },
      ],
      prohibits: [],
      payment: { type: 'free', attribution: true },
      standard: 'https://creativecommons.org/licenses/by/4.0/',
    },
  },
  'CC-BY-NC-4.0': {
    id: 'CC-BY-NC-4.0',
    name: 'Creative Commons Attribution-NonCommercial 4.0',
    license: {
      permits: [
        { type: 'usage', values: ['view', 'download', 'modify', 'distribute'] },
        { type: 'user', values: ['individual', 'educational'] },
        { type: 'geo', values: ['worldwide'] },
      ],
      prohibits: [
        { type: 'usage', values: ['commercial'] },
        { type: 'user', values: ['commercial'] },
      ],
      payment: { type: 'free', attribution: true },
      standard: 'https://creativecommons.org/licenses/by-nc/4.0/',
    },
  },
  ALL_RIGHTS_RESERVED: {
    id: 'ALL_RIGHTS_RESERVED',
    name: 'All Rights Reserved',
    license: {
      permits: [
        { type: 'usage', values: ['view'] },
        { type: 'user', values: ['individual'] },
      ],
      prohibits: [
        { type: 'usage', values: ['download', 'modify', 'distribute', 'commercial', 'ai-training', 'crawl'] },
        { type: 'user', values: ['commercial', 'government'] },
      ],
      payment: { type: 'purchase' },
    },
  },
  NO_AI_TRAINING: {
    id: 'NO_AI_TRAINING',
    name: 'No AI Training (View Only)',
    license: {
      permits: [
        { type: 'usage', values: ['view'] },
        { type: 'user', values: ['individual', 'educational'] },
      ],
      prohibits: [{ type: 'usage', values: ['ai-training', 'crawl', 'inference'] }],
      payment: { type: 'free', attribution: false },
    },
  },
};

/**
 * Validates RSL permission type
 * @param type - The type to validate
 * @returns Whether the type is a valid RSL permission type
 */
function isValidPermissionType(type: unknown): type is RSLPermissionType {
  const validTypes: RSLPermissionType[] = ['usage', 'user', 'geo', 'ai-training', 'crawl', 'inference', 'search'];
  return typeof type === 'string' && validTypes.includes(type as RSLPermissionType);
}

/**
 * Validates RSL payment type
 * @param type - The type to validate
 * @returns Whether the type is a valid RSL payment type
 */
function isValidPaymentType(type: unknown): type is RSLPaymentType {
  const validTypes: RSLPaymentType[] = ['purchase', 'subscription', 'training', 'crawl', 'inference', 'free'];
  return typeof type === 'string' && validTypes.includes(type as RSLPaymentType);
}

/**
 * Validates RSL output format
 * @param format - The format to validate
 * @returns Whether the format is a valid RSL output format
 */
function isValidOutputFormat(format: unknown): format is RSLOutputFormat {
  const validFormats: RSLOutputFormat[] = ['individual', 'collection', 'sitewide'];
  return typeof format === 'string' && validFormats.includes(format as RSLOutputFormat);
}

/**
 * Validates URL format
 * @param url - The URL to validate
 * @returns Whether the URL is valid
 */
function isValidUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a license configuration object
 * @param license - The license configuration to validate
 * @param path - The path prefix for error messages
 * @returns Array of validation errors
 */
function validateLicenseConfiguration(license: unknown, path: string = 'license'): RSLValidationError[] {
  const errors: RSLValidationError[] = [];

  if (!license || typeof license !== 'object') {
    errors.push({
      path,
      message: 'License configuration must be an object',
      severity: 'error',
    });
    return errors;
  }

  const config = license as Record<string, unknown>;

  // Validate permits
  if (config.permits !== undefined) {
    if (!Array.isArray(config.permits)) {
      errors.push({
        path: `${path}.permits`,
        message: 'permits must be an array',
        severity: 'error',
      });
    } else {
      config.permits.forEach((permit, index) => {
        if (!permit || typeof permit !== 'object') {
          errors.push({
            path: `${path}.permits[${index}]`,
            message: 'Each permit must be an object',
            severity: 'error',
          });
        } else {
          const p = permit as Record<string, unknown>;
          if (p.type && !isValidPermissionType(p.type)) {
            errors.push({
              path: `${path}.permits[${index}].type`,
              message: `Invalid permission type: ${p.type}`,
              severity: 'error',
            });
          }
          if (p.values && !Array.isArray(p.values)) {
            errors.push({
              path: `${path}.permits[${index}].values`,
              message: 'Permission values must be an array',
              severity: 'error',
            });
          }
        }
      });
    }
  }

  // Validate prohibits (same structure as permits)
  if (config.prohibits !== undefined) {
    if (!Array.isArray(config.prohibits)) {
      errors.push({
        path: `${path}.prohibits`,
        message: 'prohibits must be an array',
        severity: 'error',
      });
    }
  }

  // Validate payment configuration
  if (config.payment !== undefined) {
    if (!config.payment || typeof config.payment !== 'object') {
      errors.push({
        path: `${path}.payment`,
        message: 'Payment configuration must be an object',
        severity: 'error',
      });
    } else {
      const payment = config.payment as Record<string, unknown>;
      if (!payment.type || !isValidPaymentType(payment.type)) {
        errors.push({
          path: `${path}.payment.type`,
          message: `Invalid payment type: ${payment.type}`,
          severity: 'error',
        });
      }
      if (payment.amount !== undefined && typeof payment.amount !== 'number') {
        errors.push({
          path: `${path}.payment.amount`,
          message: 'Payment amount must be a number',
          severity: 'error',
        });
      }
      if (payment.amount !== undefined && (payment.amount as number) < 0) {
        errors.push({
          path: `${path}.payment.amount`,
          message: 'Payment amount cannot be negative',
          severity: 'error',
        });
      }
      if (payment.url && !isValidUrl(payment.url)) {
        errors.push({
          path: `${path}.payment.url`,
          message: 'Payment URL must be a valid URL',
          severity: 'error',
        });
      }
    }
  }

  // Validate URLs
  if (config.standard && !isValidUrl(config.standard)) {
    errors.push({
      path: `${path}.standard`,
      message: 'Standard license URL must be a valid URL',
      severity: 'error',
    });
  }

  if (config.custom && !isValidUrl(config.custom)) {
    errors.push({
      path: `${path}.custom`,
      message: 'Custom license URL must be a valid URL',
      severity: 'error',
    });
  }

  if (config.terms && !isValidUrl(config.terms)) {
    errors.push({
      path: `${path}.terms`,
      message: 'Terms URL must be a valid URL',
      severity: 'error',
    });
  }

  return errors;
}

/**
 * Validates RSL configuration
 * @param config - The RSL configuration to validate
 * @returns Validation result with errors and validity status
 */
export function validateRSLConfiguration(config: unknown): RSLValidationResult {
  const errors: RSLValidationError[] = [];

  if (!config || typeof config !== 'object') {
    return {
      valid: false,
      errors: [
        {
          path: 'rsl',
          message: 'RSL configuration must be an object',
          severity: 'error',
        },
      ],
    };
  }

  const rslConfig = config as Record<string, unknown>;

  // Validate enabled flag
  if (rslConfig.enabled !== undefined && typeof rslConfig.enabled !== 'boolean') {
    errors.push({
      path: 'rsl.enabled',
      message: 'enabled must be a boolean',
      severity: 'error',
    });
  }

  // Validate defaultOutputFormats
  if (rslConfig.defaultOutputFormats !== undefined) {
    if (!Array.isArray(rslConfig.defaultOutputFormats)) {
      errors.push({
        path: 'rsl.defaultOutputFormats',
        message: 'defaultOutputFormats must be an array',
        severity: 'error',
      });
    } else {
      rslConfig.defaultOutputFormats.forEach((format, index) => {
        if (!isValidOutputFormat(format)) {
          errors.push({
            path: `rsl.defaultOutputFormats[${index}]`,
            message: `Invalid output format: ${format}`,
            severity: 'error',
          });
        }
      });
    }
  }

  // Validate default license
  if (rslConfig.defaultLicense !== undefined) {
    errors.push(...validateLicenseConfiguration(rslConfig.defaultLicense, 'rsl.defaultLicense'));
  }

  // Validate collections
  if (rslConfig.collections !== undefined) {
    if (!rslConfig.collections || typeof rslConfig.collections !== 'object') {
      errors.push({
        path: 'rsl.collections',
        message: 'collections must be an object',
        severity: 'error',
      });
    } else {
      const collections = rslConfig.collections as Record<string, unknown>;
      Object.entries(collections).forEach(([name, collectionConfig]) => {
        errors.push(...validateLicenseConfiguration(collectionConfig, `rsl.collections.${name}`));
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  };
}

/**
 * Merges RSL configurations with proper inheritance
 * Child configurations override parent configurations
 * @param parent - The parent license configuration
 * @param child - The child license configuration that overrides parent
 * @returns Merged license configuration
 */
export function mergeRSLConfigurations(
  parent: RSLLicenseConfiguration | undefined,
  child: RSLLicenseConfiguration | undefined
): RSLLicenseConfiguration {
  if (!parent) return child || {};
  if (!child) return parent;

  return {
    permits: child.permits || parent.permits,
    prohibits: child.prohibits || parent.prohibits,
    payment: child.payment || parent.payment,
    standard: child.standard || parent.standard,
    custom: child.custom || parent.custom,
    copyright: child.copyright || parent.copyright,
    terms: child.terms || parent.terms,
    legal: child.legal || parent.legal,
    schema: child.schema || parent.schema,
  };
}

/**
 * Resolves license template by ID
 * @param templateId - The template ID to resolve
 * @param templates - The templates configuration
 * @returns The resolved license template or null if not found
 */
export function resolveLicenseTemplate(
  templateId: string,
  templates?: RSLConfiguration['templates']
): RSLLicenseTemplate | null {
  // Check built-in templates first
  if (BUILTIN_LICENSE_TEMPLATES[templateId]) {
    return BUILTIN_LICENSE_TEMPLATES[templateId];
  }

  // Check custom templates
  if (templates?.custom?.[templateId]) {
    return templates.custom[templateId];
  }

  // Check configured built-in overrides
  if (templates?.builtin?.[templateId]) {
    return templates.builtin[templateId];
  }

  return null;
}

/**
 * Normalizes RSL configuration by applying defaults and resolving templates
 * @param config - The partial RSL configuration to normalize
 * @returns Normalized RSL configuration with defaults applied
 */
export function normalizeRSLConfiguration(config: Partial<RSLConfiguration>): RSLConfiguration {
  const normalized: RSLConfiguration = {
    ...DEFAULT_RSL_CONFIG,
    ...config,
  };

  // Merge built-in templates with any custom overrides
  normalized.templates = {
    ...DEFAULT_RSL_CONFIG.templates,
    builtin: {
      ...BUILTIN_LICENSE_TEMPLATES,
      ...config.templates?.builtin,
    },
    apis: {
      ...DEFAULT_RSL_CONFIG.templates.apis,
      ...config.templates?.apis,
    },
    custom: {
      ...DEFAULT_RSL_CONFIG.templates.custom,
      ...config.templates?.custom,
    },
  };

  return normalized;
}

/**
 * Gets effective license configuration for a specific context
 * Applies inheritance: site -> collection -> content
 * @param rslConfig - The RSL configuration
 * @param collectionName - The collection name for collection-level overrides
 * @param contentLicense - Content-specific license configuration
 * @returns Effective license configuration with inheritance applied
 */
export function getEffectiveLicenseConfiguration(
  rslConfig: RSLConfiguration,
  collectionName?: string,
  contentLicense?: RSLLicenseConfiguration
): RSLLicenseConfiguration {
  let effective = rslConfig.defaultLicense || {};

  // If there's a top-level copyright and the effective license doesn't have one, inherit it
  if (rslConfig.copyright && !effective.copyright) {
    effective = { ...effective, copyright: rslConfig.copyright };
  }

  // Apply collection-level overrides
  if (collectionName && rslConfig.collections?.[collectionName]) {
    const collectionConfig = rslConfig.collections[collectionName];
    let collectionLicense = collectionConfig;

    // Inherit top-level copyright if collection license doesn't specify one
    if (rslConfig.copyright && !collectionLicense.copyright) {
      collectionLicense = { ...collectionLicense, copyright: rslConfig.copyright };
    }

    effective = mergeRSLConfigurations(effective, collectionLicense);
  }

  // Apply content-level overrides
  if (contentLicense) {
    let contentLicenseWithInheritance = contentLicense;

    // Inherit top-level copyright if content license doesn't specify one
    if (rslConfig.copyright && !contentLicense.copyright) {
      contentLicenseWithInheritance = { ...contentLicense, copyright: rslConfig.copyright };
    }

    effective = mergeRSLConfigurations(effective, contentLicenseWithInheritance);
  }

  return effective;
}

/**
 * Checks if a collection name matches any of the given glob patterns
 * @param collectionName - The collection name to test
 * @param patterns - Array of glob-style patterns
 * @returns Whether the collection name matches any pattern
 */
function matchesPatterns(collectionName: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;

  return patterns.some((pattern) => {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*') // Convert * to .*
      .replace(/\?/g, '.'); // Convert ? to .

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(collectionName);
  });
}

/**
 * Discovers all available collections from Eleventy's collection API
 * @param collectionApi - The Eleventy collection API object
 * @param collectionApi.getAll - Function that returns all collection items with their data
 * @param rslConfig - The RSL configuration
 * @returns Array of discovered collection names
 */
export function discoverCollections(
  collectionApi: { getAll(): { data: { tags?: string | string[]; [key: string]: unknown } }[] },
  rslConfig: RSLConfiguration
): string[] {
  if (!rslConfig.autoDiscoverCollections) {
    return [];
  }

  // Get all items from collections
  const allItems = collectionApi.getAll();

  // Extract unique tags/collections from all items
  const collectionSet = new Set<string>();

  allItems.forEach((item) => {
    const tags = item.data?.tags;
    if (tags) {
      if (typeof tags === 'string') {
        collectionSet.add(tags);
      } else if (Array.isArray(tags)) {
        tags.forEach((tag) => {
          if (typeof tag === 'string' && tag.trim()) {
            collectionSet.add(tag.trim());
          }
        });
      }
    }
  });

  let discoveredCollections = Array.from(collectionSet);

  // Apply include patterns
  if (rslConfig.includeCollections && rslConfig.includeCollections.length > 0) {
    discoveredCollections = discoveredCollections.filter((name) =>
      matchesPatterns(name, rslConfig.includeCollections!)
    );
  }

  // Apply exclude patterns
  if (rslConfig.excludeCollections && rslConfig.excludeCollections.length > 0) {
    discoveredCollections = discoveredCollections.filter(
      (name) => !matchesPatterns(name, rslConfig.excludeCollections!)
    );
  }

  // Filter out system collections and empty names
  discoveredCollections = discoveredCollections.filter(
    (name) =>
      name &&
      name.trim() &&
      !name.startsWith('_') && // Exclude system collections like _rslCollectionCapture
      name !== 'all' && // Exclude Eleventy's built-in 'all' collection
      name !== 'nav' // Exclude common navigation collections
  );

  return discoveredCollections.sort();
}

/**
 * Gets all collections that should have RSL generated (explicit + discovered)
 * @param collectionApi - The Eleventy collection API object
 * @param collectionApi.getAll - Function that returns all collection items with their data
 * @param rslConfig - The RSL configuration
 * @returns Array of collection names to process
 */
export function getAllRSLCollections(
  collectionApi: { getAll(): { data: { tags?: string | string[]; [key: string]: unknown } }[] },
  rslConfig: RSLConfiguration
): string[] {
  const explicitCollections = Object.keys(rslConfig.collections || {});
  const discoveredCollections = discoverCollections(collectionApi, rslConfig);

  // Combine explicit and discovered collections, removing duplicates
  const allCollections = Array.from(new Set([...explicitCollections, ...discoveredCollections]));

  // Filter out disabled collections
  return allCollections.filter((collectionName) => isRSLEnabledForCollection(rslConfig, collectionName));
}

/**
 * Checks if RSL is enabled for a specific collection
 * @param rslConfig - The RSL configuration
 * @param collectionName - The collection name to check
 * @returns Whether RSL is enabled for the collection
 */
export function isRSLEnabledForCollection(rslConfig: RSLConfiguration, collectionName: string): boolean {
  if (!rslConfig.enabled) {
    return false;
  }

  const collectionConfig = rslConfig.collections?.[collectionName];
  return collectionConfig?.enabled !== false; // undefined means enabled (opt-out)
}
