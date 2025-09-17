import { promises as fs, readFileSync } from 'fs';
import * as path from 'path';
import { parse as yamlParse } from 'yaml';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';
import {
  getEffectiveLicenseConfiguration,
  normalizeRSLConfiguration,
  isRSLEnabledForCollection,
} from './rsl/rsl-config.js';
import type { RSLConfiguration, RSLLicenseConfiguration } from './rsl/types.js';

/**
 * Custom error class for headers plugin errors
 * @public
 * @class HeadersPluginError
 * @augments Error
 * @description Specialized error class for headers plugin failures with structured error handling.
 * Provides additional context through error codes and optional cause tracking.
 * @example
 * ```typescript
 * try {
 *   throw new HeadersPluginError(
 *     'Validation failed',
 *     originalError,
 *     HeadersErrorCodes.VALIDATION_FAILED
 *   );
 * } catch (error) {
 *   if (error instanceof HeadersPluginError) {
 *     console.log(`Headers error (${error.code}): ${error.message}`);
 *   }
 * }
 * ```
 */
export class HeadersPluginError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'HeadersPluginError';
  }
}

/**
 * Error codes for different types of headers plugin errors
 * @public
 * @constant HeadersErrorCodes
 * @description Standardized error codes for headers plugin failures to enable consistent error handling.
 * Use these codes to categorize and respond appropriately to different types of failures.
 * @property {string} VALIDATION_FAILED - Header validation failed (security, format, or compliance issues)
 * @property {string} FILE_READ_ERROR - Failed to read source files or configuration
 * @property {string} FILE_WRITE_ERROR - Failed to write generated headers file
 * @property {string} CONFIG_MISSING - Required configuration is missing or invalid
 * @example
 * ```typescript
 * if (error.code === HeadersErrorCodes.VALIDATION_FAILED) {
 *   // Handle validation errors - likely user configuration issue
 *   console.error('Please check your headers configuration');
 * } else if (error.code === HeadersErrorCodes.FILE_WRITE_ERROR) {
 *   // Handle file system errors - likely permissions issue
 *   console.error('Check write permissions for output directory');
 * }
 * ```
 */
export const HeadersErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  CONFIG_MISSING: 'CONFIG_MISSING',
} as const;

interface EleventyPageData {
  website?: AnglesiteWebsiteConfiguration;
  headers?: Record<string, string | undefined>;
  [key: string]: unknown;
}

/**
 * CloudFlare _headers file limits
 */
const CLOUDFLARE_LIMITS = {
  MAX_HEADER_RULES: 100,
  MAX_LINE_LENGTH: 2000,
} as const;

/**
 * Validates header names and values for CloudFlare compliance and security
 * @param name The header name
 * @param value The header value
 * @returns Array of validation errors, empty if valid
 */
function validateHeader(name: string, value: string): string[] {
  const errors: string[] = [];

  // Validate header name is not empty
  if (!name || name.trim() === '') {
    errors.push('Header name cannot be empty');
    return errors;
  }

  // Validate header name according to RFC 7230 (token format)
  // Header names must contain only tchar characters: !#$%&'*+-.0-9A-Z^_`a-z|~
  const validHeaderNamePattern = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/;
  if (!validHeaderNamePattern.test(name)) {
    errors.push(`Invalid header name format (RFC 7230): ${name}. Must contain only valid token characters.`);
  }

  // Check for header name length (reasonable limit)
  if (name.length > 256) {
    errors.push(`Header name too long: ${name.length} characters (max 256)`);
  }

  // Validate header value for security issues

  // Check for CRLF injection (critical security issue)
  if (/[\r\n]/.test(value)) {
    errors.push(`Header value contains line breaks (potential injection): ${name}`);
  }

  // Check for null bytes (another injection vector)
  if (/\0/.test(value)) {
    errors.push(`Header value contains null bytes (potential injection): ${name}`);
  }

  // Validate header value contains only printable characters and safe Unicode
  // Allow printable ASCII (0x20-0x7E) and extended Unicode (0x00A0-0xFFFF)
  // Exclude control characters except tab (0x09) and space (0x20)
  // eslint-disable-next-line no-control-regex
  const validValuePattern = /^[\x09\x20-\x7E\u00A0-\uFFFF]*$/;
  if (!validValuePattern.test(value)) {
    errors.push(`Header value contains invalid control characters: ${name}`);
  }

  // Check header value length
  if (value.length > 8192) {
    errors.push(`Header value too long: ${value.length} characters (max 8192)`);
  }

  // Additional validation for specific security headers
  validateSecurityHeaderValue(name, value, errors);

  return errors;
}

/**
 * Validates specific security header values for common misconfigurations
 * @param name The header name
 * @param value The header value
 * @param errors The errors array to append to
 */
function validateSecurityHeaderValue(name: string, value: string, errors: string[]): void {
  switch (name.toLowerCase()) {
    case 'strict-transport-security': {
      // Validate HSTS syntax: max-age=<seconds>; includeSubDomains; preload
      const hstsValue = value.trim();

      // Must start with max-age=number
      if (!/^max-age=\d+/i.test(hstsValue)) {
        errors.push(`Invalid Strict-Transport-Security format: ${value}. Must start with max-age=<seconds>`);
        break;
      }

      // Check for trailing semicolon (invalid)
      if (hstsValue.endsWith(';') || hstsValue.includes(';;')) {
        errors.push(`Invalid Strict-Transport-Security format: ${value}. Contains invalid semicolon usage`);
        break;
      }

      // Split into directives and validate each one
      const directives = hstsValue.split(';').map((d) => d.trim().toLowerCase());
      const maxAgeDirective = directives[0];
      const otherDirectives = directives.slice(1).filter((d) => d !== '');

      // Validate max-age value
      const maxAgeMatch = maxAgeDirective.match(/^max-age=(\d+)$/);
      if (!maxAgeMatch) {
        errors.push(`Invalid Strict-Transport-Security format: ${value}. max-age must be a number`);
        break;
      }

      // Check for valid directives only
      const validDirectives = ['includesubdomains', 'preload'];
      const invalidDirectives = otherDirectives.filter((d) => !validDirectives.includes(d));
      if (invalidDirectives.length > 0) {
        errors.push(`Invalid Strict-Transport-Security directive(s): ${invalidDirectives.join(', ')}`);
      }

      // Check for duplicate directives
      const uniqueDirectives = new Set(otherDirectives);
      if (uniqueDirectives.size !== otherDirectives.length) {
        errors.push(`Duplicate Strict-Transport-Security directives found: ${value}`);
      }

      break;
    }

    case 'x-frame-options':
      if (!['DENY', 'SAMEORIGIN'].includes(value.toUpperCase())) {
        errors.push(`Invalid X-Frame-Options value: ${value}. Must be DENY or SAMEORIGIN`);
      }
      break;

    case 'x-content-type-options':
      if (value.toLowerCase() !== 'nosniff') {
        errors.push(`Invalid X-Content-Type-Options value: ${value}. Must be 'nosniff'`);
      }
      break;

    case 'referrer-policy': {
      const validReferrerPolicies = [
        'no-referrer',
        'no-referrer-when-downgrade',
        'origin',
        'origin-when-cross-origin',
        'same-origin',
        'strict-origin',
        'strict-origin-when-cross-origin',
        'unsafe-url',
      ];
      if (!validReferrerPolicies.includes(value.toLowerCase())) {
        errors.push(`Invalid Referrer-Policy value: ${value}`);
      }
      break;
    }

    case 'access-control-allow-credentials':
      if (!['true', 'false'].includes(value.toLowerCase())) {
        errors.push(`Invalid Access-Control-Allow-Credentials value: ${value}. Must be 'true' or 'false'`);
      }
      break;

    case 'cross-origin-embedder-policy':
      if (!['unsafe-none', 'require-corp', 'credentialless'].includes(value.toLowerCase())) {
        errors.push(`Invalid Cross-Origin-Embedder-Policy value: ${value}`);
      }
      break;

    case 'cross-origin-opener-policy':
      if (!['unsafe-none', 'same-origin-allow-popups', 'same-origin'].includes(value.toLowerCase())) {
        errors.push(`Invalid Cross-Origin-Opener-Policy value: ${value}`);
      }
      break;

    case 'cross-origin-resource-policy':
      if (!['same-site', 'same-origin', 'cross-origin'].includes(value.toLowerCase())) {
        errors.push(`Invalid Cross-Origin-Resource-Policy value: ${value}`);
      }
      break;

    case 'x-permitted-cross-domain-policies':
      if (!['none', 'master-only', 'by-content-type', 'by-ftp-filename', 'all'].includes(value.toLowerCase())) {
        errors.push(`Invalid X-Permitted-Cross-Domain-Policies value: ${value}`);
      }
      break;

    case 'clear-site-data': {
      // Validate Clear-Site-Data directives (must be quoted strings)
      const validDirectives = ['"cache"', '"cookies"', '"storage"', '"executionContexts"', '"*"'];
      const directives = value.split(',').map((d) => d.trim());
      const invalidDirectives = directives.filter((d) => !validDirectives.includes(d));
      if (invalidDirectives.length > 0) {
        errors.push(
          `Invalid Clear-Site-Data directive(s): ${invalidDirectives.join(', ')}. Directives must be quoted.`
        );
      }
      break;
    }

    case 'x-download-options':
      if (value.toLowerCase() !== 'noopen') {
        errors.push(`Invalid X-Download-Options value: ${value}. Must be 'noopen'`);
      }
      break;

    case 'origin-agent-cluster':
      if (!['?1', '?0'].includes(value)) {
        errors.push(`Invalid Origin-Agent-Cluster value: ${value}. Must be '?1' or '?0'`);
      }
      break;

    case 'expect-ct': {
      // Validate Expect-CT header format
      const expectCtValue = value.trim();
      if (!/^max-age=\d+/.test(expectCtValue)) {
        errors.push(`Invalid Expect-CT format: ${value}. Must start with max-age=<seconds>`);
        break;
      }
      // Check for valid directives
      const parts = expectCtValue.split(',').map((p) => p.trim());
      const otherParts = parts.slice(1);

      for (const part of otherParts) {
        if (part === 'enforce') continue;
        if (part.startsWith('report-uri=')) continue;
        errors.push(`Invalid Expect-CT directive: ${part}`);
      }
      break;
    }

    case 'x-robots-tag': {
      // Validate X-Robots-Tag directives
      const validDirectives = [
        'all',
        'none',
        'noindex',
        'nofollow',
        'noarchive',
        'nosnippet',
        'notranslate',
        'noimageindex',
        'unavailable_after',
      ];
      const directives = value
        .toLowerCase()
        .split(',')
        .map((d) => d.trim());
      for (const directive of directives) {
        // Handle unavailable_after: date format
        if (directive.startsWith('unavailable_after:')) continue;
        if (!validDirectives.includes(directive.split(':')[0])) {
          errors.push(`Invalid X-Robots-Tag directive: ${directive}`);
        }
      }
      break;
    }

    case 'link': {
      // Special validation for Link headers that might contain RSL license references
      // Check if this is an RSL Link header by looking for rel="license"
      if (value.includes('rel="license"')) {
        const rslErrors = validateRSLLinkHeader(value);
        errors.push(...rslErrors);
      }
      // Additional general Link header validation could be added here
      break;
    }
  }
}

/**
 * Path-specific headers configuration
 */
interface PathHeaders {
  path: string;
  headers: Record<string, string | undefined>;
}

/**
 * RSL header generation configuration
 */
interface RSLHeaderContext {
  /** The URL path being processed */
  urlPath: string;
  /** Base URL for the site */
  baseUrl?: string;
  /** Collection name if this content belongs to a collection */
  collectionName?: string;
  /** Content-specific license configuration */
  contentLicense?: RSLLicenseConfiguration;
}

/**
 * Resolves RSL license file URLs for a given content path
 * @param context - The RSL header context with path and collection info
 * @param rslConfig - The RSL configuration
 * @returns Array of RSL URLs that apply to this content
 */
function resolveRSLUrls(context: RSLHeaderContext, rslConfig: RSLConfiguration): string[] {
  if (!rslConfig.enabled) {
    return [];
  }

  const urls: string[] = [];
  const baseUrl = context.baseUrl || '';

  // Determine effective license configuration
  const effectiveLicense = getEffectiveLicenseConfiguration(rslConfig, context.collectionName, context.contentLicense);

  // Skip if no effective license configuration
  if (!effectiveLicense || Object.keys(effectiveLicense).length === 0) {
    return urls;
  }

  // Check if this collection has RSL enabled
  if (context.collectionName && !isRSLEnabledForCollection(rslConfig, context.collectionName)) {
    return urls;
  }

  // 1. Individual content RSL file (if enabled for this collection)
  if (
    context.collectionName &&
    rslConfig.collections?.[context.collectionName]?.outputFormats?.includes('individual')
  ) {
    // Convert /blog/post-name/ to /blog/post-name.rsl.xml
    const individualUrl = context.urlPath.replace(/\/$/, '') + '.rsl.xml';
    urls.push(baseUrl + individualUrl);
  }

  // 2. Collection RSL file (if collection is enabled)
  if (
    context.collectionName &&
    rslConfig.collections?.[context.collectionName]?.enabled !== false &&
    (rslConfig.collections?.[context.collectionName]?.outputFormats?.includes('collection') ||
      rslConfig.defaultOutputFormats?.includes('collection'))
  ) {
    const collectionUrl = `/${context.collectionName}/${context.collectionName}.rsl.xml`;
    urls.push(baseUrl + collectionUrl);
  }

  // 3. Site-wide RSL file (if enabled and mainCollection matches)
  if (
    (rslConfig.defaultOutputFormats?.includes('sitewide') ||
      rslConfig.collections?.[context.collectionName || '']?.outputFormats?.includes('sitewide')) &&
    rslConfig.mainCollection === context.collectionName
  ) {
    urls.push(baseUrl + '/rsl.xml');
  }

  return urls.filter((url) => url.length > 0);
}

/**
 * Generates RSL Link headers for a given context
 * @param context - The RSL header context
 * @param rslConfig - The RSL configuration
 * @returns Record of header names to values for RSL links
 */
function generateRSLHeaders(context: RSLHeaderContext, rslConfig: RSLConfiguration): Record<string, string> {
  const headers: Record<string, string> = {};

  const rslUrls = resolveRSLUrls(context, rslConfig);

  if (rslUrls.length === 0) {
    return headers;
  }

  // Generate Link headers according to RSL HTTP specification
  // Format: Link: <license-URL>; rel="license"; type="application/rsl+xml"
  const linkValues = rslUrls.map((url) => `<${url}>; rel="license"; type="application/rsl+xml"`);

  // If multiple RSL files apply, combine them in a single Link header
  headers['Link'] = linkValues.join(', ');

  return headers;
}

/**
 * Extracts collection name from URL path
 * @param urlPath - The URL path (e.g., '/blog/post-name/')
 * @returns The collection name or undefined
 */
function extractCollectionFromPath(urlPath: string): string | undefined {
  if (!urlPath || urlPath === '/') {
    return undefined;
  }

  // Remove leading/trailing slashes and get first segment
  const segments = urlPath.replace(/^\/|\/$/g, '').split('/');
  return segments.length > 0 ? segments[0] : undefined;
}

/**
 * Validates RSL Link header format
 * @param linkValue - The Link header value to validate
 * @returns Array of validation errors
 */
function validateRSLLinkHeader(linkValue: string): string[] {
  const errors: string[] = [];

  // Split multiple links by comma (outside of angle brackets)
  const links = linkValue.split(/,(?![^<]*>)/);

  for (const link of links) {
    const trimmedLink = link.trim();

    // Validate basic Link header format: <url>; rel="license"; type="application/rsl+xml"
    const linkPattern = /^<([^>]+)>;\s*rel="license";\s*type="application\/rsl\+xml"$/;
    const match = trimmedLink.match(linkPattern);

    if (!match) {
      errors.push(
        `Invalid RSL Link header format: ${trimmedLink}. Must be <url>; rel="license"; type="application/rsl+xml"`
      );
      continue;
    }

    const url = match[1];

    // Validate URL format
    if (!url.startsWith('/') && !url.startsWith('http')) {
      errors.push(`Invalid RSL Link URL: ${url}. Must be absolute path or full URL`);
    }

    // Validate RSL file extension
    if (!url.endsWith('.rsl.xml')) {
      errors.push(`Invalid RSL Link URL: ${url}. Must end with .rsl.xml`);
    }
  }

  return errors;
}

/**
 * Generates CloudFlare _headers file content from website configuration
 * @public
 * @function generateHeaders
 * @description Processes website configuration headers and generates CloudFlare-compatible _headers file content.
 * Performs comprehensive validation including security checks, format compliance, and CloudFlare limits.
 * @param {AnglesiteWebsiteConfiguration} website - The website configuration object containing headers
 * @param {Record<string, string>} website.headers - HTTP headers to include in global configuration
 * @param {string} [website.url] - Base URL for the website (used for validation)
 * @returns {{content: string, errors: string[], warnings: string[]}} Result object containing generated content, errors, and warnings
 * @throws {never} - This function does not throw; all errors are returned in the result object
 * @example
 * ```typescript
 * const websiteConfig = {
 *   headers: {
 *     'X-Frame-Options': 'DENY',
 *     'Content-Security-Policy': "default-src 'self'",
 *     'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
 *   }
 * };
 *
 * const result = generateHeaders(websiteConfig);
 *
 * if (result.errors.length > 0) {
 *   console.error('Header validation failed:', result.errors);
 *   process.exit(1);
 * }
 *
 * if (result.warnings.length > 0) {
 *   console.warn('Header warnings:', result.warnings);
 * }
 *
 * // Write the generated content to _headers file
 * fs.writeFileSync('_site/_headers', result.content);
 * ```
 * @see {@link https://developers.cloudflare.com/pages/platform/headers/} CloudFlare Pages Headers Documentation
 * @see {@link HeadersErrorCodes} For standardized error codes
 * @since 0.3.0
 */
export function generateHeaders(website: AnglesiteWebsiteConfiguration): {
  content: string;
  errors: string[];
  warnings: string[];
} {
  if (!website || !website.headers || Object.keys(website.headers).length === 0) {
    return { content: '', errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];

  // Add global path pattern
  lines.push('/*');

  // Process each header
  for (const [headerName, headerValue] of Object.entries(website.headers)) {
    if (headerValue === undefined || headerValue === null) {
      warnings.push(`Skipping header with undefined/null value: ${headerName}`);
      continue;
    }

    const value = String(headerValue);

    // Validate individual header
    const headerErrors = validateHeader(headerName, value);
    errors.push(...headerErrors);

    // Format header line with indentation
    const headerLine = `  ${headerName}: ${value}`;

    // Check line length limit
    if (headerLine.length > CLOUDFLARE_LIMITS.MAX_LINE_LENGTH) {
      errors.push(
        `Header line exceeds ${CLOUDFLARE_LIMITS.MAX_LINE_LENGTH} character limit: ${headerLine.length} characters`
      );
    }

    lines.push(headerLine);
  }

  // Validate total header count
  const headerCount = lines.length - 1; // Subtract 1 for the path line
  if (headerCount > CLOUDFLARE_LIMITS.MAX_HEADER_RULES) {
    errors.push(
      `Too many headers: ${headerCount}. CloudFlare limit is ${CLOUDFLARE_LIMITS.MAX_HEADER_RULES} headers total`
    );
  }

  // Return results
  const content = lines.length > 1 ? lines.join('\n') + '\n' : '';
  return { content, errors, warnings };
}

/**
 * Generates CloudFlare _headers file content from path-specific header configurations
 * @public
 * @function generateHeadersFromPaths
 * @description Processes path-specific header configurations and generates CloudFlare-compatible _headers file content.
 * Supports multiple path patterns, validation, and automatic RSL Link header integration.
 * @param {PathHeaders[]} pathHeaders - Array of path-specific header configurations
 * @param {string} pathHeaders[].path - URL path pattern (e.g., '/blog/*', '/api/v1/*')
 * @param {Record<string, string | undefined>} pathHeaders[].headers - Headers to apply for this path
 * @param {string} [pathHeaders[].headers._source] - Internal metadata for source file tracking
 * @returns {{content: string, errors: string[], warnings: string[]}} Result object containing generated content, errors, and warnings
 * @throws {never} - This function does not throw; all errors are returned in the result object
 * @example
 * ```typescript
 * const pathHeaders = [
 *   {
 *     path: '/blog/*',
 *     headers: {
 *       'X-Robots-Tag': 'index, follow',
 *       'Link': '<https://example.com/blog/blog.rsl.xml>; rel="license"; type="application/rsl+xml"',
 *       _source: './src/blog/index.md'
 *     }
 *   },
 *   {
 *     path: '/admin/*',
 *     headers: {
 *       'X-Frame-Options': 'DENY',
 *       'X-Robots-Tag': 'noindex, nofollow'
 *     }
 *   }
 * ];
 *
 * const result = generateHeadersFromPaths(pathHeaders);
 * console.log(result.content);
 * // Output:
 * // # Headers from ./src/blog/index.md
 * // /blog/*
 * //   X-Robots-Tag: index, follow
 * //   Link: <https://example.com/blog/blog.rsl.xml>; rel="license"; type="application/rsl+xml"
 * //
 * // /admin/*
 * //   X-Frame-Options: DENY
 * //   X-Robots-Tag: noindex, nofollow
 * ```
 * @see {@link https://developers.cloudflare.com/pages/platform/headers/} CloudFlare Pages Headers Documentation
 * @see {@link collectPathHeaders} For collecting headers from Eleventy build results
 * @since 0.3.0
 */
export function generateHeadersFromPaths(pathHeaders: PathHeaders[]): {
  content: string;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];
  let totalHeaderCount = 0;

  for (const { path, headers } of pathHeaders) {
    if (!headers || Object.keys(headers).length === 0) {
      continue;
    }

    // Add source comment if available
    const source = headers._source;
    if (source) {
      lines.push(`# Headers from ${source}`);
    }

    // Add path pattern
    lines.push(path);
    let pathHeaderCount = 0;

    // Process each header for this path
    for (const [headerName, headerValue] of Object.entries(headers)) {
      // Skip the internal _source metadata
      if (headerName === '_source') {
        continue;
      }

      if (headerValue === undefined || headerValue === null) {
        warnings.push(`Skipping header with undefined/null value: ${headerName} for path ${path}`);
        continue;
      }

      const value = String(headerValue);

      // Validate individual header
      const headerErrors = validateHeader(headerName, value);
      errors.push(...headerErrors);

      // Format header line with indentation
      const headerLine = `  ${headerName}: ${value}`;

      // Check line length limit
      if (headerLine.length > CLOUDFLARE_LIMITS.MAX_LINE_LENGTH) {
        errors.push(
          `Header line exceeds ${CLOUDFLARE_LIMITS.MAX_LINE_LENGTH} character limit: ${headerLine.length} characters (path: ${path})`
        );
      }

      lines.push(headerLine);
      pathHeaderCount++;
    }

    totalHeaderCount += pathHeaderCount;

    // Add spacing between path sections (except for last one)
    if (pathHeaders.indexOf({ path, headers }) < pathHeaders.length - 1 && pathHeaderCount > 0) {
      lines.push('');
    }
  }

  // No content if no headers were processed
  if (lines.length === 0) {
    return { content: '', errors, warnings };
  }

  // Validate total header count (CloudFlare counts individual headers across all paths)
  if (totalHeaderCount > CLOUDFLARE_LIMITS.MAX_HEADER_RULES) {
    errors.push(
      `Too many headers: ${totalHeaderCount}. CloudFlare limit is ${CLOUDFLARE_LIMITS.MAX_HEADER_RULES} headers total`
    );
  }

  const content = lines.join('\n') + '\n';

  return { content, errors, warnings };
}

/**
 * Handles errors consistently with proper logging and error types
 * @param error The error to handle
 * @param context Description of what operation failed
 * @param code Error code for categorization
 * @throws HeadersPluginError
 */
function handlePluginError(error: unknown, context: string, code: string): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const fullMessage = `[Eleventy] Headers plugin: ${context}: ${errorMessage}`;

  console.error(fullMessage);
  throw new HeadersPluginError(context, error instanceof Error ? error : undefined, code);
}

/**
 * Safely writes the headers file with proper error handling
 * @param outputPath Path where to write the _headers file
 * @param content Content to write
 */
async function writeHeadersFile(outputPath: string, content: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content);
    console.log(`[Eleventy] Wrote ${outputPath}`);
  } catch (error) {
    // handlePluginError throws, so we don't need to rethrow
    handlePluginError(error, `Failed to write _headers file to ${outputPath}`, HeadersErrorCodes.FILE_WRITE_ERROR);
  }
}

/**
 * Collects path-specific headers from Eleventy's build results and data cascade
 * @public
 * @function collectPathHeaders
 * @description Processes Eleventy build results to extract headers from front matter and automatically
 * generates RSL Link headers for content with licensing information. Supports YAML front matter,
 * JavaScript/TypeScript templates, and RSL license integration.
 * @param {Array<any> | null} results - Array of Eleventy build results from eleventy.after event
 * @param {string} [results[].url] - The output URL for the content (e.g., '/blog/post-name/')
 * @param {string} [results[].outputPath] - File system path for the generated file
 * @param {string} [results[].inputPath] - Source file path (e.g., './src/blog/post-name.md')
 * @param {EleventyPageData} [results[].data] - Page data from Eleventy's data cascade
 * @returns {Record<string, Record<string, string | undefined>>} Path headers map with headers for each path pattern
 * @throws {never} - This function does not throw; errors are logged and processing continues
 * @example
 * ```typescript
 * // In Eleventy plugin (eleventy.after event)
 * eleventyConfig.on('eleventy.after', async ({ results }) => {
 *   const pathHeaders = collectPathHeaders(results);
 *
 *   // Example result structure:
 *   // {
 *   //   '/blog/welcome-post/*': {
 *   //     _source: './src/blog/welcome-post.md',
 *   //     'X-Robots-Tag': 'index, follow',
 *   //     'Link': '<https://example.com/blog/welcome-post.rsl.xml>; rel="license"; type="application/rsl+xml"'
 *   //   },
 *   //   '/admin/*': {
 *   //     _source: './src/admin/index.md',
 *   //     'X-Frame-Options': 'DENY',
 *   //     'X-Robots-Tag': 'noindex'
 *   //   }
 *   // }
 *
 *   const headerResult = generateHeadersFromPaths(
 *     Object.entries(pathHeaders).map(([path, headers]) => ({ path, headers }))
 *   );
 *
 *   if (headerResult.content) {
 *     fs.writeFileSync('_site/_headers', headerResult.content);
 *   }
 * });
 * ```
 * @example
 * ```yaml
 * # In markdown front matter (./src/blog/my-post.md)
 * ---
 * title: "My Blog Post"
 * headers:
 *   X-Robots-Tag: "index, follow"
 *   Cache-Control: "public, max-age=3600"
 * rsl:
 *   permits:
 *     - type: usage
 *       values: [view, download]
 * ---
 * Content here...
 * ```
 * @see {@link generateHeadersFromPaths} For processing the collected headers
 * @see {@link https://www.11ty.dev/docs/events/#eleventy.after} Eleventy after event documentation
 * @since 0.3.0
 */
export function collectPathHeaders(
  results: Array<{ url?: string; outputPath?: string; inputPath?: string; data?: EleventyPageData }> | null
): Record<string, Record<string, string | undefined>> {
  if (!results || results.length === 0) {
    return {};
  }

  const pathHeadersMap = new Map<string, Record<string, string | undefined>>();

  // First, try to read global headers and RSL config from website.json
  let rslConfig: RSLConfiguration | null = null;
  let baseUrl: string | undefined = undefined;

  try {
    const websiteJsonPath = './src/_data/website.json';
    const websiteContent = readFileSync(websiteJsonPath, 'utf8');
    const websiteConfig = JSON.parse(websiteContent);

    // Extract RSL configuration
    if (websiteConfig?.rsl) {
      rslConfig = normalizeRSLConfiguration(websiteConfig.rsl);
    }

    // Extract base URL for RSL header generation
    baseUrl = websiteConfig?.url;

    if (websiteConfig?.headers && Object.keys(websiteConfig.headers).length > 0) {
      // Add global headers with the wildcard path pattern and source info
      pathHeadersMap.set('/*', {
        _source: websiteJsonPath,
        ...websiteConfig.headers,
      });
    }
  } catch {
    // Website.json not found or no global headers - continue with page-specific headers only
  }

  for (const result of results) {
    if (!result.url || !result.inputPath) {
      continue;
    }

    // Read the front matter from the source file
    try {
      const fileContent = readFileSync(result.inputPath, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let frontMatter: any = null;

      if (result.inputPath.endsWith('.11ty.js') || result.inputPath.endsWith('.11ty.ts')) {
        // For JavaScript/TypeScript template files, try to extract the data function
        // This is a simple regex approach - handles common patterns
        const headersMatch = fileContent.match(/headers:\s*\{([\s\S]*?)\}/);
        if (headersMatch) {
          try {
            const headersString = headersMatch[1];
            const headers: Record<string, string> = {};

            // Match individual header lines with quotes
            const headerLines =
              headersString.match(/'([^']+)':\s*'([^']+)'/g) || headersString.match(/"([^"]+)":\s*"([^"]+)"/g) || [];

            for (const line of headerLines) {
              const match = line.match(/['"]([^'"]+)['"]:\s*['"]([^'"]+)['"]/);
              if (match) {
                const [, key, value] = match;
                headers[key] = value;
              }
            }

            if (Object.keys(headers).length > 0) {
              frontMatter = { headers };
            }
          } catch {
            // Failed to parse JS template, continue with other methods
          }
        }
      } else {
        // For other files, try YAML front matter
        const frontMatterMatch = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);

        if (!frontMatterMatch) {
          continue; // No front matter
        }

        // Parse the front matter YAML
        frontMatter = yamlParse(frontMatterMatch[1]);
      }

      // Use the URL from Eleventy results to determine path pattern
      let pathPattern = result.url;

      // Convert URL to CloudFlare path pattern
      if (pathPattern.endsWith('/')) {
        // Directory -> directory pattern with wildcard
        pathPattern = pathPattern + '*';
      }

      // Handle root case
      if (pathPattern === '/*') {
        pathPattern = '/*';
      }

      // Start with page-specific headers from front matter (if any)
      const combinedHeaders: Record<string, string | undefined> = {
        _source: result.inputPath,
        ...(frontMatter?.headers || {}),
      };

      // Generate and add RSL headers if RSL is enabled
      if (rslConfig && rslConfig.enabled) {
        const collectionName = extractCollectionFromPath(result.url);
        const contentLicense = frontMatter?.rsl || frontMatter?.license;

        const rslContext: RSLHeaderContext = {
          urlPath: result.url,
          baseUrl,
          collectionName,
          contentLicense,
        };

        const rslHeaders = generateRSLHeaders(rslContext, rslConfig);

        // Merge RSL headers with existing headers
        // RSL headers take precedence if there are conflicts
        Object.assign(combinedHeaders, rslHeaders);
      }

      // Only add to map if we have headers to include (excluding just _source)
      const headersWithoutSource = { ...combinedHeaders };
      delete headersWithoutSource._source;

      if (Object.keys(headersWithoutSource).length > 0) {
        pathHeadersMap.set(pathPattern, combinedHeaders);
      }
    } catch (error) {
      console.warn(`[Eleventy] Failed to read front matter from ${result.inputPath}:`, error);
      continue;
    }
  }

  // Convert to plain object for return
  const pathHeaders: Record<string, Record<string, string | undefined>> = {};
  for (const [path, headers] of pathHeadersMap.entries()) {
    pathHeaders[path] = headers;
  }

  return pathHeaders;
}

/**
 * Adds a headers plugin to generate CloudFlare _headers file.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addHeaders(eleventyConfig: EleventyConfig): void {
  eleventyConfig.on('eleventy.after', async ({ dir, results }) => {
    try {
      // Early return for empty results (not an error condition)
      if (!results || results.length === 0) {
        return;
      }

      // Collect path-specific headers from the data cascade
      const pathHeadersObj = collectPathHeaders(results);

      // If no headers found, skip processing
      if (Object.keys(pathHeadersObj).length === 0) {
        return;
      }

      // Convert object format to PathHeaders[] format for generateHeadersFromPaths
      const pathHeaders: PathHeaders[] = [];
      for (const [path, headers] of Object.entries(pathHeadersObj)) {
        pathHeaders.push({ path, headers });
      }

      const result = generateHeadersFromPaths(pathHeaders);

      // Handle validation errors - these should stop the build
      if (result.errors.length > 0) {
        console.error('[Eleventy] Headers validation errors:');
        result.errors.forEach((error) => console.error(`  - ${error}`));

        const validationError = new HeadersPluginError(
          `Headers validation failed with ${result.errors.length} error(s)`,
          undefined,
          HeadersErrorCodes.VALIDATION_FAILED
        );
        // Include the validation errors in the error for better debugging
        validationError.message += `\nValidation errors:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`;
        throw validationError;
      }

      // Handle warnings - these don't stop the build but should be logged
      if (result.warnings.length > 0) {
        console.warn('[Eleventy] Headers warnings:');
        result.warnings.forEach((warning) => console.warn(`  - ${warning}`));
      }

      // Write headers file if we have content
      if (result.content.trim()) {
        const outputPath = path.join(dir.output, '_headers');
        await writeHeadersFile(outputPath, result.content);
      }
    } catch (error) {
      // Re-throw HeadersPluginError as-is (already properly formatted)
      if (error instanceof HeadersPluginError) {
        throw error;
      }

      // Handle any unexpected errors
      handlePluginError(error, 'Unexpected error during headers processing', 'UNEXPECTED_ERROR');
    }
  });
}
