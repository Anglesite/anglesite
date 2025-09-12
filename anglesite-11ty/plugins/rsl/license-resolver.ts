/**
 * License Resolution Module
 * Handles resolution of license templates and external API integrations
 */

import type { RSLLicenseConfiguration, RSLConfiguration, RSLPermissionSet, RSLPaymentConfiguration } from './types.js';
import { resolveLicenseTemplate } from './rsl-config.js';

/**
 * Creative Commons API response structure
 */
interface CreativeCommonsLicense {
  id: string;
  name: string;
  url: string;
  deed_url: string;
  legal_code_url: string;
  jurisdiction?: string;
  version: string;
  deprecated: boolean;
  permits?: string[];
  requires?: string[];
  prohibits?: string[];
}

/**
 * SPDX License API response structure
 */
interface SPDXLicense {
  licenseId: string;
  name: string;
  reference: string;
  referenceNumber?: string;
  detailsUrl: string;
  referenceUrls?: string[];
  isOsiApproved?: boolean;
  isFsfLibre?: boolean;
  isDeprecatedLicenseId?: boolean;
}

/**
 * License resolution result
 */
export interface LicenseResolutionResult {
  /** Resolved license configuration */
  license: RSLLicenseConfiguration;
  /** Source of the resolution */
  source: 'builtin' | 'api' | 'custom' | 'inline';
  /** Any warnings encountered during resolution */
  warnings: string[];
  /** Whether resolution was successful */
  success: boolean;
}

/**
 * License compatibility check result
 */
export interface LicenseCompatibilityResult {
  /** Whether licenses are compatible */
  compatible: boolean;
  /** Explanation of compatibility or conflicts */
  explanation: string;
  /** Severity of any conflicts */
  severity: 'info' | 'warning' | 'error';
}

/**
 * Maps Creative Commons terms to RSL permission sets
 * @param ccTerms - Creative Commons permission/requirement/prohibition terms
 * @returns RSL permission sets
 */
function mapCreativeCommonsToRSL(ccTerms: string[]): RSLPermissionSet[] {
  const permissions: RSLPermissionSet[] = [];

  // CC terms to RSL mapping
  const termMap: Record<string, { type: RSLPermissionSet['type']; values: string[] }> = {
    // Permissions
    'cc:Reproduction': { type: 'usage', values: ['view', 'download'] },
    'cc:Distribution': { type: 'usage', values: ['distribute'] },
    'cc:DerivativeWorks': { type: 'usage', values: ['modify'] },
    'cc:CommercialUse': { type: 'usage', values: ['commercial'] },

    // Requirements
    'cc:Attribution': { type: 'usage', values: ['attribution'] },
    'cc:ShareAlike': { type: 'usage', values: ['share-alike'] },
    'cc:Notice': { type: 'usage', values: ['notice'] },

    // Prohibitions (mapped as inverse)
    'cc:NoDerivatives': { type: 'usage', values: ['modify'] },
    'cc:NonCommercial': { type: 'usage', values: ['commercial'] },
  };

  for (const term of ccTerms) {
    const mapping = termMap[term];
    if (mapping) {
      permissions.push(mapping);
    }
  }

  return permissions;
}

/**
 * Fetches Creative Commons license information from API
 * @param licenseId - Creative Commons license identifier
 * @returns Promise resolving to license information
 */
async function fetchCreativeCommonsLicense(licenseId: string): Promise<CreativeCommonsLicense | null> {
  try {
    // Normalize license ID for CC API
    const normalizedId = licenseId
      .toLowerCase()
      .replace(/^cc[-\s]*/, '')
      .replace(/[-\s]+/g, '-');

    const response = await fetch(`https://api.creativecommons.org/rest/1.5/license/${normalizedId}`);

    if (!response.ok) {
      console.warn(`Creative Commons API returned ${response.status} for license ${licenseId}`);
      return null;
    }

    const license: CreativeCommonsLicense = await response.json();
    return license;
  } catch (error) {
    console.warn(`Failed to fetch Creative Commons license ${licenseId}:`, error);
    return null;
  }
}

/**
 * Fetches SPDX license information from API
 * @param licenseId - SPDX license identifier
 * @returns Promise resolving to license information
 */
async function fetchSPDXLicense(licenseId: string): Promise<SPDXLicense | null> {
  try {
    const response = await fetch(`https://spdx.org/licenses/${licenseId}.json`);

    if (!response.ok) {
      console.warn(`SPDX API returned ${response.status} for license ${licenseId}`);
      return null;
    }

    const license: SPDXLicense = await response.json();
    return license;
  } catch (error) {
    console.warn(`Failed to fetch SPDX license ${licenseId}:`, error);
    return null;
  }
}

/**
 * Converts Creative Commons license to RSL format
 * @param ccLicense - Creative Commons license data
 * @returns RSL license configuration
 */
function convertCreativeCommonsToRSL(ccLicense: CreativeCommonsLicense): RSLLicenseConfiguration {
  const license: RSLLicenseConfiguration = {
    standard: ccLicense.legal_code_url || ccLicense.url,
    copyright: `Licensed under ${ccLicense.name}`,
  };

  // Map CC permissions to RSL format
  if (ccLicense.permits) {
    license.permits = mapCreativeCommonsToRSL(ccLicense.permits);
  }

  if (ccLicense.prohibits) {
    license.prohibits = mapCreativeCommonsToRSL(ccLicense.prohibits);
  }

  // Determine payment model
  const isNonCommercial = ccLicense.prohibits?.includes('cc:NonCommercial');
  const requiresAttribution = ccLicense.requires?.includes('cc:Attribution');

  license.payment = {
    type: 'free',
    attribution: requiresAttribution || false,
  };

  // Add usage restrictions for non-commercial licenses
  if (isNonCommercial) {
    license.prohibits = license.prohibits || [];
    license.prohibits.push({ type: 'usage', values: ['commercial'] });
  }

  return license;
}

/**
 * Converts SPDX license to RSL format
 * @param spdxLicense - SPDX license data
 * @returns RSL license configuration
 */
function convertSPDXToRSL(spdxLicense: SPDXLicense): RSLLicenseConfiguration {
  const license: RSLLicenseConfiguration = {
    standard: spdxLicense.detailsUrl,
    copyright: `Licensed under ${spdxLicense.name}`,
  };

  // SPDX licenses are generally permissive unless specifically noted
  // This is a simplified mapping - real implementations might need more sophisticated logic
  const isOsiApproved = spdxLicense.isOsiApproved;
  const isFsfLibre = spdxLicense.isFsfLibre;

  if (isOsiApproved || isFsfLibre) {
    license.permits = [
      { type: 'usage', values: ['view', 'download', 'modify', 'distribute'] },
      { type: 'user', values: ['individual', 'commercial'] },
    ];
  } else {
    // Conservative default for unknown SPDX licenses
    license.permits = [
      { type: 'usage', values: ['view'] },
      { type: 'user', values: ['individual'] },
    ];
  }

  license.payment = { type: 'free', attribution: true };

  return license;
}

/**
 * Resolves a license template by ID or URL
 * @param identifier - License identifier (template ID, URL, or inline configuration)
 * @param rslConfig - RSL configuration containing templates
 * @returns Promise resolving to license resolution result
 */
export async function resolveLicense(
  identifier: string | RSLLicenseConfiguration,
  rslConfig: RSLConfiguration
): Promise<LicenseResolutionResult> {
  const warnings: string[] = [];

  // Handle inline license configuration
  if (typeof identifier === 'object') {
    return {
      license: identifier,
      source: 'inline',
      warnings: [],
      success: true,
    };
  }

  // Try built-in templates first
  const builtinTemplate = resolveLicenseTemplate(identifier, rslConfig.templates);
  if (builtinTemplate) {
    return {
      license: builtinTemplate.license,
      source: 'builtin',
      warnings: [],
      success: true,
    };
  }

  // Check if identifier looks like a Creative Commons license
  if (identifier.match(/^cc[-\s]*(by|nc|nd|sa|zero|publicdomain)/i)) {
    try {
      const ccLicense = await fetchCreativeCommonsLicense(identifier);
      if (ccLicense) {
        return {
          license: convertCreativeCommonsToRSL(ccLicense),
          source: 'api',
          warnings,
          success: true,
        };
      } else {
        warnings.push(`Failed to resolve Creative Commons license: ${identifier}`);
      }
    } catch (error) {
      warnings.push(`Error resolving Creative Commons license ${identifier}: ${error}`);
    }
  }

  // Check if identifier looks like an SPDX license
  if (identifier.match(/^[A-Z0-9][A-Z0-9\-+.]*$/)) {
    try {
      const spdxLicense = await fetchSPDXLicense(identifier);
      if (spdxLicense) {
        return {
          license: convertSPDXToRSL(spdxLicense),
          source: 'api',
          warnings,
          success: true,
        };
      } else {
        warnings.push(`Failed to resolve SPDX license: ${identifier}`);
      }
    } catch (error) {
      warnings.push(`Error resolving SPDX license ${identifier}: ${error}`);
    }
  }

  // Try to treat as URL
  if (identifier.startsWith('http')) {
    return {
      license: {
        standard: identifier,
        copyright: 'Licensed under custom terms',
        payment: { type: 'free', attribution: true },
      },
      source: 'custom',
      warnings,
      success: true,
    };
  }

  // Resolution failed
  warnings.push(`Unable to resolve license identifier: ${identifier}`);
  return {
    license: {
      copyright: 'All rights reserved',
      prohibits: [{ type: 'usage', values: ['download', 'modify', 'distribute', 'commercial'] }],
      payment: { type: 'purchase' },
    },
    source: 'builtin',
    warnings,
    success: false,
  };
}

/**
 * Checks compatibility between multiple licenses
 * @param licenses - Array of license configurations to check
 * @returns Compatibility analysis result
 */
export function checkLicenseCompatibility(licenses: RSLLicenseConfiguration[]): LicenseCompatibilityResult {
  if (licenses.length <= 1) {
    return {
      compatible: true,
      explanation: 'Single license or no licenses to compare',
      severity: 'info',
    };
  }

  // Check for conflicting permissions
  const allPermits = licenses.flatMap((l) => l.permits || []);
  const allProhibits = licenses.flatMap((l) => l.prohibits || []);

  // Look for direct conflicts
  for (const permit of allPermits) {
    for (const prohibit of allProhibits) {
      if (permit.type === prohibit.type) {
        const permitValues = permit.values || [];
        const prohibitValues = prohibit.values || [];
        const conflicts = permitValues.filter((pv) => prohibitValues.includes(pv));

        if (conflicts.length > 0) {
          return {
            compatible: false,
            explanation: `Conflicting permissions found: ${conflicts.join(', ')} are both permitted and prohibited`,
            severity: 'error',
          };
        }
      }
    }
  }

  // Check payment model conflicts
  const paymentTypes = licenses.map((l) => l.payment?.type).filter(Boolean) as string[];

  if (paymentTypes.length > 1 && new Set(paymentTypes).size > 1) {
    const hasFree = paymentTypes.includes('free');
    const hasPaid = paymentTypes.some((t) => t !== 'free');

    if (hasFree && hasPaid) {
      return {
        compatible: false,
        explanation: 'Cannot mix free and paid license models',
        severity: 'error',
      };
    }
  }

  // Check attribution requirements
  const attributionRequirements = licenses.map((l) => l.payment?.attribution).filter(Boolean);
  if (attributionRequirements.some(Boolean) && attributionRequirements.some((a) => a === false)) {
    return {
      compatible: true,
      explanation: 'Mixed attribution requirements - attribution will be required for all content',
      severity: 'warning',
    };
  }

  return {
    compatible: true,
    explanation: 'All licenses appear to be compatible',
    severity: 'info',
  };
}

/**
 * Validates that a license configuration is complete and valid
 * @param license - License configuration to validate
 * @returns Array of validation issues
 */
export function validateLicenseConfiguration(
  license: RSLLicenseConfiguration
): Array<{ issue: string; severity: 'error' | 'warning' }> {
  const issues: Array<{ issue: string; severity: 'error' | 'warning' }> = [];

  // Check for basic license information
  if (!license.standard && !license.custom && !license.copyright) {
    issues.push({
      issue: 'License must specify at least one of: standard URL, custom URL, or copyright notice',
      severity: 'error',
    });
  }

  // Validate URLs if provided
  if (license.standard) {
    try {
      new URL(license.standard);
    } catch {
      issues.push({
        issue: 'Standard license URL is not valid',
        severity: 'error',
      });
    }
  }

  if (license.custom) {
    try {
      new URL(license.custom);
    } catch {
      issues.push({
        issue: 'Custom license URL is not valid',
        severity: 'error',
      });
    }
  }

  if (license.terms) {
    try {
      new URL(license.terms);
    } catch {
      issues.push({
        issue: 'Terms URL is not valid',
        severity: 'error',
      });
    }
  }

  // Check payment configuration
  if (license.payment) {
    if (license.payment.type === 'purchase' && !license.payment.amount) {
      issues.push({
        issue: 'Purchase payment type requires an amount',
        severity: 'warning',
      });
    }

    if (license.payment.amount && license.payment.amount < 0) {
      issues.push({
        issue: 'Payment amount cannot be negative',
        severity: 'error',
      });
    }

    if (license.payment.url) {
      try {
        new URL(license.payment.url);
      } catch {
        issues.push({
          issue: 'Payment URL is not valid',
          severity: 'error',
        });
      }
    }
  }

  // Check for empty permission sets
  if (license.permits && license.permits.length === 0) {
    issues.push({
      issue: 'Empty permits array - consider removing or adding permissions',
      severity: 'warning',
    });
  }

  if (license.prohibits && license.prohibits.length === 0) {
    issues.push({
      issue: 'Empty prohibits array - consider removing or adding restrictions',
      severity: 'warning',
    });
  }

  // Warn about overly restrictive licenses
  if (license.prohibits && license.prohibits.length > 0 && (!license.permits || license.permits.length === 0)) {
    issues.push({
      issue: 'License only has prohibitions without explicit permissions - may be overly restrictive',
      severity: 'warning',
    });
  }

  return issues;
}

/**
 * Merges multiple license configurations into a single effective license
 * @param licenses - Array of licenses to merge
 * @returns Merged license configuration
 */
export function mergeLicenseConfigurations(licenses: RSLLicenseConfiguration[]): RSLLicenseConfiguration {
  if (licenses.length === 0) {
    return {};
  }

  if (licenses.length === 1) {
    return licenses[0];
  }

  const merged: RSLLicenseConfiguration = {};

  // Merge permits (union of all permissions)
  const allPermits = licenses.flatMap((l) => l.permits || []);
  if (allPermits.length > 0) {
    merged.permits = allPermits.reduce((acc, permit) => {
      const existing = acc.find((p) => p.type === permit.type);
      if (existing) {
        existing.values = [...new Set([...(existing.values || []), ...(permit.values || [])])];
      } else {
        acc.push({ ...permit });
      }
      return acc;
    }, [] as RSLPermissionSet[]);
  }

  // Merge prohibits (union of all restrictions)
  const allProhibits = licenses.flatMap((l) => l.prohibits || []);
  if (allProhibits.length > 0) {
    merged.prohibits = allProhibits.reduce((acc, prohibit) => {
      const existing = acc.find((p) => p.type === prohibit.type);
      if (existing) {
        existing.values = [...new Set([...(existing.values || []), ...(prohibit.values || [])])];
      } else {
        acc.push({ ...prohibit });
      }
      return acc;
    }, [] as RSLPermissionSet[]);
  }

  // Merge payment (most restrictive wins)
  const paymentConfigs = licenses.map((l) => l.payment).filter(Boolean) as RSLPaymentConfiguration[];
  if (paymentConfigs.length > 0) {
    // Prioritize paid over free, higher amounts over lower
    merged.payment = paymentConfigs.reduce((acc, payment) => {
      if (!acc) return payment;

      if (payment.type !== 'free' && acc.type === 'free') {
        return payment;
      }

      if (payment.amount && acc.amount && payment.amount > acc.amount) {
        return payment;
      }

      if (payment.attribution === true) {
        acc.attribution = true;
      }

      return acc;
    });
  }

  // Use first non-empty values for other fields
  merged.standard = licenses.find((l) => l.standard)?.standard;
  merged.custom = licenses.find((l) => l.custom)?.custom;
  merged.copyright = licenses.find((l) => l.copyright)?.copyright;
  merged.terms = licenses.find((l) => l.terms)?.terms;
  merged.legal = licenses.find((l) => l.legal)?.legal;
  merged.schema = licenses.find((l) => l.schema)?.schema;

  return merged;
}
