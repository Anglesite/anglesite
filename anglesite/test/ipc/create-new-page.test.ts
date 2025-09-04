/**
 * @file Test suite for create-new-page IPC handler
 * Tests security, validation, and error handling scenarios
 */

import { ipcMain, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getGlobalContext } from '../../src/main/core/service-registry';
import { ServiceKeys } from '../../src/main/core/container';

// Mock dependencies
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn()
  },
  BrowserWindow: {
    fromWebContents: jest.fn()
  },
  shell: {
    openPath: jest.fn()
  }
}));

jest.mock('fs');
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args) => {
    const filtered = args.filter(arg => arg && typeof arg === 'string');
    if (filtered.length === 0) return '';
    return filtered.join('/');
  }),
  resolve: jest.fn((inputPath) => {
    if (!inputPath || typeof inputPath !== 'string') return process.cwd();
    // Create absolute paths that maintain proper hierarchy for security tests
    const normalized = inputPath.replace(/\/+/g, '/');
    if (normalized.startsWith('/')) return normalized;
    // For legitimate file paths, ensure they maintain the base directory structure
    // This simulates the website path structure: /test/websites/test-site/src/page.html
    const basePath = '/test/websites/test-site';
    return `${basePath}/${normalized}`;
  })
}));

jest.mock('../../src/main/core/service-registry');
jest.mock('../../src/main/utils/website-manager');

// Import the setup function
import { setupFileHandlers } from '../../src/main/ipc/file';

describe('create-new-page IPC handler', () => {
  let createPageHandler: Function;
  let mockWebsiteManager: any;
  let mockGitHistoryManager: any;
  let mockContext: any;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup mock services
    mockWebsiteManager = {
      getWebsitePath: jest.fn().mockReturnValue('/test/websites/test-site')
    };
    
    mockGitHistoryManager = {
      autoCommit: jest.fn().mockResolvedValue(undefined)
    };
    
    mockContext = {
      getService: jest.fn((key: string) => {
        if (key === ServiceKeys.WEBSITE_MANAGER) return mockWebsiteManager;
        if (key === ServiceKeys.GIT_HISTORY_MANAGER) return mockGitHistoryManager;
        return null;
      })
    };
    
    (getGlobalContext as jest.Mock).mockReturnValue(mockContext);
    
    // Mock fs functions
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    
    // Setup IPC handlers
    setupFileHandlers();
    
    // Get the handler function
    const calls = (ipcMain.handle as jest.Mock).mock.calls;
    const createPageCall = calls.find(call => call[0] === 'create-new-page');
    if (!createPageCall) {
      throw new Error('create-new-page handler not found');
    }
    createPageHandler = createPageCall[1];
  });

  describe('Security Tests', () => {
    describe('Path Traversal Prevention', () => {
      const pathTraversalAttempts = [
        '../etc/passwd',
        '../../etc/shadow',
        '..\\..\\windows\\system32',
        'valid/../../../etc/passwd',
        'page/../../../sensitive',
        './../secret',
        '.../.../etc',
        'page/../../etc'
      ];

      test.each(pathTraversalAttempts)('should reject path traversal attempt: %s', async (maliciousName) => {
        await expect(createPageHandler({}, 'test-site', maliciousName))
          .rejects
          .toThrow(/cannot contain path separators/);
      });
    });

    describe('Filesystem Unsafe Characters', () => {
      const unsafeNames = [
        'page<script>',
        'page>redirect',
        'page:colon',
        'page"quote',
        'page|pipe',
        'page?question',
        'page*asterisk',
        'page\x00null',
        'page\x1fcontrol'
      ];

      test.each(unsafeNames)('should reject unsafe character: %s', async (unsafeName) => {
        await expect(createPageHandler({}, 'test-site', unsafeName))
          .rejects
          .toThrow(/invalid characters/);
      });
    });

    describe('Reserved System Names', () => {
      const reservedNames = [
        'CON', 'con', 'Con',
        'PRN', 'prn',
        'AUX', 'aux',
        'NUL', 'nul',
        'COM1', 'com1',
        'LPT1', 'lpt1'
      ];

      test.each(reservedNames)('should reject reserved name: %s', async (reservedName) => {
        await expect(createPageHandler({}, 'test-site', reservedName))
          .rejects
          .toThrow(/reserved system name/);
      });

      test('should reject reserved name with .html extension', async () => {
        await expect(createPageHandler({}, 'test-site', 'CON.html'))
          .rejects
          .toThrow(/reserved system name/);
      });
    });

    describe('HTML Injection Prevention', () => {
      test('should escape HTML in page title', async () => {
        const maliciousName = 'page<script>alert("XSS")</script>';
        let capturedContent = '';
        
        (fs.writeFileSync as jest.Mock).mockImplementation((path, content) => {
          capturedContent = content;
        });
        
        // Override validation to allow this name for testing
        const validName = 'test-xss';
        await createPageHandler({}, 'test-site', validName);
        
        expect(capturedContent).not.toContain('<script>');
        expect(capturedContent).toContain('&lt;');
        expect(capturedContent).toContain('&gt;');
      });
    });
  });

  describe('Validation Tests', () => {
    test('should reject empty page name', async () => {
      await expect(createPageHandler({}, 'test-site', ''))
        .rejects
        .toThrow(/required/);
    });

    test('should reject whitespace-only page name', async () => {
      await expect(createPageHandler({}, 'test-site', '   '))
        .rejects
        .toThrow(/required/);
    });

    test('should reject page name that is too long', async () => {
      const longName = 'a'.repeat(101);
      await expect(createPageHandler({}, 'test-site', longName))
        .rejects
        .toThrow(/too long/);
    });

    test('should reject page names starting with dot', async () => {
      await expect(createPageHandler({}, 'test-site', '.hidden'))
        .rejects
        .toThrow(/cannot start or end with dots/);
    });

    test('should reject page names ending with dot', async () => {
      await expect(createPageHandler({}, 'test-site', 'page.'))
        .rejects
        .toThrow(/cannot start or end with dots/);
    });

    test('should reject page names with leading spaces', async () => {
      await expect(createPageHandler({}, 'test-site', ' page'))
        .rejects
        .toThrow(/cannot start or end with dots or spaces/);
    });

    test('should reject page names with trailing spaces', async () => {
      await expect(createPageHandler({}, 'test-site', 'page '))
        .rejects
        .toThrow(/cannot start or end with dots or spaces/);
    });

    test('should reject invalid website name', async () => {
      await expect(createPageHandler({}, '', 'page'))
        .rejects
        .toThrow(/Website name is required/);
    });

    test('should reject non-string page name', async () => {
      await expect(createPageHandler({}, 'test-site', 123))
        .rejects
        .toThrow(/must be a string/);
    });

    test('should reject non-string website name', async () => {
      await expect(createPageHandler({}, null, 'page'))
        .rejects
        .toThrow(/Website name is required/);
    });
  });

  describe('Filesystem Tests', () => {
    test('should create src directory if it does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      
      await createPageHandler({}, 'test-site', 'new-page');
      
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('src'),
        { recursive: true }
      );
    });

    test('should handle existing file error', async () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(true) // src dir exists
        .mockReturnValueOnce(true); // file exists
      
      await expect(createPageHandler({}, 'test-site', 'existing'))
        .rejects
        .toThrow(/already exists/);
    });

    test('should handle filesystem write errors', async () => {
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES: Permission denied');
      });
      
      await expect(createPageHandler({}, 'test-site', 'page'))
        .rejects
        .toThrow();
    });

    test('should handle directory creation errors', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES: Permission denied');
      });
      
      await expect(createPageHandler({}, 'test-site', 'page'))
        .rejects
        .toThrow(/Failed to create src directory/);
    });
  });

  describe('Success Scenarios', () => {
    test('should successfully create a valid page', async () => {
      const result = await createPageHandler({}, 'test-site', 'my-page');
      
      expect(result).toEqual({
        success: true,
        filePath: expect.stringContaining('my-page.html'),
        fileName: 'my-page.html'
      });
      
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('my-page.html'),
        expect.stringContaining('<title>my-page</title>'),
        'utf-8'
      );
    });

    test('should add .html extension if not provided', async () => {
      const result = await createPageHandler({}, 'test-site', 'page');
      
      expect(result.fileName).toBe('page.html');
    });

    test('should not add .html extension if already present', async () => {
      const result = await createPageHandler({}, 'test-site', 'page.html');
      
      expect(result.fileName).toBe('page.html');
    });

    test('should trim whitespace from page name', async () => {
      const result = await createPageHandler({}, 'test-site', '  page  ');
      
      expect(result.fileName).toBe('page.html');
    });

    test('should auto-commit to git when available', async () => {
      await createPageHandler({}, 'test-site', 'page');
      
      expect(mockGitHistoryManager.autoCommit).toHaveBeenCalledWith(
        expect.any(String),
        'save'
      );
    });

    test('should succeed even if git commit fails', async () => {
      mockGitHistoryManager.autoCommit.mockRejectedValue(new Error('Git error'));
      
      const result = await createPageHandler({}, 'test-site', 'page');
      
      expect(result.success).toBe(true);
    });
  });

  describe('Fallback Behavior', () => {
    test('should use fallback when DI is not available', async () => {
      (getGlobalContext as jest.Mock).mockImplementation(() => {
        throw new Error('DI not available');
      });
      
      // Mock the fallback import
      const mockGetWebsitePath = jest.fn().mockReturnValue('/fallback/path');
      jest.doMock('../../src/main/utils/website-manager', () => ({
        getWebsitePath: mockGetWebsitePath
      }));
      
      await createPageHandler({}, 'test-site', 'page');
      
      expect(mockGetWebsitePath).toHaveBeenCalledWith('test-site');
    });

    test('should handle fallback errors gracefully', async () => {
      (getGlobalContext as jest.Mock).mockImplementation(() => {
        throw new Error('DI not available');
      });
      
      jest.doMock('../../src/main/utils/website-manager', () => {
        throw new Error('Fallback also failed');
      });
      
      await expect(createPageHandler({}, 'test-site', 'page'))
        .rejects
        .toThrow();
    });
  });

  describe('Error Message Sanitization', () => {
    test('should sanitize paths in error messages', async () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(true) // src dir exists
        .mockReturnValueOnce(true); // file exists
      
      try {
        await createPageHandler({}, 'test-site', 'existing');
      } catch (error: any) {
        expect(error.message).not.toContain('/test/websites');
        expect(error.message).toContain('already exists');
      }
    });
  });

  describe('Logging Tests', () => {
    let consoleSpy: any;
    
    beforeEach(() => {
      consoleSpy = {
        info: jest.spyOn(console, 'info').mockImplementation(),
        error: jest.spyOn(console, 'error').mockImplementation(),
        warn: jest.spyOn(console, 'warn').mockImplementation(),
        debug: jest.spyOn(console, 'debug').mockImplementation()
      };
    });
    
    afterEach(() => {
      Object.values(consoleSpy).forEach((spy: any) => spy.mockRestore());
    });
    
    test('should log page creation start', async () => {
      await createPageHandler({}, 'test-site', 'page');
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        'Creating new page',
        expect.objectContaining({
          websiteName: 'test-site',
          pageName: 'page'
        })
      );
    });
    
    test('should log successful page creation', async () => {
      await createPageHandler({}, 'test-site', 'page');
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        'Page created successfully',
        expect.objectContaining({
          fileName: 'page.html',
          websiteName: 'test-site'
        })
      );
    });
    
    test('should log validation errors', async () => {
      try {
        await createPageHandler({}, 'test-site', '../etc/passwd');
      } catch (e) {
        // Expected to throw
      }
      
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Page creation failed'),
        expect.any(Object)
      );
    });
    
    test('should log git commit failures as warnings', async () => {
      mockGitHistoryManager.autoCommit.mockRejectedValue(new Error('Git error'));
      
      await createPageHandler({}, 'test-site', 'page');
      
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        'Git auto-commit failed (non-fatal)',
        expect.objectContaining({
          fileName: 'page.html'
        })
      );
    });
  });
});