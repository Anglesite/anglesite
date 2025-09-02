import * as fs from 'fs';
import * as path from 'path';
import type { EleventyConfig } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

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

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

interface OpenIDConfiguration {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  subject_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  claims_supported?: string[];
  code_challenge_methods_supported?: string[];
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  device_authorization_endpoint?: string;
  backchannel_logout_supported?: boolean;
  backchannel_logout_session_supported?: boolean;
  frontchannel_logout_supported?: boolean;
  frontchannel_logout_session_supported?: boolean;
  end_session_endpoint?: string;
  claim_types_supported?: string[];
  ui_locales_supported?: string[];
  service_documentation?: string;
  op_policy_uri?: string;
  op_tos_uri?: string;
}

/**
 * Generates OpenID Connect Discovery Configuration.
 * This creates the standard OpenID Configuration document for OAuth2/OIDC discovery.
 * @param website The website configuration object
 * @returns OpenID Configuration object or null if not enabled
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html OpenID Connect Discovery 1.0
 */
export function generateOpenIDConfiguration(website: AnglesiteWebsiteConfiguration): OpenIDConfiguration | null {
  if (!website?.openid_configuration?.enabled) {
    return null;
  }

  const config = website.openid_configuration;

  // Validate required issuer URL
  if (!config.issuer || !validateUrl(config.issuer)) {
    console.warn(`[Eleventy] OpenID Configuration issuer is not a valid URL: ${config.issuer}`);
    return null;
  }

  const openidConfig: OpenIDConfiguration = {
    issuer: config.issuer,
  };

  // Add optional endpoints with validation
  if (config.authorization_endpoint) {
    if (validateUrl(config.authorization_endpoint)) {
      openidConfig.authorization_endpoint = config.authorization_endpoint;
    } else {
      console.warn(
        `[Eleventy] OpenID Configuration authorization_endpoint is not a valid URL: ${config.authorization_endpoint}`
      );
    }
  }

  if (config.token_endpoint) {
    if (validateUrl(config.token_endpoint)) {
      openidConfig.token_endpoint = config.token_endpoint;
    } else {
      console.warn(`[Eleventy] OpenID Configuration token_endpoint is not a valid URL: ${config.token_endpoint}`);
    }
  }

  if (config.userinfo_endpoint) {
    if (validateUrl(config.userinfo_endpoint)) {
      openidConfig.userinfo_endpoint = config.userinfo_endpoint;
    } else {
      console.warn(`[Eleventy] OpenID Configuration userinfo_endpoint is not a valid URL: ${config.userinfo_endpoint}`);
    }
  }

  if (config.jwks_uri) {
    if (validateUrl(config.jwks_uri)) {
      openidConfig.jwks_uri = config.jwks_uri;
    } else {
      console.warn(`[Eleventy] OpenID Configuration jwks_uri is not a valid URL: ${config.jwks_uri}`);
    }
  }

  if (config.registration_endpoint) {
    if (validateUrl(config.registration_endpoint)) {
      openidConfig.registration_endpoint = config.registration_endpoint;
    } else {
      console.warn(
        `[Eleventy] OpenID Configuration registration_endpoint is not a valid URL: ${config.registration_endpoint}`
      );
    }
  }

  // Add arrays with defaults
  openidConfig.scopes_supported = config.scopes_supported || ['openid', 'profile', 'email'];
  openidConfig.response_types_supported = config.response_types_supported || ['code', 'id_token', 'code id_token'];
  openidConfig.response_modes_supported = config.response_modes_supported || ['query', 'fragment'];
  openidConfig.grant_types_supported = config.grant_types_supported || ['authorization_code', 'implicit'];
  openidConfig.subject_types_supported = config.subject_types_supported || ['public'];
  openidConfig.id_token_signing_alg_values_supported = config.id_token_signing_alg_values_supported || ['RS256'];
  openidConfig.token_endpoint_auth_methods_supported = config.token_endpoint_auth_methods_supported || [
    'client_secret_basic',
  ];
  openidConfig.claims_supported = config.claims_supported || ['sub', 'iss', 'auth_time', 'name', 'email'];

  // Add optional features
  if (config.code_challenge_methods_supported) {
    openidConfig.code_challenge_methods_supported = config.code_challenge_methods_supported;
  }

  if (config.revocation_endpoint && validateUrl(config.revocation_endpoint)) {
    openidConfig.revocation_endpoint = config.revocation_endpoint;
  }

  if (config.introspection_endpoint && validateUrl(config.introspection_endpoint)) {
    openidConfig.introspection_endpoint = config.introspection_endpoint;
  }

  if (config.device_authorization_endpoint && validateUrl(config.device_authorization_endpoint)) {
    openidConfig.device_authorization_endpoint = config.device_authorization_endpoint;
  }

  if (config.end_session_endpoint && validateUrl(config.end_session_endpoint)) {
    openidConfig.end_session_endpoint = config.end_session_endpoint;
  }

  // Boolean flags
  if (typeof config.backchannel_logout_supported === 'boolean') {
    openidConfig.backchannel_logout_supported = config.backchannel_logout_supported;
  }

  if (typeof config.backchannel_logout_session_supported === 'boolean') {
    openidConfig.backchannel_logout_session_supported = config.backchannel_logout_session_supported;
  }

  if (typeof config.frontchannel_logout_supported === 'boolean') {
    openidConfig.frontchannel_logout_supported = config.frontchannel_logout_supported;
  }

  if (typeof config.frontchannel_logout_session_supported === 'boolean') {
    openidConfig.frontchannel_logout_session_supported = config.frontchannel_logout_session_supported;
  }

  // Optional arrays
  if (config.claim_types_supported) {
    openidConfig.claim_types_supported = config.claim_types_supported;
  }

  if (config.ui_locales_supported) {
    openidConfig.ui_locales_supported = config.ui_locales_supported;
  }

  // Documentation URLs
  if (config.service_documentation && validateUrl(config.service_documentation)) {
    openidConfig.service_documentation = config.service_documentation;
  }

  if (config.op_policy_uri && validateUrl(config.op_policy_uri)) {
    openidConfig.op_policy_uri = config.op_policy_uri;
  }

  if (config.op_tos_uri && validateUrl(config.op_tos_uri)) {
    openidConfig.op_tos_uri = config.op_tos_uri;
  }

  return openidConfig;
}

/**
 * Adds a plugin for generating OpenID Connect Discovery Configuration.
 * This generates a static .well-known/openid_configuration file containing
 * OAuth2/OpenID Connect server metadata for client discovery.
 *
 * The configuration enables OAuth2 and OpenID Connect clients to automatically
 * discover endpoints, supported features, and other metadata about the authorization server.
 *
 * Generated Files:
 * - /.well-known/openid_configuration: Standard OpenID Connect Discovery document
 *
 * This is useful for:
 * - OAuth2 authorization servers
 * - OpenID Connect identity providers
 * - Single Sign-On (SSO) implementations
 * - API authentication systems
 * - Federated identity systems
 * @param eleventyConfig The Eleventy configuration object.
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html OpenID Connect Discovery 1.0
 * @see https://tools.ietf.org/rfc/rfc8414.html RFC 8414 - OAuth 2.0 Authorization Server Metadata
 */
export default function addOpenIDConfiguration(eleventyConfig: EleventyConfig): void {
  // Create OpenID Configuration file during the build process
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
        console.warn('[Eleventy] OpenID Configuration plugin: Could not read website.json from _data directory');
        return;
      }
    }

    if (!websiteConfig) {
      console.warn('[Eleventy] OpenID Configuration plugin: No website configuration found');
      return;
    }

    if (!websiteConfig.openid_configuration?.enabled) {
      return;
    }

    const wellKnownDir = path.join(dir.output, '.well-known');

    try {
      // Ensure .well-known directory exists
      fs.mkdirSync(wellKnownDir, { recursive: true });

      // Generate OpenID Configuration
      const openidConfig = generateOpenIDConfiguration(websiteConfig);
      if (openidConfig) {
        const configPath = path.join(wellKnownDir, 'openid_configuration');
        const configContent = JSON.stringify(openidConfig, null, 2);
        fs.writeFileSync(configPath, configContent);
        console.log(`[Eleventy] Wrote ${configPath}`);
      }
    } catch (error) {
      console.error(
        `[Eleventy] Failed to write OpenID Configuration file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
