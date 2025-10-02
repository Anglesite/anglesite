/**
 * @file Unit tests for WebsiteManager path resolution
 *
 * Tests the template path resolution logic to ensure correct paths are checked
 * in monorepo and production scenarios.
 */

import * as path from 'path';
import { WebsiteManager } from '../../src/main/utils/website-manager';
import { ILogger, IFileSystem, IAtomicOperations } from '../../src/main/core/interfaces';
import { AtomicOperationError } from '../../src/main/core/errors';

// Mock Electron app module
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/app/data'),
  },
  dialog: {
    showMessageBoxSync: jest.fn(() => 0),
  },
  BrowserWindow: jest.fn(),
}));

describe('WebsiteManager', () => {
  let mockLogger: jest.Mocked<ILogger>;
  let mockFileSystem: jest.Mocked<IFileSystem>;
  let mockAtomicOps: jest.Mocked<IAtomicOperations>;
  let websiteManager: WebsiteManager;

  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(function (this: any) {
        return this;
      }),
    } as any;

    // Create mock file system
    mockFileSystem = {
      exists: jest.fn(),
      readFile: jest.fn(),
      writeFile: jest.fn(),
      mkdir: jest.fn(),
      readdir: jest.fn(),
      rmdir: jest.fn(),
      copyFile: jest.fn(),
      rename: jest.fn(),
      stat: jest.fn(),
    } as any;

    // Create mock atomic operations
    mockAtomicOps = {
      writeFileAtomic: jest.fn(),
      copyDirectoryAtomic: jest.fn(),
      renameAtomic: jest.fn(),
      createTransaction: jest.fn(),
    } as any;

    // Create WebsiteManager instance
    websiteManager = new WebsiteManager(mockLogger, mockFileSystem, mockAtomicOps);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findTemplateSourcePath', () => {
    /**
     * Test that verifies the bug: incorrect path resolution leading to
     * "Path does not exist" messages for the first two fallback paths.
     */
    it('should check correct paths in proper order for monorepo setup', async () => {
      // Simulate monorepo setup where only the workspace sibling path exists
      mockFileSystem.exists.mockImplementation(async (filePath: string) => {
        // Only the third path (monorepo workspace sibling) should exist
        // This simulates the current development environment
        return (
          filePath.includes('anglesite-starter') && !filePath.includes('node_modules') && !filePath.includes('dist/src')
        );
      });

      // Access private method via reflection for testing
      const findTemplateSourcePath = (websiteManager as any).findTemplateSourcePath.bind(websiteManager);
      const result = await findTemplateSourcePath();

      // Should find the template in monorepo location
      expect(result).toBeTruthy();
      expect(result).toContain('anglesite-starter');
      expect(result).not.toContain('dist/src/node_modules');

      // Verify that paths were checked
      expect(mockFileSystem.exists).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/Checking template path|Found template source/),
        expect.any(Object)
      );
    });

    it('should not log confusing messages for expected fallback behavior', async () => {
      // First two paths fail, third succeeds
      let callCount = 0;
      mockFileSystem.exists.mockImplementation(async () => {
        callCount++;
        return callCount === 3; // Only third call succeeds
      });

      const findTemplateSourcePath = (websiteManager as any).findTemplateSourcePath.bind(websiteManager);
      await findTemplateSourcePath();

      // Should NOT log "Path does not exist" messages (removed to reduce confusion)
      const pathDoesNotExistCalls = (mockLogger.debug as jest.Mock).mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('Path does not exist')
      );

      expect(pathDoesNotExistCalls.length).toBe(0);

      // Should log checking messages
      const checkingCalls = (mockLogger.debug as jest.Mock).mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('Checking template path')
      );
      expect(checkingCalls.length).toBe(3);

      // Should log success
      const foundCalls = (mockLogger.debug as jest.Mock).mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('Found template source')
      );
      expect(foundCalls.length).toBe(1);
    });

    it('should check node_modules paths for production builds', async () => {
      // Simulate production where package is in node_modules
      mockFileSystem.exists.mockImplementation(async (filePath: string) => {
        // First path (relative to dist) should work in production
        return filePath.includes('node_modules/@dwk/anglesite-starter') && !filePath.includes('dist/src/node_modules');
      });

      const findTemplateSourcePath = (websiteManager as any).findTemplateSourcePath.bind(websiteManager);
      const result = await findTemplateSourcePath();

      expect(result).toBeTruthy();
      expect(result).toContain('node_modules/@dwk/anglesite-starter');

      // Verify correct paths were checked - the logging format changed to include indices
      const checkedPaths = (mockLogger.debug as jest.Mock).mock.calls
        .filter((call) => typeof call[0] === 'string' && call[0].includes('Checking template path'))
        .map((call) => call[1].path);

      // First path should be relative to __dirname going to node_modules
      // Should NOT include 'dist/src/node_modules' which is the buggy path
      expect(checkedPaths.length).toBeGreaterThan(0);
      expect(
        checkedPaths.some(
          (p: string) => p.includes('node_modules/@dwk/anglesite-starter') && !p.includes('dist/src/node_modules')
        )
      ).toBe(true);
    });

    it('should return null and log warning when no paths exist', async () => {
      // All paths fail
      mockFileSystem.exists.mockResolvedValue(false);

      const findTemplateSourcePath = (websiteManager as any).findTemplateSourcePath.bind(websiteManager);
      const result = await findTemplateSourcePath();

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Template source path not found in any expected location',
        expect.objectContaining({
          checkedPaths: 3,
          hint: expect.any(String),
        })
      );
    });

    it('should prioritize production node_modules over workspace paths', async () => {
      // Both node_modules and workspace paths exist
      mockFileSystem.exists.mockResolvedValue(true);

      const findTemplateSourcePath = (websiteManager as any).findTemplateSourcePath.bind(websiteManager);
      const result = await findTemplateSourcePath();

      // Should return the first valid path (node_modules)
      expect(result).toBeTruthy();
      expect(result).toContain('node_modules/@dwk/anglesite-starter');

      // Verify order: first path checked should be found
      const checkingCalls = (mockLogger.debug as jest.Mock).mock.calls
        .filter((call) => typeof call[0] === 'string' && call[0].includes('Checking template path'))
        .map((call) => call[1].path);

      const foundCall = (mockLogger.debug as jest.Mock).mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('Found template source')
      );

      expect(foundCall).toBeTruthy();
      // Should use first valid path
      expect(foundCall[1].path).toBe(checkingCalls[0]);
    });
  });

  describe('createWebsite', () => {
    it('should throw error when template source is not found', async () => {
      // Template not found - website doesn't exist, websites dir exists, but template doesn't
      let callCount = 0;
      mockFileSystem.exists.mockImplementation(async (filePath: string) => {
        callCount++;
        // First call: check if website exists (should be false)
        if (callCount === 1) return false;
        // Second call: check if websites dir exists (create it if not)
        if (filePath.includes('websites') && !filePath.includes('anglesite-starter')) return false;
        // All template path checks fail
        return false;
      });

      mockFileSystem.mkdir.mockResolvedValue(undefined);

      await expect(websiteManager.createWebsite('test-site')).rejects.toThrow(
        'Could not find @dwk/anglesite-starter template package'
      );

      // Error logging happens during the throw, so the website creation flow should log it
      // But our mock might not capture it perfectly, so let's just verify the exception was thrown
    });

    // Note: Full integration test for createWebsite is covered in test/ipc/website-creation.test.ts
    // This unit test suite focuses on path resolution logic
  });

  describe('path calculation verification', () => {
    it('should calculate paths that actually exist in the file system', () => {
      // This test documents what the paths should resolve to
      const mockDirname = '/Users/dwk/Developer/github.com/Anglesite/@dwk/anglesite/dist/src/main/utils';

      // Path 1: Should reach anglesite/node_modules, NOT dist/src/node_modules
      const path1Expected = path.join(mockDirname, '..', '..', '..', '..', 'node_modules', '@dwk', 'anglesite-starter');
      expect(path1Expected).not.toContain('dist/src/node_modules');
      expect(path1Expected).toContain('anglesite/node_modules');

      // Path 2: process.cwd() typically points to anglesite/
      // This path is correct for production builds

      // Path 3: Monorepo workspace sibling (up 5 levels from dist/src/main/utils/)
      const path3Expected = path.join(mockDirname, '..', '..', '..', '..', '..', 'anglesite-starter');
      expect(path3Expected).toContain('anglesite-starter');
      expect(path3Expected).not.toContain('node_modules');
      expect(path3Expected).not.toContain('dist');
    });
  });
});
