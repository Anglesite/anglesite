/**
 * @file Simple architecture validation tests
 */

import { TEST_CONSTANTS } from './constants/test-constants';

// Mock the global context system to prevent initialization errors during tests
jest.mock('../src/main/core/service-registry', () => {
  const originalModule = jest.requireActual('../src/main/core/service-registry');

  // Create a mock store service
  const mockStore = {
    get: jest.fn().mockReturnValue('system'), // Default theme preference
    set: jest.fn(),
    getAll: jest.fn().mockReturnValue({}),
    delete: jest.fn(),
    clear: jest.fn(),
    has: jest.fn().mockReturnValue(false),
  };

  // Create a mock global context
  const mockGlobalContext = {
    getService: jest.fn((serviceName) => {
      if (serviceName === 'store') {
        return mockStore;
      }
      return {};
    }),
    isInitialized: true,
  };

  return {
    ...originalModule,
    getGlobalContext: jest.fn().mockReturnValue(mockGlobalContext),
    globalAppContext: mockGlobalContext,
  };
});

// Mock Electron modules before any imports
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => TEST_CONSTANTS.PATHS.MOCK_PATH),
  },
  nativeTheme: {
    shouldUseDarkColors: false,
    themeSource: 'system',
    on: jest.fn(),
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => []),
  },
}));

// Mock console.warn to suppress deprecated function warnings during tests
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = jest.fn();
});

afterAll(() => {
  console.warn = originalWarn;
});

describe('Modular Architecture', () => {
  describe('Module Imports', () => {
    it('should import UI modules', () => {
      expect(() => require('../src/main/ui/window-manager')).not.toThrow();
      expect(() => require('../src/main/ui/menu')).not.toThrow();
    });

    it('should import server modules', () => {
      expect(() => require('../src/main/server/eleventy')).not.toThrow();
      expect(() => require('../src/main/server/https-proxy')).not.toThrow();
    });

    it('should import utility modules', () => {
      expect(() => require('../src/main/utils/website-manager')).not.toThrow();
      expect(() => require('../src/main/dns/hosts-manager')).not.toThrow();
      expect(() => require('../src/main/certificates')).not.toThrow();
    });

    it('should import IPC handlers', () => {
      expect(() => require('../src/main/ipc/handlers')).not.toThrow();
    });
  });

  describe('Function Exports', () => {
    it('should export functions from window manager', () => {
      const windowManager = require('../src/main/ui/window-manager');
      expect(typeof windowManager.openWebsiteSelectionWindow).toBe('function');
      expect(typeof windowManager.openSettingsWindow).toBe('function');
      expect(typeof windowManager.getNativeInput).toBe('function');
    });

    it('should export functions from menu module', () => {
      const menu = require('../src/main/ui/menu');
      expect(typeof menu.createApplicationMenu).toBe('function');
    });

    it('should export functions from eleventy server', () => {
      const eleventy = require('../src/main/server/eleventy');
      expect(typeof eleventy.getHostnameFromTestDomain).toBe('function');
      expect(typeof eleventy.validateWebsiteName).toBe('undefined'); // Not in this module
    });

    it('should export functions from website manager', () => {
      const websiteManager = require('../src/main/utils/website-manager');
      expect(typeof websiteManager.validateWebsiteName).toBe('function');
    });

    it('should export functions from hosts manager', () => {
      const hostsManager = require('../src/main/dns/hosts-manager');
      expect(typeof hostsManager.addLocalDnsResolution).toBe('function');
      expect(typeof hostsManager.cleanupHostsFile).toBe('function');
      expect(typeof hostsManager.updateHostsFile).toBe('function');
      expect(typeof hostsManager.checkAndSuggestTouchIdSetup).toBe('function');
    });
  });

  describe('Pure Functions', () => {
    it('should extract hostnames from valid URLs', () => {
      const { getHostnameFromTestDomain } = require('../src/main/server/eleventy');

      expect(
        getHostnameFromTestDomain(
          `https://${TEST_CONSTANTS.WEBSITES.MY_SITE}.${TEST_CONSTANTS.DOMAINS.TEST_DOMAIN}:${TEST_CONSTANTS.PORTS.DEFAULT_HTTPS}`
        )
      ).toBe(`${TEST_CONSTANTS.WEBSITES.MY_SITE}.${TEST_CONSTANTS.DOMAINS.TEST_DOMAIN}`);
      expect(
        getHostnameFromTestDomain(
          `https://${TEST_CONSTANTS.WEBSITES.EXAMPLE_SITE}.${TEST_CONSTANTS.DOMAINS.TEST_DOMAIN}:${TEST_CONSTANTS.PORTS.DEFAULT_HTTPS}`
        )
      ).toBe(`${TEST_CONSTANTS.WEBSITES.EXAMPLE_SITE}.${TEST_CONSTANTS.DOMAINS.TEST_DOMAIN}`);
    });

    it('should validate website names', () => {
      const { validateWebsiteName } = require('../src/main/utils/website-manager');

      // Valid names (filesystem-safe characters)
      expect(validateWebsiteName('valid-name').valid).toBe(true);
      expect(validateWebsiteName('site123').valid).toBe(true);
      expect(validateWebsiteName('my_site').valid).toBe(true);
      expect(validateWebsiteName('My Website').valid).toBe(true); // Spaces allowed in middle
      expect(validateWebsiteName('site (v2)').valid).toBe(true); // Parentheses allowed
      expect(validateWebsiteName('site+more').valid).toBe(true); // Plus sign allowed

      // Invalid names
      expect(validateWebsiteName('').valid).toBe(false); // Empty
      expect(validateWebsiteName('  ').valid).toBe(false); // Only spaces
      expect(validateWebsiteName(' leading space').valid).toBe(false); // Leading space
      expect(validateWebsiteName('trailing space ').valid).toBe(false); // Trailing space
      expect(validateWebsiteName('.hidden').valid).toBe(false); // Leading dot
      expect(validateWebsiteName('site.').valid).toBe(false); // Trailing dot
      expect(validateWebsiteName('site/folder').valid).toBe(false); // Forward slash
      expect(validateWebsiteName('site\\folder').valid).toBe(false); // Backslash
      expect(validateWebsiteName('site:port').valid).toBe(false); // Colon
      expect(validateWebsiteName('site<tag>').valid).toBe(false); // Angle brackets
      expect(validateWebsiteName('site"quoted"').valid).toBe(false); // Quotes
      expect(validateWebsiteName('site|pipe').valid).toBe(false); // Pipe
      expect(validateWebsiteName('site?query').valid).toBe(false); // Question mark
      expect(validateWebsiteName('site*glob').valid).toBe(false); // Asterisk
      expect(validateWebsiteName('CON').valid).toBe(false); // Reserved Windows name
      expect(validateWebsiteName('prn').valid).toBe(false); // Reserved Windows name (case insensitive)
    });

    it('should prevent path traversal attacks in website names', () => {
      const { validateWebsiteName } = require('../src/main/utils/website-manager');

      // Path traversal attempts using double dots
      expect(validateWebsiteName('..').valid).toBe(false);
      expect(validateWebsiteName('../').valid).toBe(false);
      expect(validateWebsiteName('..\\').valid).toBe(false);
      expect(validateWebsiteName('../etc').valid).toBe(false);
      expect(validateWebsiteName('..\\..\\windows').valid).toBe(false);
      expect(validateWebsiteName('site/../etc').valid).toBe(false);
      expect(validateWebsiteName('site\\..\\windows').valid).toBe(false);
      expect(validateWebsiteName('....//').valid).toBe(false);
      expect(validateWebsiteName('site..parent').valid).toBe(false);
      expect(validateWebsiteName('normal..butbad').valid).toBe(false);

      // Ensure the error message indicates path traversal protection
      const result = validateWebsiteName('..');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('directory traversal');

      // Valid names that contain dots (but not path traversal)
      expect(validateWebsiteName('site.com').valid).toBe(true); // Valid, dot in middle is allowed
      expect(validateWebsiteName('my-site-v2').valid).toBe(true); // Valid, no dots for traversal
    });
  });

  describe('Refactoring Success', () => {
    it('should have moved main.ts from monolith to modular', () => {
      const fs = require('fs');
      const path = require('path');

      const mainPath = path.join(__dirname, '..', 'src', 'main', 'main.ts');
      const mainContent = fs.readFileSync(mainPath, 'utf8');

      // Should be much shorter now (refactored)
      const lineCount = mainContent.split('\n').length;
      expect(lineCount).toBeLessThan(TEST_CONSTANTS.SIZES.MAX_LINES); // Was over ${TEST_CONSTANTS.SIZES.COMPLEXITY_THRESHOLD} lines before

      // Should import from modules
      expect(mainContent).toContain('import { createApplicationMenu');
      expect(mainContent).toContain('import { setupIpcMainListeners');
      // Check that DNS management functions are imported
      // Note: cleanupHostsFile was moved to menu option to avoid permission dialogs
      expect(mainContent).toContain('checkAndSuggestTouchIdSetup');
    });

    it('should have separate module files', () => {
      const fs = require('fs');
      const path = require('path');

      // Check that modular files exist
      const modules = [
        'ui/window-manager.ts',
        'ui/menu.ts',
        'server/eleventy.ts',
        'server/https-proxy.ts',
        'ipc/handlers.ts',
        'utils/website-manager.ts',
        'dns/hosts-manager.ts',
        'certificates.ts',
      ];

      modules.forEach((modulePath) => {
        const fullPath = path.join(__dirname, '..', 'src', 'main', modulePath);
        expect(fs.existsSync(fullPath)).toBe(true);
      });
    });
  });
});
