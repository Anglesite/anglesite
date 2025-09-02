/**
 * @file Tests for Store Service with DI
 *
 * Tests the refactored StoreService implementation including dependency
 * injection, validation, and lifecycle management.
 */

import { StoreService, createStoreService } from '../../../src/main/core/store-service';
import { Logger, FileSystemService } from '../../../src/main/core/service-registry';
import { ILogger, IFileSystem } from '../../../src/main/core/interfaces';
import { WindowState, AppSettings } from '../../../src/main/core/types';
import * as path from 'path';
import * as os from 'os';

describe('StoreService', () => {
  let logger: ILogger;
  let fileSystem: IFileSystem;
  let testDataPath: string;
  let storeService: StoreService;

  beforeEach(() => {
    logger = new Logger('test-store');
    fileSystem = new FileSystemService();
    testDataPath = path.join(os.tmpdir(), `anglesite-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

    // Create store service with test path
    storeService = createStoreService(logger, fileSystem, undefined, testDataPath) as StoreService;
  });

  afterEach(async () => {
    if (storeService) {
      await storeService.dispose();
    }

    // Clean up test directory
    try {
      const testSettingsFile = path.join(testDataPath, 'settings.json');
      if (await fileSystem.exists(testSettingsFile)) {
        await fileSystem.rmdir(testDataPath, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Service Creation', () => {
    it('should create store service with factory function', () => {
      expect(storeService).toBeDefined();
      expect(typeof storeService.get).toBe('function');
      expect(typeof storeService.set).toBe('function');
      expect(typeof storeService.dispose).toBe('function');
    });

    it('should create store service with default settings', () => {
      const settings = storeService.getAll();
      expect(settings).toEqual({
        autoDnsEnabled: false,
        httpsMode: null,
        firstLaunchCompleted: false,
        theme: 'system',
        openWebsiteWindows: [],
        recentWebsites: [],
      });
    });

    it('should create store with static factory method', () => {
      const store = StoreService.create(logger, fileSystem, undefined, testDataPath);
      expect(store).toBeInstanceOf(StoreService);
      expect(store.get('theme')).toBe('system');
    });
  });

  describe('Settings Management', () => {
    it('should get and set individual settings', () => {
      expect(storeService.get('theme')).toBe('system');

      storeService.set('theme', 'dark');
      expect(storeService.get('theme')).toBe('dark');

      storeService.set('autoDnsEnabled', true);
      expect(storeService.get('autoDnsEnabled')).toBe(true);
    });

    it('should set and get all settings', () => {
      const newSettings: Partial<AppSettings> = {
        theme: 'light',
        autoDnsEnabled: true,
        firstLaunchCompleted: true,
      };

      storeService.setAll(newSettings);

      expect(storeService.get('theme')).toBe('light');
      expect(storeService.get('autoDnsEnabled')).toBe(true);
      expect(storeService.get('firstLaunchCompleted')).toBe(true);
      // Other settings should remain unchanged
      expect(storeService.get('httpsMode')).toBe(null);
    });

    it('should return a copy of all settings to prevent mutations', () => {
      const settings1 = storeService.getAll();
      const settings2 = storeService.getAll();

      settings1.theme = 'light';
      expect(settings2.theme).toBe('system'); // Should not be affected
      expect(storeService.get('theme')).toBe('system'); // Original should not be affected
    });
  });

  describe('Settings Validation', () => {
    it('should validate boolean settings', () => {
      expect(() => storeService.set('autoDnsEnabled', 'invalid' as unknown as boolean)).toThrow(
        "Invalid value for setting 'autoDnsEnabled': autoDnsEnabled must be a boolean"
      );

      expect(() => storeService.set('firstLaunchCompleted', 42 as unknown as boolean)).toThrow(
        "Invalid value for setting 'firstLaunchCompleted': firstLaunchCompleted must be a boolean"
      );
    });

    it('should validate httpsMode setting', () => {
      // Valid values
      storeService.set('httpsMode', 'https');
      expect(storeService.get('httpsMode')).toBe('https');

      storeService.set('httpsMode', 'http');
      expect(storeService.get('httpsMode')).toBe('http');

      storeService.set('httpsMode', null);
      expect(storeService.get('httpsMode')).toBe(null);

      // Invalid value
      expect(() => storeService.set('httpsMode', 'invalid' as unknown as null)).toThrow(
        'Invalid value for setting \'httpsMode\': httpsMode must be null, "https", or "http"'
      );
    });

    it('should validate theme setting', () => {
      // Valid values
      ['system', 'light', 'dark'].forEach((theme) => {
        storeService.set('theme', theme as 'system' | 'light' | 'dark');
        expect(storeService.get('theme')).toBe(theme);
      });

      // Invalid value
      expect(() => storeService.set('theme', 'invalid' as unknown as 'system')).toThrow(
        'Invalid value for setting \'theme\': theme must be "system", "light", or "dark"'
      );
    });

    it('should validate window states array', () => {
      const validWindowState: WindowState = {
        websiteName: 'test-site',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
      };

      storeService.set('openWebsiteWindows', [validWindowState]);
      expect(storeService.get('openWebsiteWindows')).toEqual([validWindowState]);

      // Invalid - not an array
      expect(() => storeService.set('openWebsiteWindows', 'invalid' as unknown as WindowState[])).toThrow(
        "Invalid value for setting 'openWebsiteWindows': openWebsiteWindows must be an array"
      );

      // Invalid - missing websiteName
      expect(() =>
        storeService.set('openWebsiteWindows', [
          { bounds: { x: 0, y: 0, width: 100, height: 100 } },
        ] as unknown as WindowState[])
      ).toThrow("Invalid value for setting 'openWebsiteWindows': Each window state must have a valid websiteName");
    });

    it('should validate recent websites array', () => {
      const validWebsites = ['site1', 'site2', 'site3'];
      storeService.set('recentWebsites', validWebsites);
      expect(storeService.get('recentWebsites')).toEqual(validWebsites);

      // Invalid - not an array
      expect(() => storeService.set('recentWebsites', 'invalid' as unknown as string[])).toThrow(
        "Invalid value for setting 'recentWebsites': recentWebsites must be an array"
      );

      // Invalid - empty string
      expect(() => storeService.set('recentWebsites', ['site1', '', 'site3'])).toThrow(
        "Invalid value for setting 'recentWebsites': All recent websites must be non-empty strings"
      );

      // Invalid - too many entries
      const tooManyWebsites = Array.from({ length: 11 }, (_, i) => `site${i}`);
      expect(() => storeService.set('recentWebsites', tooManyWebsites)).toThrow(
        "Invalid value for setting 'recentWebsites': recentWebsites cannot exceed 10 entries"
      );
    });

    it('should validate multiple settings atomically', () => {
      const invalidSettings = {
        theme: 'invalid' as unknown as 'system',
        autoDnsEnabled: 'not-boolean' as unknown as boolean,
      };

      expect(() => storeService.setAll(invalidSettings)).toThrow(
        'Invalid settings provided: theme must be "system", "light", or "dark", autoDnsEnabled must be a boolean'
      );

      // Original values should be unchanged
      expect(storeService.get('theme')).toBe('system');
      expect(storeService.get('autoDnsEnabled')).toBe(false);
    });
  });

  describe('Window State Management', () => {
    it('should save and get window states', () => {
      const windowStates: WindowState[] = [
        {
          websiteName: 'site1',
          bounds: { x: 100, y: 100, width: 800, height: 600 },
          isMaximized: false,
        },
        {
          websiteName: 'site2',
          bounds: { x: 200, y: 200, width: 1000, height: 800 },
          isMaximized: true,
        },
      ];

      storeService.saveWindowStates(windowStates);
      const retrieved = storeService.getWindowStates();

      expect(retrieved).toEqual(windowStates);
    });

    it('should clear window states', () => {
      const windowStates: WindowState[] = [{ websiteName: 'site1', bounds: { x: 0, y: 0, width: 800, height: 600 } }];

      storeService.saveWindowStates(windowStates);
      expect(storeService.getWindowStates()).toEqual(windowStates);

      storeService.clearWindowStates();
      expect(storeService.getWindowStates()).toEqual([]);
    });
  });

  describe('Recent Websites Management', () => {
    it('should add recent websites', () => {
      storeService.addRecentWebsite('site1');
      storeService.addRecentWebsite('site2');

      expect(storeService.getRecentWebsites()).toEqual(['site2', 'site1']);
    });

    it('should move existing website to top when added again', () => {
      storeService.addRecentWebsite('site1');
      storeService.addRecentWebsite('site2');
      storeService.addRecentWebsite('site3');
      storeService.addRecentWebsite('site1'); // Move to top

      expect(storeService.getRecentWebsites()).toEqual(['site1', 'site3', 'site2']);
    });

    it('should limit recent websites to 10', () => {
      // Add 12 websites
      for (let i = 1; i <= 12; i++) {
        storeService.addRecentWebsite(`site${i}`);
      }

      const recent = storeService.getRecentWebsites();
      expect(recent).toHaveLength(10);
      expect(recent[0]).toBe('site12'); // Most recent
      expect(recent[9]).toBe('site3'); // 10th most recent
    });

    it('should remove specific recent website', () => {
      storeService.addRecentWebsite('site1');
      storeService.addRecentWebsite('site2');
      storeService.addRecentWebsite('site3');

      storeService.removeRecentWebsite('site2');
      expect(storeService.getRecentWebsites()).toEqual(['site3', 'site1']);
    });

    it('should clear all recent websites', () => {
      storeService.addRecentWebsite('site1');
      storeService.addRecentWebsite('site2');

      storeService.clearRecentWebsites();
      expect(storeService.getRecentWebsites()).toEqual([]);
    });

    it('should handle removing non-existent website gracefully', () => {
      storeService.addRecentWebsite('site1');

      // This should not throw or affect existing websites
      storeService.removeRecentWebsite('non-existent');
      expect(storeService.getRecentWebsites()).toEqual(['site1']);
    });
  });

  describe('Persistence and Lifecycle', () => {
    it('should implement IStore interface correctly', () => {
      // Type check - this will fail compilation if interface is not implemented
      const store: import('../../../src/main/core/interfaces').IStore = storeService;
      expect(store).toBeDefined();
    });

    it('should dispose cleanly', async () => {
      storeService.set('theme', 'dark');

      await expect(storeService.dispose()).resolves.toBeUndefined();

      // Should still be able to read values after dispose
      expect(storeService.get('theme')).toBe('dark');
    });

    it('should force save settings', async () => {
      storeService.set('theme', 'light');

      await expect(storeService.forceSave()).resolves.toBeUndefined();
    });

    it('should rollback changes on set error', () => {
      const originalTheme = storeService.get('theme');

      // Mock console methods to avoid spam during testing
      const originalError = console.error;
      console.error = jest.fn();

      try {
        expect(() => storeService.set('theme', 'invalid' as unknown as 'system')).toThrow();
        expect(storeService.get('theme')).toBe(originalTheme); // Should be rolled back
      } finally {
        console.error = originalError;
      }
    });

    it('should rollback changes on setAll error', () => {
      storeService.set('theme', 'dark');
      storeService.set('autoDnsEnabled', true);

      const originalSettings = storeService.getAll();

      // Mock console methods
      const originalError = console.error;
      console.error = jest.fn();

      try {
        expect(() =>
          storeService.setAll({
            theme: 'invalid' as unknown as 'system',
            httpsMode: 'https',
          })
        ).toThrow();

        // All settings should be rolled back to original values
        expect(storeService.getAll()).toEqual(originalSettings);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('Logging Integration', () => {
    it('should log setting changes', () => {
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnThis(),
      } as unknown as ILogger;

      const storeWithMockLogger = createStoreService(mockLogger, fileSystem, undefined, testDataPath) as StoreService;

      storeWithMockLogger.set('theme', 'dark');

      expect(mockLogger.debug).toHaveBeenCalledWith('Setting theme', { newValue: 'dark' });
    });

    it('should log validation errors', () => {
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnThis(),
      } as unknown as ILogger;

      const storeWithMockLogger = createStoreService(mockLogger, fileSystem, undefined, testDataPath) as StoreService;

      try {
        storeWithMockLogger.set('theme', 'invalid' as unknown as 'system');
      } catch {
        // Expected to throw
      }

      expect(mockLogger.error).toHaveBeenCalledWith('Setting validation failed', expect.any(Error), {
        key: 'theme',
        value: 'invalid',
      });
    });
  });
});
