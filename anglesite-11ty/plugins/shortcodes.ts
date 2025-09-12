import { EleventyContext, EleventyConfig } from '../types/index.js';
import { getEffectiveLicenseConfiguration } from './rsl/rsl-config.js';
import type { RSLConfiguration, RSLLicenseConfiguration } from './rsl/types.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Validates if a string is a valid JavaScript identifier
 * @param name - The variable name to validate
 * @returns Whether the name is a valid JS identifier
 */
function isValidJavaScriptIdentifier(name: string): boolean {
  if (!name || typeof name !== 'string') return false;

  // Check if name is a reserved word
  const reservedWords = [
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'let',
    'new',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
  ];

  if (reservedWords.includes(name)) return false;

  // Check if name matches JS identifier pattern
  const identifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  return identifierRegex.test(name);
}

/**
 * Safely serializes license data to JSON, escaping HTML-unsafe characters
 * @param licenseData - The license configuration to serialize
 * @returns HTML-safe JSON string
 */
function serializeLicenseDataSafely(licenseData: RSLLicenseConfiguration): string {
  try {
    const jsonString = JSON.stringify(licenseData, null, 2);

    // Escape HTML-unsafe characters to prevent script tag injection
    return jsonString
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028') // Line separator
      .replace(/\u2029/g, '\\u2029'); // Paragraph separator
  } catch (error) {
    console.warn('Failed to serialize RSL license data:', error);
    return 'null';
  }
}

/**
 * Type guard to check if RSL configuration is enabled
 * @param rsl - The RSL configuration to check
 * @returns Whether RSL is enabled
 */
function isRSLEnabled(rsl: unknown): rsl is RSLConfiguration & { enabled: true } {
  return (
    typeof rsl === 'object' && rsl !== null && 'enabled' in rsl && (rsl as Record<string, unknown>).enabled === true
  );
}

/**
 * Adds shortcodes for Anglesite projects.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addShortcodes(eleventyConfig: EleventyConfig): void {
  eleventyConfig.addShortcode('getPageTitle', function (this: EleventyContext) {
    const pageTitle = this.title;
    const websiteTitle = this.website?.title || 'Website';

    // TODO: Make the website title construction configurable in Anglesite UI
    if (pageTitle && pageTitle !== websiteTitle) {
      return `${pageTitle} | ${websiteTitle}`;
    }
    return websiteTitle;
  });

  eleventyConfig.addShortcode(
    'rslScript',
    function (this: EleventyContext, collectionName?: string, variableName?: string) {
      // Load website data directly from filesystem as fallback
      let websiteData = this.website;

      if (!websiteData) {
        try {
          // Load website.json directly from the data directory
          const websiteJsonPath = path.join(process.cwd(), 'src', '_data', 'website.json');
          const websiteJsonContent = fs.readFileSync(websiteJsonPath, 'utf-8');
          websiteData = JSON.parse(websiteJsonContent);
        } catch (error) {
          console.warn('RSL Script Shortcode: Could not load website data:', error);
          return '';
        }
      }

      // Check if RSL is available and enabled
      const rslConfig = websiteData?.rsl;

      if (!isRSLEnabled(rslConfig)) {
        return '';
      }

      // Validate and set variable name
      const defaultVariableName = 'rsl';
      let finalVariableName = defaultVariableName;

      if (variableName) {
        if (isValidJavaScriptIdentifier(variableName)) {
          finalVariableName = variableName;
        } else {
          console.warn(
            `Invalid JavaScript identifier "${variableName}" for rslScript shortcode. Using default: ${defaultVariableName}`
          );
        }
      }

      // Get effective license configuration
      let effectiveLicense: RSLLicenseConfiguration;

      try {
        effectiveLicense = getEffectiveLicenseConfiguration(
          rslConfig,
          collectionName || undefined,
          undefined // No content-specific license for shortcode context
        );
      } catch (error) {
        console.warn('Failed to get effective RSL license configuration:', error);
        return '';
      }

      // Serialize license data safely
      const serializedLicense = serializeLicenseDataSafely(effectiveLicense);

      // Generate script tag
      return `<script>window.${finalVariableName} = ${serializedLicense};</script>`;
    }
  );
}
