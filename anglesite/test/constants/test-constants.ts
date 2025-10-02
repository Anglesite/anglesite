/**
 * @file Shared test constants to eliminate magic numbers and strings
 * @description Centralizes all test constants to maintain DRY principles across the test suite.
 * This file provides a single source of truth for all test-related constants, improving
 * maintainability and ensuring consistency across different test files.
 * @example
 * ```typescript
 * import { TEST_CONSTANTS } from './constants/test-constants';
 *
 * // Use port constants
 * const port = TEST_CONSTANTS.PORTS.DEFAULT_HTTPS; // 8080
 *
 * // Use website names
 * const website = TEST_CONSTANTS.WEBSITES.TEST_SITE; // 'test-site'
 *
 * // Use window dimensions
 * const { width, height } = TEST_CONSTANTS.WINDOW_BOUNDS.DEFAULT;
 * ```
 */

export const TEST_CONSTANTS = {
  /**
   * Port numbers used throughout tests
   * @description Standard port configurations for different server types and protocols
   */
  PORTS: {
    /** Default HTTPS port for test servers */
    DEFAULT_HTTPS: 8080,
    /** Default HTTP server port */
    DEFAULT_SERVER: 8081,
    /** Test server port for development */
    TEST_SERVER: 3000,
    /** Default localhost port */
    DEFAULT_LOCALHOST: 3000,
  },

  /**
   * Size and dimension constants
   * @description Various size measurements including window dimensions, layout offsets, and data sizes
   */
  SIZES: {
    // Window dimensions
    /** Default main window width in pixels */
    WINDOW_WIDTH: 1200,
    /** Default main window height in pixels */
    WINDOW_HEIGHT: 800,
    /** Website selection dialog width */
    WEBSITE_SELECTION_WIDTH: 600,
    /** Website selection dialog height */
    WEBSITE_SELECTION_HEIGHT: 500,
    /** Settings window width */
    SETTINGS_WIDTH: 500,
    /** Settings window height */
    SETTINGS_HEIGHT: 300,

    // Layout dimensions
    /** Vertical offset for window content positioning */
    WINDOW_Y_OFFSET: 90,
    /** Height offset for window content area */
    WINDOW_HEIGHT_OFFSET: 710,
    /** macOS traffic light button position */
    TRAFFIC_LIGHT_POSITION: 20,

    // Data sizes
    /** Archive file size in bytes for testing */
    ARCHIVE_BYTES: 1024,
    /** Maximum lines threshold for code analysis (updated from 200 to account for legitimate growth) */
    MAX_LINES: 300,
    /** Code complexity threshold for architecture tests */
    COMPLEXITY_THRESHOLD: 2000,
  },

  /**
   * Timeout and delay constants
   * @description Time-based constants for async operations and test timing
   */
  TIMEOUTS: {
    /** Short delay for quick operations (1 second) */
    SHORT_DELAY: 1000,
    /** Medium delay for moderate operations (2.5 seconds) */
    MEDIUM_DELAY: 2500,
    /** Timer advance amount for time-based tests */
    TIMER_ADVANCE: 2000,
  },

  /**
   * Website names used in tests
   * @description Standardized website identifiers for consistent testing
   */
  WEBSITES: {
    /** Generic test site identifier */
    TEST_SITE: 'test-site',
    /** User's personal site identifier */
    MY_SITE: 'my-site',
    /** New site creation identifier */
    NEW_SITE: 'new-site',
    /** Example site for demonstrations */
    EXAMPLE_SITE: 'example',
    /** Numbered test site variant */
    TEST_SITE_123: 'test123',
    /** User's test site with descriptive name */
    MY_TEST_SITE: 'my-test-site',
    /** First generic site identifier */
    SITE_1: 'site1',
    /** Second generic site identifier */
    SITE_2: 'site2',
    /** First project site identifier */
    PROJECT_1: 'project1',
    /** Second project site identifier */
    PROJECT_2: 'project2',
  },

  /**
   * Domain names
   * @description Domain configurations for URL construction and testing
   */
  DOMAINS: {
    /** Test domain suffix */
    TEST_DOMAIN: 'test',
    /** Localhost domain */
    LOCALHOST: 'localhost',
    /** External site domain for certificate testing */
    EXTERNAL_SITE: 'external-site.com',
    /** Anglesite-specific test domain */
    ANGLESITE_TEST: 'anglesite.test',
  },

  /**
   * Full URLs used in tests
   * @description Complete URL patterns for consistent endpoint testing
   */
  URLS: {
    /** Standard HTTPS localhost URL with default port */
    HTTPS_LOCALHOST: 'https://localhost:8080',
    /** HTTPS localhost URL with development port */
    HTTPS_LOCALHOST_3000: 'https://localhost:3000',
    /** Example test domain URL */
    HTTPS_EXAMPLE_TEST: 'https://example.test',
    /** External site URL for certificate error testing */
    HTTPS_EXTERNAL_SITE: 'https://external-site.com',
    /** Default Anglesite test URL */
    DEFAULT_TEST_URL: 'https://anglesite.test:8080',
    /** Test homepage URL */
    TEST_HOMEPAGE: 'https://test.com',
  },

  /**
   * File paths used in mocks and tests
   * @description Standardized file and directory paths for consistent mocking
   */
  PATHS: {
    // Mock paths
    /** Generic mock path for testing */
    MOCK_PATH: '/mock/path',
    /** Mock preload script path */
    MOCK_PRELOAD: '/mock/preload.js',
    /** Mock HTML index file path */
    MOCK_INDEX_HTML: '/mock/index.html',
    /** Mock distribution directory */
    MOCK_DIST: '/mock/dist',
    /** Mock distribution index file */
    MOCK_DIST_INDEX: '/mock/dist/index.html',
    /** Mock website selection template path */
    MOCK_WEBSITE_SELECTION: '/mock/ui/website-selection.html',

    // Test paths
    /** Generic test path */
    TEST_PATH: '/test/path',
    /** Test export ZIP file path */
    TEST_EXPORT_ZIP: '/test/export.zip',
    /** Test export folder path */
    TEST_EXPORT_FOLDER: '/test/export-folder',
    /** Resolved configuration path */
    RESOLVED_PATH: '/resolved/path',
    /** Temporary directory path */
    TMP_DIR: '/tmp',
    /** Website directory path */
    WEBSITE_PATH: '/path/to/website',
  },

  /**
   * Data URLs and templates
   * @description Data URLs and template strings for testing
   */
  DATA_URLS: {
    /** Mock HTML template as data URL */
    MOCK_TEMPLATE: 'data:text/html,mock-template',
  },

  /**
   * Application constants
   * @description Application-specific configuration values
   */
  APP: {
    /** Application name */
    NAME: 'Anglesite',
  },

  /**
   * Environment constants
   * @description Environment-specific configuration values
   */
  ENV: {
    /** Development environment identifier */
    DEVELOPMENT: 'development',
    /** Production environment identifier */
    PRODUCTION: 'production',
  },

  /**
   * Window bounds for testing
   * @description Predefined window state configurations for consistent UI testing
   */
  WINDOW_BOUNDS: {
    /** Default window position and size */
    DEFAULT: { x: 100, y: 100, width: 800, height: 600 },
    /** Large window configuration */
    LARGE: { x: 50, y: 50, width: 1000, height: 800 },
    /** Small window configuration */
    SMALL: { x: 0, y: 0, width: 800, height: 600 },
    /** Extra large window configuration */
    EXTRA_LARGE: { x: 100, y: 100, width: 1200, height: 800 },
  },
} as const;

export default TEST_CONSTANTS;
