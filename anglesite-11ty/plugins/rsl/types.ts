/**
 * RSL 1.0 Type Definitions for anglesite-11ty
 * Based on the RSL specification at https://rslstandard.org/rsl
 */

export type RSLPermissionType = 'usage' | 'user' | 'geo' | 'ai-training' | 'crawl' | 'inference' | 'search';

export type RSLPaymentType = 'purchase' | 'subscription' | 'training' | 'crawl' | 'inference' | 'free';

export type RSLOutputFormat = 'individual' | 'collection' | 'sitewide';

export interface RSLPermissionSet {
  /** Type of permission being granted or restricted */
  type?: 'usage' | 'user' | 'geo';
  /** Specific permission values */
  values?: string[];
}

export interface RSLPaymentConfiguration {
  /** Type of payment model */
  type: RSLPaymentType;
  /** Payment amount (0 for free) */
  amount?: number;
  /** Currency code (ISO 4217) */
  currency?: string;
  /** Payment URL for transactions */
  url?: string;
  /** Attribution requirements for free usage */
  attribution?: boolean;
}

export interface RSLLegalConfiguration {
  /** Warranty disclaimer */
  warranty?: string;
  /** Liability limitations */
  liability?: string;
  /** Governing law */
  law?: string;
}

export interface RSLSchemaConfiguration {
  /** Schema.org structured data */
  type?: string;
  /** Additional schema properties */
  properties?: Record<string, unknown>;
}

export interface RSLLicenseConfiguration {
  /** Permissions granted */
  permits?: RSLPermissionSet[];
  /** Restrictions imposed */
  prohibits?: RSLPermissionSet[];
  /** Payment/compensation model */
  payment?: RSLPaymentConfiguration;
  /** Reference to standard license (e.g., Creative Commons URL) */
  standard?: string;
  /** Custom license page URL */
  custom?: string;
  /** Copyright notice */
  copyright?: string;
  /** Additional terms URL */
  terms?: string;
  /** Legal disclaimers and warranties */
  legal?: RSLLegalConfiguration;
  /** Schema.org metadata */
  schema?: RSLSchemaConfiguration;
}

export interface RSLContentDiscoveryConfig {
  /** Enable automatic content discovery */
  enabled?: boolean;
  /** Maximum directory depth to scan */
  maxDepth?: number;
  /** File extensions to include */
  includeExtensions?: string[];
  /** File extensions to exclude */
  excludeExtensions?: string[];
  /** Directories to exclude from scanning */
  excludeDirectories?: string[];
  /** Enable checksum generation for integrity */
  generateChecksums?: boolean;
}

export interface RSLCollectionConfig extends RSLLicenseConfiguration {
  /** Enable RSL generation for this collection */
  enabled?: boolean;
  /** Output formats to generate */
  outputFormats?: RSLOutputFormat[];
  /** Custom filename (without extension) */
  filename?: string;
  /** Custom output path relative to collection */
  path?: string;
}

export interface RSLLicenseTemplate {
  /** Template identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** License configuration */
  license: RSLLicenseConfiguration;
  /** API endpoint for dynamic resolution */
  apiUrl?: string;
}

export interface RSLTemplateConfig {
  /** Built-in license templates */
  builtin?: Record<string, RSLLicenseTemplate>;
  /** External template API endpoints */
  apis?: Record<string, string>;
  /** Custom license templates */
  custom?: Record<string, RSLLicenseTemplate>;
}

export interface RSLConfiguration {
  /** Enable RSL generation (default: true) */
  enabled?: boolean;
  /** Output formats to generate by default */
  defaultOutputFormats?: RSLOutputFormat[];
  /** Global copyright notice that can be inherited by all licenses */
  copyright?: string;
  /** Default license configuration */
  defaultLicense?: RSLLicenseConfiguration;
  /** Per-collection configurations */
  collections?: Record<string, RSLCollectionConfig>;
  /** Content discovery settings */
  contentDiscovery?: RSLContentDiscoveryConfig;
  /** License template configuration */
  templates?: RSLTemplateConfig;
  /** Main collection name for site-wide RSL */
  mainCollection?: string;
  /** Enable automatic discovery of all collections (default: false) */
  autoDiscoverCollections?: boolean;
  /** Include patterns for collection discovery (glob-style patterns) */
  includeCollections?: string[];
  /** Exclude patterns for collection discovery (glob-style patterns) */
  excludeCollections?: string[];
}

export interface RSLContentAsset {
  /** Content URL (required) */
  url: string;
  /** Server/host attribution */
  server?: string;
  /** Whether content is encrypted */
  encrypted?: boolean;
  /** Last modified timestamp */
  lastmod?: Date;
  /** File size in bytes */
  size?: number;
  /** MIME type */
  type?: string;
  /** Content checksum for integrity */
  checksum?: string;
  /** Checksum algorithm used */
  checksumAlgorithm?: 'md5' | 'sha1' | 'sha256';
  /** Local file path (for internal use) */
  localPath?: string;
}

export interface RSLValidationError {
  /** Field path where error occurred */
  path: string;
  /** Error message */
  message: string;
  /** Error severity */
  severity: 'error' | 'warning';
}

export interface RSLValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors and warnings */
  errors: RSLValidationError[];
}
