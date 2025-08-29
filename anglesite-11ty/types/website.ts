/**
 * Configuration schema for Anglesite website metadata and settings
 */
export type AnglesiteWebsiteConfiguration = BasicWebsiteInformationSchema &
  SEOAndRobotsConfigurationSchema &
  WebStandardsConfigurationSchema &
  NetworkingAndServerConfigurationSchema &
  AnalyticsConfigurationSchema &
  WellKnownStandardsConfigurationSchema;

export interface BasicWebsiteInformationSchema {
  /**
   * The title of the website
   */
  title: string;
  /**
   * The primary language of the website (ISO 639-1 code)
   */
  language: string;
  /**
   * A brief description of the website
   */
  description?: string;
  /**
   * The base URL of the website
   */
  url?: string;
  author?: Author;
  social?: Social;
  /**
   * Content rating for the website
   */
  rating?: string;
  [k: string]: unknown;
}
/**
 * Information about the website author
 */
export interface Author {
  /**
   * Author's name
   */
  name?: string;
  /**
   * Author's email address
   */
  email?: string;
  /**
   * Author's website or profile URL
   */
  url?: string;
}
/**
 * Social media links
 */
export interface Social {
  /**
   * Twitter handle or URL
   */
  twitter?: string;
  /**
   * A valid URL
   */
  facebook?: string;
  instagram?: string;
  /**
   * A valid URL
   */
  linkedin?: string;
  github?: string;
  /**
   * A valid URL
   */
  youtube?: string;
}
export interface SEOAndRobotsConfigurationSchema {
  /**
   * Robots.txt directives
   */
  robots?: RobotsDirective[];
  sitemap?:
    | boolean
    | {
        /**
         * Enable sitemap generation
         */
        enabled?: boolean;
        changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
        priority?: number;
        /**
         * Maximum URLs per sitemap file (for large sites)
         */
        maxUrlsPerFile?: number;
        /**
         * Split large sitemaps into multiple files
         */
        splitLargeSites?: boolean;
        /**
         * Filename for sitemap index file
         */
        indexFilename?: string;
        /**
         * Pattern for sitemap chunk filenames
         */
        chunkFilenamePattern?: string;
      };
  [k: string]: unknown;
}
/**
 * A single robots.txt directive block
 */
export interface RobotsDirective {
  /**
   * User agent string or '*' for all
   */
  'User-agent'?: string;
  Allow?: string | string[];
  Disallow?: string | string[];
  /**
   * Whether to include sitemap in robots.txt
   */
  Sitemap?: boolean;
  [k: string]: unknown;
}
export interface WebStandardsConfigurationSchema {
  color_scheme?: ColorScheme;
  /**
   * Additional <link> elements for the <head> section
   */
  head_links?: HeadLink[];
  favicon?: Favicon;
  manifest?: Manifest;
  [k: string]: unknown;
}
/**
 * Color scheme preference meta tag
 */
export interface ColorScheme {
  /**
   * Color scheme values
   */
  content?: string;
  /**
   * Media query for the color scheme
   */
  media?: string;
}
/**
 * A <link> element for the <head> section
 */
export interface HeadLink {
  /**
   * Link relationship
   */
  rel: string;
  /**
   * A valid URL
   */
  href?: string;
  /**
   * MIME type
   */
  type?: string;
  /**
   * Icon sizes
   */
  sizes?: string;
  /**
   * Media query
   */
  media?: string;
  crossorigin?: 'anonymous' | 'use-credentials';
  /**
   * Subresource integrity hash
   */
  integrity?: string;
  /**
   * Language of the linked resource
   */
  hreflang?: string;
}
/**
 * Favicon configuration
 */
export interface Favicon {
  /**
   * Path to favicon.ico file
   */
  ico?: string;
  /**
   * Path to SVG favicon
   */
  svg?: string;
  png?: {
    /**
     * Path to PNG favicon of specific size
     */
    [k: string]: string;
  };
  /**
   * Path to Apple touch icon
   */
  appleTouchIcon?: string;
}
/**
 * Web App Manifest configuration
 */
export interface Manifest {
  /**
   * Full name of the web application
   */
  name?: string;
  /**
   * Short name of the web application
   */
  short_name?: string;
  /**
   * Theme color as hex color
   */
  theme_color?: string;
  /**
   * Background color as hex color
   */
  background_color?: string;
  display?: 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';
  orientation?:
    | 'portrait'
    | 'landscape'
    | 'portrait-primary'
    | 'portrait-secondary'
    | 'landscape-primary'
    | 'landscape-secondary';
}
export interface NetworkingAndServerConfigurationSchema {
  /**
   * HTTP headers to set
   */
  headers?: {
    /**
     * Controls whether the page can be displayed in a frame
     */
    'X-Frame-Options'?: 'DENY' | 'SAMEORIGIN';
    /**
     * Prevents MIME type sniffing
     */
    'X-Content-Type-Options'?: 'nosniff';
    /**
     * XSS protection mode
     */
    'X-XSS-Protection'?: string;
    'Referrer-Policy'?:
      | 'no-referrer'
      | 'no-referrer-when-downgrade'
      | 'origin'
      | 'origin-when-cross-origin'
      | 'same-origin'
      | 'strict-origin'
      | 'strict-origin-when-cross-origin'
      | 'unsafe-url';
    /**
     * HSTS header value
     */
    'Strict-Transport-Security'?: string;
    /**
     * CSP header value
     */
    'Content-Security-Policy'?: string;
    /**
     * Permissions policy header
     */
    'Permissions-Policy'?: string;
    'Cross-Origin-Embedder-Policy'?: 'unsafe-none' | 'require-corp' | 'credentialless';
    'Cross-Origin-Opener-Policy'?: 'unsafe-none' | 'same-origin-allow-popups' | 'same-origin';
    'Cross-Origin-Resource-Policy'?: 'same-site' | 'same-origin' | 'cross-origin';
    /**
     * Cache control directives
     */
    'Cache-Control'?: string;
    /**
     * Expiration date/time
     */
    Expires?: string;
    /**
     * Vary header for cache invalidation
     */
    Vary?: string;
    /**
     * Server identification (use with caution)
     */
    Server?: string;
    /**
     * Network Error Logging policy
     */
    NEL?: string;
  };
  /**
   * Redirect rules
   */
  redirects?: RedirectRule[];
  [k: string]: unknown;
}
/**
 * A redirect rule
 */
export interface RedirectRule {
  /**
   * Source path or pattern
   */
  source: string;
  /**
   * Destination path or URL
   */
  destination: string;
  /**
   * HTTP redirect status code
   */
  code?: number;
  /**
   * Force redirect even if file exists
   */
  force?: boolean;
}
export interface AnalyticsConfigurationSchema {
  /**
   * Analytics configuration
   */
  analytics?: {
    /**
     * Google Analytics 4 measurement ID
     */
    google?: string;
    plausible?: PlausibleAnalytics;
    matomo?: MatomoAnalytics;
  };
  [k: string]: unknown;
}
/**
 * Plausible Analytics configuration
 */
export interface PlausibleAnalytics {
  /**
   * Domain for Plausible tracking
   */
  domain?: string;
  /**
   * A valid URL
   */
  src?: string;
}
/**
 * Matomo Analytics configuration
 */
export interface MatomoAnalytics {
  /**
   * Matomo instance URL
   */
  url: string;
  /**
   * Matomo site ID
   */
  siteId: number;
}
export interface WellKnownStandardsConfigurationSchema {
  /**
   * Host metadata configuration for .well-known/host-meta
   */
  host_meta?: {
    /**
     * Enable host-meta generation
     */
    enabled?: boolean;
    /**
     * Output format for host-meta files
     */
    format?: 'xml' | 'json' | 'both';
    /**
     * Link elements for host-meta
     */
    links?: HostMetaLink[];
    /**
     * Property elements for host-meta
     */
    properties?: HostMetaProperty[];
    /**
     * Subject of the host-meta document
     */
    subject?: string;
    /**
     * Alternative identifiers for this host
     */
    aliases?: string[];
  };
  /**
   * WebFinger configuration for .well-known/webfinger (RFC 7033)
   */
  webfinger?: {
    /**
     * Enable WebFinger generation
     */
    enabled?: boolean;
    /**
     * Static WebFinger resources to generate
     */
    resources?: WebFingerResource[];
  };
  security?: SecurityTxt;
  nodeinfo?: NodeInfo;
  openid_configuration?: OpenidConfiguration;
  apple_app_site_association?: AppleAppSiteAssociation;
  assetlinks?: AssetLinks;
  browserconfig?: BrowserConfig;
  [k: string]: unknown;
}
export interface HostMetaLink {
  /**
   * Link relation type
   */
  rel: string;
  /**
   * A valid URL
   */
  href?: string;
  /**
   * MIME type of linked resource
   */
  type?: string;
  /**
   * Whether this is a URI template
   */
  template?: boolean;
}
export interface HostMetaProperty {
  /**
   * Property type URI
   */
  type: string;
  /**
   * Property value
   */
  value: string;
}
export interface WebFingerResource {
  /**
   * The resource identifier (acct:user@domain, https://example.com, etc.)
   */
  subject: string;
  /**
   * Alternative identifiers for this resource
   */
  aliases?: string[];
  /**
   * Properties for this resource
   */
  properties?: {
    [k: string]: string | null;
  };
  /**
   * Links associated with this resource
   */
  links?: {
    /**
     * Link relation type
     */
    rel: string;
    /**
     * A valid URL
     */
    href?: string;
    /**
     * MIME type of the linked resource
     */
    type?: string;
    /**
     * Localized titles for the link
     */
    titles?: {
      [k: string]: string;
    };
    /**
     * Additional properties for the link
     */
    properties?: {
      [k: string]: string | null;
    };
  }[];
}
/**
 * Security.txt configuration for .well-known/security.txt
 */
export interface SecurityTxt {
  contact: string | [string, ...string[]];
  expires?: string | number;
  encryption?: string | [string, ...string[]];
  /**
   * PGP public key block content
   */
  pgp_key?: string;
  /**
   * URL to acknowledgments page
   */
  acknowledgments?: string;
  preferred_languages?: string | [string, ...string[]];
  /**
   * Canonical URL for the security.txt file
   */
  canonical?: string;
  /**
   * URL to security policy page
   */
  policy?: string;
  /**
   * URL to security-related job openings
   */
  hiring?: string;
}
/**
 * NodeInfo configuration for .well-known/nodeinfo
 */
export interface NodeInfo {
  /**
   * Enable NodeInfo generation
   */
  enabled?: boolean;
  /**
   * Software information
   */
  software?: {
    /**
     * Canonical name of the server software (lowercase alphanumeric)
     */
    name: string;
    /**
     * Version of the server software
     */
    version: string;
    /**
     * A valid URL
     */
    repository?: string;
    /**
     * A valid URL
     */
    homepage?: string;
  };
  /**
   * Supported communication protocols
   */
  protocols?: (
    | 'activitypub'
    | 'buddycloud'
    | 'dfrn'
    | 'diaspora'
    | 'libertree'
    | 'ostatus'
    | 'pumpio'
    | 'tent'
    | 'xmpp'
    | 'zot'
  )[];
  /**
   * Third-party services this server connects to
   */
  services?: {
    /**
     * Services this server can import from
     */
    inbound?: ('atom1.0' | 'gnusocial' | 'imap' | 'pnut' | 'pop3' | 'pumpio' | 'rss2.0' | 'twitter')[];
    /**
     * Services this server can export to
     */
    outbound?: (
      | 'atom1.0'
      | 'blogger'
      | 'buddycloud'
      | 'diaspora'
      | 'dreamwidth'
      | 'drupal'
      | 'facebook'
      | 'friendica'
      | 'gnusocial'
      | 'google'
      | 'insanejournal'
      | 'libertree'
      | 'linkedin'
      | 'livejournal'
      | 'mediagoblin'
      | 'myspace'
      | 'pinterest'
      | 'pnut'
      | 'posterous'
      | 'pumpio'
      | 'redmatrix'
      | 'rss2.0'
      | 'smtp'
      | 'tent'
      | 'tumblr'
      | 'twitter'
      | 'wordpress'
      | 'xmpp'
    )[];
  };
  /**
   * Whether this server allows open self-registration of new users
   */
  openRegistrations?: boolean;
  /**
   * Usage statistics for this server
   */
  usage?: {
    /**
     * User statistics
     */
    users?: {
      /**
       * Total number of users on this server
       */
      total?: number;
      /**
       * Number of users active in the last 6 months
       */
      activeHalfyear?: number;
      /**
       * Number of users active in the last month
       */
      activeMonth?: number;
    };
    /**
     * Total number of posts made by local users
     */
    localPosts?: number;
    /**
     * Total number of comments made by local users
     */
    localComments?: number;
  };
  /**
   * Free-form key-value pairs for software-specific metadata
   */
  metadata?: {
    [k: string]: unknown;
  };
}
/**
 * OpenID Connect Discovery Configuration for .well-known/openid_configuration
 */
export interface OpenidConfiguration {
  /**
   * Enable OpenID Connect Discovery Configuration generation
   */
  enabled?: boolean;
  /**
   * The authorization server's issuer identifier URL (required)
   */
  issuer?: string;
  /**
   * URL of the authorization server's authorization endpoint
   */
  authorization_endpoint?: string;
  /**
   * URL of the authorization server's token endpoint
   */
  token_endpoint?: string;
  /**
   * URL of the authorization server's UserInfo endpoint
   */
  userinfo_endpoint?: string;
  /**
   * URL of the authorization server's JWK Set document
   */
  jwks_uri?: string;
  /**
   * URL of the authorization server's Dynamic Client Registration endpoint
   */
  registration_endpoint?: string;
  /**
   * JSON array containing a list of the OAuth 2.0 scope values that this authorization server supports
   */
  scopes_supported?: string[];
  /**
   * JSON array containing a list of the OAuth 2.0 response_type values that this authorization server supports
   */
  response_types_supported?: (
    | 'code'
    | 'id_token'
    | 'token'
    | 'code id_token'
    | 'code token'
    | 'id_token token'
    | 'code id_token token'
  )[];
  /**
   * JSON array containing a list of the OAuth 2.0 response_mode values that this authorization server supports
   */
  response_modes_supported?: ('query' | 'fragment' | 'form_post')[];
  /**
   * JSON array containing a list of the OAuth 2.0 grant type values that this authorization server supports
   */
  grant_types_supported?: ('authorization_code' | 'implicit' | 'refresh_token' | 'client_credentials' | 'password')[];
  /**
   * JSON array containing a list of the Subject Identifier types that this OP supports
   */
  subject_types_supported?: ('public' | 'pairwise')[];
  /**
   * JSON array containing a list of the JWS signing algorithms (alg values) supported by the OP for the ID Token
   */
  id_token_signing_alg_values_supported?: (
    | 'none'
    | 'HS256'
    | 'HS384'
    | 'HS512'
    | 'RS256'
    | 'RS384'
    | 'RS512'
    | 'ES256'
    | 'ES384'
    | 'ES512'
    | 'PS256'
    | 'PS384'
    | 'PS512'
  )[];
  /**
   * JSON array containing a list of client authentication methods supported by this token endpoint
   */
  token_endpoint_auth_methods_supported?: (
    | 'client_secret_basic'
    | 'client_secret_post'
    | 'client_secret_jwt'
    | 'private_key_jwt'
    | 'none'
  )[];
  /**
   * JSON array containing a list of the Claim Names of the Claims that the OpenID Provider MAY be able to supply values for
   */
  claims_supported?: string[];
  /**
   * JSON array containing a list of Proof Key for Code Exchange (PKCE) code challenge methods supported
   */
  code_challenge_methods_supported?: ('plain' | 'S256')[];
  /**
   * URL of the authorization server's OAuth 2.0 revocation endpoint
   */
  revocation_endpoint?: string;
  /**
   * URL of the authorization server's OAuth 2.0 introspection endpoint
   */
  introspection_endpoint?: string;
  /**
   * URL of the authorization server's OAuth 2.0 device authorization endpoint
   */
  device_authorization_endpoint?: string;
  /**
   * URL at the OP to which an RP can perform a redirect to request that the End-User be logged out
   */
  end_session_endpoint?: string;
  /**
   * Boolean value specifying whether the OP supports back-channel logout
   */
  backchannel_logout_supported?: boolean;
  /**
   * Boolean value specifying whether the OP can pass a sid (session ID) Claim in the Logout Token
   */
  backchannel_logout_session_supported?: boolean;
  /**
   * Boolean value specifying whether the OP supports front-channel logout
   */
  frontchannel_logout_supported?: boolean;
  /**
   * Boolean value specifying whether the OP can pass iss (issuer) and sid (session ID) query parameters
   */
  frontchannel_logout_session_supported?: boolean;
  /**
   * JSON array containing a list of the Claim Types that the OpenID Provider supports
   */
  claim_types_supported?: ('normal' | 'aggregated' | 'distributed')[];
  /**
   * Languages and scripts supported for the user interface, represented as a JSON array of BCP47 language tag values
   */
  ui_locales_supported?: string[];
  /**
   * URL of a page containing human-readable information that developers might want or need to know when using the OpenID Provider
   */
  service_documentation?: string;
  /**
   * URL that the OpenID Provider provides to the person registering the Client to read about the OP's requirements on how the Relying Party can use the data provided by the OP
   */
  op_policy_uri?: string;
  /**
   * URL that the OpenID Provider provides to the person registering the Client to read about the OP's terms of service
   */
  op_tos_uri?: string;
}
/**
 * Apple App Site Association configuration for .well-known/apple-app-site-association
 */
export interface AppleAppSiteAssociation {
  /**
   * Enable Apple App Site Association file generation
   */
  enabled?: boolean;
  /**
   * App Links configuration for universal links
   */
  applinks?: {
    /**
     * List of app IDs (typically empty for universal links)
     */
    apps?: string[];
    /**
     * List of app link details
     */
    details?: {
      /**
       * The app ID for this app (team ID + bundle ID)
       */
      appID?: string;
      /**
       * Alternative to appID for multiple app IDs
       */
      appIDs?: string[];
      /**
       * URL paths that should open in the app
       */
      paths: string[];
      /**
       * URL components that should open in the app (alternative to paths)
       */
      components?: Array<{
        /**
         * Path component pattern
         */
        '/'?: string;
        /**
         * Query parameter patterns
         */
        '?'?: {
          [k: string]: string;
        };
        /**
         * Fragment pattern
         */
        '#'?: string;
      }>;
    }[];
  };
  /**
   * Web Credentials configuration for password autofill
   */
  webcredentials?: {
    /**
     * List of app IDs that can access saved passwords
     */
    apps?: string[];
  };
  /**
   * App Clips configuration for App Clip experiences
   */
  appclips?: {
    /**
     * List of App Clip bundle IDs
     */
    apps?: string[];
  };
}
/**
 * Android Asset Links configuration for .well-known/assetlinks.json
 */
export interface AssetLinks {
  /**
   * Enable Android Asset Links file generation
   */
  enabled?: boolean;
  /**
   * List of asset link statements
   */
  statements?: {
    /**
     * List of relation types for this statement
     */
    relation: (
      | 'delegate_permission/common.handle_all_urls'
      | 'delegate_permission/common.get_login_creds'
      | 'delegate_permission/common.share_location'
    )[];
    /**
     * Target app or website for this statement
     */
    target:
      | {
          /**
           * Namespace for Android app targets
           */
          namespace: 'android_app';
          /**
           * Android package name (application ID)
           */
          package_name: string;
          /**
           * SHA256 certificate fingerprints (uppercase, colon-separated)
           */
          sha256_cert_fingerprints: string[];
        }
      | {
          /**
           * Namespace for web targets
           */
          namespace: 'web';
          /**
           * Website URL (must use HTTPS)
           */
          site: string;
        };
  }[];
}

/**
 * Browser configuration for .well-known/browserconfig.xml
 */
export interface BrowserConfig {
  /**
   * Enable browserconfig.xml generation
   */
  enabled?: boolean;
  /**
   * Tile configuration for Windows Start screen
   */
  tile?: {
    /**
     * URL to 70x70 logo
     */
    square70x70logo?: string;
    /**
     * URL to 150x150 logo
     */
    square150x150logo?: string;
    /**
     * URL to 310x150 logo
     */
    wide310x150logo?: string;
    /**
     * URL to 310x310 logo
     */
    square310x310logo?: string;
    /**
     * Hex color for the tile background
     */
    TileColor?: string;
  };
}
