/**
 * RSL Generation Module
 * Generates RSL 1.0 compliant XML for different scopes
 */

import { create } from 'xmlbuilder2';
import type { RSLContentAsset, RSLLicenseConfiguration, RSLPermissionSet, RSLPaymentConfiguration } from './types.js';

/**
 * RSL namespace and schema information
 */
const RSL_NAMESPACE = 'https://rslstandard.org/rsl';
const RSL_SCHEMA_LOCATION = 'https://rslstandard.org/rsl https://rslstandard.org/rsl/schema/rsl-1.0.xsd';

/**
 * Options for RSL generation
 */
export interface RSLGenerationOptions {
  /** Whether to include schema location */
  includeSchemaLocation?: boolean;
  /** Whether to pretty-print the XML */
  prettyPrint?: boolean;
  /** Additional metadata to include */
  metadata?: {
    generator?: string;
    generatedAt?: Date;
  };
}

/**
 * Formats a date for RSL XML output
 * @param date - The date to format
 * @returns ISO 8601 formatted date string
 */
function formatRSLDate(date: Date): string {
  return date.toISOString();
}

/**
 * Escapes XML content to prevent injection
 * @param content - Content to escape
 * @returns Escaped content safe for XML
 */
function escapeXMLContent(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates permission elements for RSL XML
 * @param permissions - Array of permission sets
 * @param elementName - Name of the XML element (permits or prohibits)
 * @returns XML element object
 */
function generatePermissionElements(
  permissions: RSLPermissionSet[],
  elementName: 'permits' | 'prohibits'
): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];

  for (const permissionSet of permissions) {
    const attributes: Record<string, string> = {};

    if (permissionSet.type) {
      attributes.type = permissionSet.type;
    }

    if (permissionSet.values && permissionSet.values.length > 0) {
      elements.push({
        [elementName]: {
          '@type': permissionSet.type || 'usage',
          '#text': permissionSet.values.join(','),
        },
      });
    } else {
      elements.push({
        [elementName]: {
          '@type': permissionSet.type || 'usage',
        },
      });
    }
  }

  return elements;
}

/**
 * Generates payment element for RSL XML
 * @param payment - Payment configuration
 * @returns XML element object or null
 */
function generatePaymentElement(payment: RSLPaymentConfiguration): Record<string, unknown> | null {
  if (!payment) return null;

  const paymentElement: Record<string, unknown> = {
    '@type': payment.type,
  };

  if (payment.amount !== undefined) {
    paymentElement['amount'] = {
      '@currency': payment.currency || 'USD',
      '#text': payment.amount.toString(),
    };
  }

  if (payment.url) {
    paymentElement['@url'] = payment.url;
  }

  if (payment.attribution !== undefined) {
    paymentElement['@attribution'] = payment.attribution.toString();
  }

  return { payment: paymentElement };
}

/**
 * Generates content element for RSL XML
 * @param asset - Content asset information
 * @returns XML element object
 */
function generateContentElement(asset: RSLContentAsset): Record<string, unknown> {
  const attributes: Record<string, string> = {
    url: asset.url,
  };

  if (asset.server) {
    attributes.server = asset.server;
  }

  if (asset.encrypted !== undefined) {
    attributes.encrypted = asset.encrypted.toString();
  }

  if (asset.lastmod) {
    attributes.lastmod = formatRSLDate(asset.lastmod);
  }

  const contentElement: Record<string, unknown> = {
    '@': attributes,
  };

  // Add optional child elements
  const childElements: Record<string, unknown> = {};

  if (asset.size !== undefined) {
    childElements.size = asset.size.toString();
  }

  if (asset.type) {
    childElements.type = asset.type;
  }

  if (asset.checksum && asset.checksumAlgorithm) {
    childElements.checksum = {
      '@algorithm': asset.checksumAlgorithm,
      '#text': asset.checksum,
    };
  }

  if (Object.keys(childElements).length > 0) {
    Object.assign(contentElement, childElements);
  }

  return { content: contentElement };
}

/**
 * Generates license element for RSL XML
 * @param license - License configuration
 * @returns XML element object
 */
function generateLicenseElement(license: RSLLicenseConfiguration): Record<string, unknown> {
  const licenseElement: Record<string, unknown> = {};

  // Add permission sets
  if (license.permits && license.permits.length > 0) {
    const permitElements = generatePermissionElements(license.permits, 'permits');
    licenseElement.permits = permitElements.map((e) => e.permits);
  }

  if (license.prohibits && license.prohibits.length > 0) {
    const prohibitElements = generatePermissionElements(license.prohibits, 'prohibits');
    licenseElement.prohibits = prohibitElements.map((e) => e.prohibits);
  }

  // Add payment information
  if (license.payment) {
    const paymentElement = generatePaymentElement(license.payment);
    if (paymentElement) {
      licenseElement.payment = paymentElement.payment;
    }
  }

  // Add standard license reference
  if (license.standard) {
    licenseElement.standard = {
      '@url': license.standard,
    };
  }

  // Add custom license reference
  if (license.custom) {
    licenseElement.custom = {
      '@url': license.custom,
    };
  }

  // Add copyright notice
  if (license.copyright) {
    licenseElement.copyright = escapeXMLContent(license.copyright);
  }

  // Add terms reference
  if (license.terms) {
    licenseElement.terms = {
      '@url': license.terms,
    };
  }

  // Add legal information
  if (license.legal) {
    const legalElement: Record<string, unknown> = {};

    if (license.legal.warranty) {
      legalElement.warranty = escapeXMLContent(license.legal.warranty);
    }

    if (license.legal.liability) {
      legalElement.liability = escapeXMLContent(license.legal.liability);
    }

    if (license.legal.law) {
      legalElement.law = escapeXMLContent(license.legal.law);
    }

    if (Object.keys(legalElement).length > 0) {
      licenseElement.legal = legalElement;
    }
  }

  // Add schema.org metadata
  if (license.schema) {
    const schemaElement: Record<string, unknown> = {};

    if (license.schema.type) {
      schemaElement['@type'] = license.schema.type;
    }

    if (license.schema.properties) {
      Object.entries(license.schema.properties).forEach(([key, value]) => {
        schemaElement[key] = value;
      });
    }

    if (Object.keys(schemaElement).length > 0) {
      licenseElement.schema = schemaElement;
    }
  }

  return { license: licenseElement };
}

/**
 * Generates RSL XML for a single content asset
 * @param asset - Content asset
 * @param license - License configuration for the asset
 * @param options - Generation options
 * @returns RSL XML string
 */
export function generateIndividualRSL(
  asset: RSLContentAsset,
  license: RSLLicenseConfiguration,
  options: RSLGenerationOptions = {}
): string {
  const rootAttributes: Record<string, string> = {
    xmlns: RSL_NAMESPACE,
  };

  if (options.includeSchemaLocation) {
    rootAttributes['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
    rootAttributes['xsi:schemaLocation'] = RSL_SCHEMA_LOCATION;
  }

  const rslDocument = {
    rsl: {
      '@': rootAttributes,
      ...generateContentElement(asset),
      ...generateLicenseElement(license),
    },
  };

  // Add metadata if provided
  if (options.metadata) {
    const metadata: Record<string, unknown> = {};

    if (options.metadata.generator) {
      metadata.generator = escapeXMLContent(options.metadata.generator);
    }

    if (options.metadata.generatedAt) {
      metadata.generated = formatRSLDate(options.metadata.generatedAt);
    }

    if (Object.keys(metadata).length > 0) {
      rslDocument.rsl = { ...metadata, ...rslDocument.rsl };
    }
  }

  const xmlDoc = create(rslDocument);
  if (options.prettyPrint) {
    return xmlDoc.end({ prettyPrint: true, indent: '  ' });
  } else {
    return xmlDoc.end();
  }
}

/**
 * Generates RSL XML for a collection of assets
 * @param assets - Array of content assets
 * @param license - License configuration for the collection
 * @param collectionInfo - Additional collection metadata
 * @param collectionInfo.name - Collection name
 * @param collectionInfo.description - Collection description
 * @param collectionInfo.url - Collection URL
 * @param options - Generation options
 * @returns RSL XML string
 */
export function generateCollectionRSL(
  assets: RSLContentAsset[],
  license: RSLLicenseConfiguration,
  collectionInfo: {
    name?: string;
    description?: string;
    url?: string;
  } = {},
  options: RSLGenerationOptions = {}
): string {
  const rootAttributes: Record<string, string> = {
    xmlns: RSL_NAMESPACE,
  };

  if (options.includeSchemaLocation) {
    rootAttributes['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
    rootAttributes['xsi:schemaLocation'] = RSL_SCHEMA_LOCATION;
  }

  const rslElements: Record<string, unknown> = {
    '@': rootAttributes,
  };

  // Add collection metadata
  if (collectionInfo.name || collectionInfo.description || collectionInfo.url) {
    const collectionMetadata: Record<string, unknown> = {};

    if (collectionInfo.name) {
      collectionMetadata.name = escapeXMLContent(collectionInfo.name);
    }

    if (collectionInfo.description) {
      collectionMetadata.description = escapeXMLContent(collectionInfo.description);
    }

    if (collectionInfo.url) {
      collectionMetadata['@url'] = collectionInfo.url;
    }

    rslElements.collection = collectionMetadata;
  }

  // Add all content elements
  if (assets.length > 0) {
    rslElements.content = assets.map((asset) => generateContentElement(asset).content);
  }

  // Add license element
  const licenseElement = generateLicenseElement(license);
  if (Object.keys(licenseElement.license as Record<string, unknown>).length > 0) {
    rslElements.license = licenseElement.license;
  }

  // Add metadata if provided
  if (options.metadata) {
    const metadata: Record<string, unknown> = {};

    if (options.metadata.generator) {
      metadata.generator = escapeXMLContent(options.metadata.generator);
    }

    if (options.metadata.generatedAt) {
      metadata.generated = formatRSLDate(options.metadata.generatedAt);
    }

    if (Object.keys(metadata).length > 0) {
      Object.assign(rslElements, metadata);
    }
  }

  const rslDocument = { rsl: rslElements };

  const xmlDoc = create(rslDocument);
  if (options.prettyPrint) {
    return xmlDoc.end({ prettyPrint: true, indent: '  ' });
  } else {
    return xmlDoc.end();
  }
}

/**
 * Generates site-wide RSL XML
 * @param allAssets - All discovered assets on the site
 * @param license - Default license configuration
 * @param siteInfo - Site metadata
 * @param siteInfo.title - Site title
 * @param siteInfo.description - Site description
 * @param siteInfo.url - Site URL
 * @param siteInfo.author - Site author
 * @param siteInfo.language - Site language
 * @param options - Generation options
 * @returns RSL XML string
 */
export function generateSiteRSL(
  allAssets: RSLContentAsset[],
  license: RSLLicenseConfiguration,
  siteInfo: {
    title?: string;
    description?: string;
    url?: string;
    author?: string;
    language?: string;
  } = {},
  options: RSLGenerationOptions = {}
): string {
  const rootAttributes: Record<string, string> = {
    xmlns: RSL_NAMESPACE,
  };

  if (options.includeSchemaLocation) {
    rootAttributes['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
    rootAttributes['xsi:schemaLocation'] = RSL_SCHEMA_LOCATION;
  }

  const rslElements: Record<string, unknown> = {
    '@': rootAttributes,
  };

  // Add site metadata
  if (Object.keys(siteInfo as Record<string, unknown>).some((key) => (siteInfo as Record<string, unknown>)[key])) {
    const siteMetadata: Record<string, unknown> = {};

    if (siteInfo.title) {
      siteMetadata.title = escapeXMLContent(siteInfo.title);
    }

    if (siteInfo.description) {
      siteMetadata.description = escapeXMLContent(siteInfo.description);
    }

    if (siteInfo.url) {
      siteMetadata['@url'] = siteInfo.url;
    }

    if (siteInfo.author) {
      siteMetadata.author = escapeXMLContent(siteInfo.author);
    }

    if (siteInfo.language) {
      siteMetadata['@language'] = siteInfo.language;
    }

    rslElements.site = siteMetadata;
  }

  // Add all content elements
  if (allAssets.length > 0) {
    rslElements.content = allAssets.map((asset) => generateContentElement(asset).content);
  }

  // Add license element
  const licenseElement = generateLicenseElement(license);
  if (Object.keys(licenseElement.license as Record<string, unknown>).length > 0) {
    rslElements.license = licenseElement.license;
  }

  // Add metadata if provided
  if (options.metadata) {
    const metadata: Record<string, unknown> = {};

    if (options.metadata.generator) {
      metadata.generator = escapeXMLContent(options.metadata.generator);
    }

    if (options.metadata.generatedAt) {
      metadata.generated = formatRSLDate(options.metadata.generatedAt);
    }

    if (Object.keys(metadata).length > 0) {
      Object.assign(rslElements, metadata);
    }
  }

  const rslDocument = { rsl: rslElements };

  const xmlDoc = create(rslDocument);
  if (options.prettyPrint) {
    return xmlDoc.end({ prettyPrint: true, indent: '  ' });
  } else {
    return xmlDoc.end();
  }
}

/**
 * Validates generated RSL XML against basic structural requirements
 * @param xmlString - The RSL XML string to validate
 * @returns Validation result with any issues found
 */
export function validateRSLXML(xmlString: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Basic string-based validation for Node.js environment
    // Check if it starts with XML declaration
    if (!xmlString.startsWith('<?xml')) {
      errors.push('XML must start with XML declaration');
    }

    // Check for RSL root element
    if (!xmlString.includes('<rsl')) {
      errors.push('Root element must be <rsl>');
    }

    // Check for RSL namespace
    if (!xmlString.includes(`xmlns="${RSL_NAMESPACE}"`)) {
      errors.push(`Root element must have xmlns="${RSL_NAMESPACE}"`);
    }

    // Check for content elements
    const contentMatches = xmlString.match(/<content[^>]*>/g);
    if (!contentMatches || contentMatches.length === 0) {
      warnings.push('No content elements found - RSL should reference at least one asset');
    } else {
      // Check content elements have url attribute
      contentMatches.forEach((contentTag, index) => {
        if (!contentTag.includes('url=')) {
          errors.push(`Content element ${index + 1} missing required 'url' attribute`);
        }
      });
    }

    // Check for license element
    const licenseMatches = xmlString.match(/<license[^>]*>/g);
    if (!licenseMatches || licenseMatches.length === 0) {
      warnings.push('No license element found - RSL should specify licensing terms');
    } else if (licenseMatches.length > 1) {
      warnings.push('Multiple license elements found - only one is recommended');
    }

    // Basic XML well-formedness check
    const openTags = xmlString.match(/<[^/][^>]*>/g) || [];
    const closeTags = xmlString.match(/<\/[^>]*>/g) || [];
    const selfClosingTags = xmlString.match(/<[^>]*\/>/g) || [];

    // Rough check for balanced tags (not perfect but good enough for basic validation)
    const expectedCloseTags = openTags.length - selfClosingTags.length;
    if (closeTags.length !== expectedCloseTags) {
      warnings.push('Possible unbalanced XML tags detected');
    }
  } catch (error) {
    errors.push(`XML validation failed: ${error}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
