/**
 * @file Tests for Eleventy URL resolver functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import * as chokidar from 'chokidar';
import { EleventyUrlResolver } from '../../src/main/server/eleventy-url-resolver';

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('glob');
jest.mock('chokidar');

// Create typed mocks
const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;
const mockGlob = glob as jest.MockedFunction<typeof glob>;
const mockChokidar = chokidar as jest.Mocked<typeof chokidar>;

describe('EleventyUrlResolver', () => {
  let resolver: EleventyUrlResolver;
  let mockWatcher: jest.Mocked<chokidar.FSWatcher>;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup console spies
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Setup path mocks
    mockPath.resolve.mockImplementation((p) => `/resolved/${p}`);
    mockPath.relative.mockImplementation((from, to) => {
      // Simple mock implementation for testing
      const fromParts = from.split('/');
      const toParts = to.split('/');
      return toParts.slice(fromParts.length).join('/');
    });
    mockPath.extname.mockImplementation((filePath) => {
      const parts = filePath.split('.');
      return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
    });
    mockPath.join.mockImplementation((...parts) => parts.join('/'));

    // Setup fs mocks
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([]);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);

    // Setup chokidar mock
    mockWatcher = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn(),
      add: jest.fn(),
      unwatch: jest.fn(),
      getWatched: jest.fn(),
      ref: jest.fn(),
      unref: jest.fn(),
      options: {},
      eventNames: jest.fn(),
      listenerCount: jest.fn(),
      listeners: jest.fn(),
      off: jest.fn(),
      prependListener: jest.fn(),
      prependOnceListener: jest.fn(),
      rawListeners: jest.fn(),
      removeAllListeners: jest.fn(),
      removeListener: jest.fn(),
      setMaxListeners: jest.fn(),
      getMaxListeners: jest.fn(),
      emit: jest.fn(),
      once: jest.fn(),
      addListener: jest.fn(),
    } as unknown as jest.Mocked<chokidar.FSWatcher>;
    mockChokidar.watch.mockReturnValue(mockWatcher);

    // Setup glob mock
    mockGlob.mockResolvedValue([]);

    resolver = new EleventyUrlResolver('/test/input');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    resolver.destroy();
  });

  describe('constructor', () => {
    it('should resolve and store input directory', () => {
      expect(mockPath.resolve).toHaveBeenCalledWith('/test/input');
    });
  });

  describe('initialize', () => {
    it('should initialize URL resolver successfully', async () => {
      mockGlob.mockResolvedValue(['/test/input/page1.md', '/test/input/page2.html']);

      await resolver.initialize();

      expect(consoleLogSpy).toHaveBeenCalledWith('Initializing URL resolver for directory: /resolved//test/input');
      expect(consoleLogSpy).toHaveBeenCalledWith('URL resolver initialization complete for /resolved//test/input');
      expect(mockGlob).toHaveBeenCalled();
      expect(mockChokidar.watch).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Initialization failed');
      mockGlob.mockRejectedValue(error);

      await resolver.initialize();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error building URL map:', error);
    });
  });

  describe('destroy', () => {
    it('should close watcher if it exists', () => {
      resolver['watcher'] = mockWatcher;

      resolver.destroy();

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(resolver['watcher']).toBeNull();
    });

    it('should handle null watcher gracefully', () => {
      resolver['watcher'] = null;

      expect(() => resolver.destroy()).not.toThrow();
    });
  });

  describe('buildUrlMap', () => {
    it('should build URL map for content files', async () => {
      const testFiles = ['/test/input/index.md', '/test/input/about.html', '/test/input/blog/post1.md'];
      mockGlob.mockResolvedValue(testFiles);

      await resolver['buildUrlMap']();

      expect(mockGlob).toHaveBeenCalledWith(
        expect.arrayContaining([
          '**/*.md',
          '**/*.html',
          '**/*.njk',
          '**/*.liquid',
          '**/*.hbs',
          '**/*.mustache',
          '**/*.ejs',
          '**/*.haml',
          '**/*.pug',
          '**/*.jstl',
        ]),
        {
          cwd: '/resolved//test/input',
          ignore: ['node_modules/**', '_site/**', '.git/**'],
          absolute: true,
        }
      );

      expect(consoleLogSpy).toHaveBeenCalledWith('Built URL map for 3 files in /resolved//test/input');
    });

    it('should handle glob errors', async () => {
      const error = new Error('Glob failed');
      mockGlob.mockRejectedValue(error);

      await resolver['buildUrlMap']();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error building URL map:', error);
    });
  });

  describe('setupWatcher', () => {
    it('should setup file watcher with correct options', () => {
      resolver['setupWatcher']();

      expect(mockChokidar.watch).toHaveBeenCalledWith('/resolved//test/input', {
        ignored: [/node_modules/, /_site/, /\.git/, /\.DS_Store/],
        persistent: true,
        ignoreInitial: true,
      });

      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should handle file additions for content files', () => {
      // Set NODE_ENV to development to enable logging
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      resolver['setupWatcher']();

      // Get the 'add' callback
      const addCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'add')?.[1];
      expect(addCallback).toBeDefined();

      // Mock isContentFile to return true
      jest.spyOn(resolver as unknown as { isContentFile: () => boolean }, 'isContentFile').mockReturnValue(true);
      jest
        .spyOn(resolver as unknown as { calculateEleventyUrl: () => string }, 'calculateEleventyUrl')
        .mockReturnValue('/test-url');

      addCallback?.('/test/file.md');

      expect(consoleLogSpy).toHaveBeenCalledWith('Added URL mapping: /test/file.md → /test-url');

      // Restore original NODE_ENV
      process.env.NODE_ENV = originalEnv;
    });

    it('should ignore non-content files on addition', () => {
      resolver['setupWatcher']();

      const addCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'add')?.[1];
      jest.spyOn(resolver as unknown as { isContentFile: () => boolean }, 'isContentFile').mockReturnValue(false);

      addCallback?.('/test/file.css');

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Added URL mapping'));
    });

    it('should handle file deletions', () => {
      // Set NODE_ENV to development to enable logging
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      resolver['setupWatcher']();

      // Add a file to the URL map first
      resolver['urlMap'].set('/test/file.md', '/test-url');

      const unlinkCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'unlink')?.[1];
      unlinkCallback?.('/test/file.md');

      expect(consoleLogSpy).toHaveBeenCalledWith('Removed URL mapping: /test/file.md');
      expect(resolver['urlMap'].has('/test/file.md')).toBe(false);

      // Restore original NODE_ENV
      process.env.NODE_ENV = originalEnv;
    });

    it('should ignore deletion of unmapped files', () => {
      resolver['setupWatcher']();

      const unlinkCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'unlink')?.[1];
      unlinkCallback?.('/unmapped/file.md');

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Removed URL mapping'));
    });

    it('should handle file changes', () => {
      resolver['setupWatcher']();

      const changeCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'change')?.[1];

      // Should not throw
      expect(() => changeCallback?.('/test/file.md')).not.toThrow();
    });
  });

  describe('isContentFile', () => {
    const testCases = [
      { file: 'test.md', expected: true },
      { file: 'test.html', expected: true },
      { file: 'test.njk', expected: true },
      { file: 'test.liquid', expected: true },
      { file: 'test.hbs', expected: true },
      { file: 'test.mustache', expected: true },
      { file: 'test.ejs', expected: true },
      { file: 'test.haml', expected: true },
      { file: 'test.pug', expected: true },
      { file: 'test.jstl', expected: true },
      { file: 'test.css', expected: false },
      { file: 'test.js', expected: false },
      { file: 'test.txt', expected: false },
      { file: 'test', expected: false },
    ];

    testCases.forEach(({ file, expected }) => {
      it(`should return ${expected} for ${file}`, () => {
        const result = resolver['isContentFile'](file);
        expect(result).toBe(expected);
      });
    });
  });

  describe('calculateEleventyUrl', () => {
    beforeEach(() => {
      // Mock path.relative to return the relative path
      mockPath.relative.mockImplementation((from, to) => {
        if (to === '/resolved//test/input/index.md') return 'index.md';
        if (to === '/resolved//test/input/about.html') return 'about.html';
        if (to === '/resolved//test/input/blog/post.md') return 'blog/post.md';
        if (to === '/resolved//test/input/styles.css') return 'styles.css';
        if (to === '/resolved//test/input/blog/index.md') return 'blog/index.md';
        return 'default.md';
      });
    });

    it('should convert markdown files to .html URLs', () => {
      mockPath.relative.mockReturnValue('about.md');
      mockPath.extname.mockReturnValue('.md');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/about.md');
      expect(result).toBe('/about.html');
    });

    it('should convert HTML files to pretty URLs', () => {
      const result = resolver['calculateEleventyUrl']('/resolved//test/input/about.html');
      expect(result).toBe('/about');
    });

    it('should convert template files to .html URLs', () => {
      const templateExtensions = ['.njk', '.liquid', '.hbs', '.mustache', '.ejs', '.haml', '.pug', '.jstl'];

      templateExtensions.forEach((ext) => {
        mockPath.relative.mockReturnValue(`test${ext}`);
        mockPath.extname.mockReturnValue(ext);

        const result = resolver['calculateEleventyUrl'](`/test/input/test${ext}`);
        expect(result).toBe('/test.html');
      });
    });

    it('should handle index.html files specially (root)', () => {
      mockPath.relative.mockReturnValue('index.html');
      mockPath.extname.mockReturnValue('.html');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/index.html');
      expect(result).toBe('/');
    });

    it('should handle nested index.html files', () => {
      mockPath.relative.mockReturnValue('blog/index.html');
      mockPath.extname.mockReturnValue('.html');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/blog/index.html');
      expect(result).toBe('/blog/');
    });

    it('should handle index.md files specially (root)', () => {
      mockPath.relative.mockReturnValue('index.md');
      mockPath.extname.mockReturnValue('.md');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/index.md');
      expect(result).toBe('/');
    });

    it('should handle nested index.md files', () => {
      mockPath.relative.mockReturnValue('blog/index.md');
      mockPath.extname.mockReturnValue('.md');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/blog/index.md');
      expect(result).toBe('/blog/');
    });

    it('should preserve asset files as-is', () => {
      mockPath.relative.mockReturnValue('styles.css');
      mockPath.extname.mockReturnValue('.css');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/styles.css');
      expect(result).toBe('/styles.css');
    });

    it('should normalize Windows path separators', () => {
      mockPath.relative.mockReturnValue('blog\\post.md');
      mockPath.extname.mockReturnValue('.md');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/blog/post.md');
      expect(result).toBe('/blog/post.html');
    });

    it('should ensure URLs start with forward slash', () => {
      mockPath.relative.mockReturnValue('test.md');
      mockPath.extname.mockReturnValue('.md');

      const result = resolver['calculateEleventyUrl']('/resolved//test/input/test.md');
      expect(result).toBe('/test.html');
    });
  });

  describe('getUrlForFile', () => {
    it('should return URL for existing file', () => {
      const filePath = '/test/file.md';
      const url = '/test.html';

      mockPath.resolve.mockReturnValue('/resolved/test/file.md');
      resolver['urlMap'].set('/resolved/test/file.md', url);

      const result = resolver.getUrlForFile(filePath);
      expect(result).toBe(url);
    });

    it('should return calculated URL for non-mapped content file', () => {
      const filePath = '/test/input/new/page.md';
      mockPath.resolve.mockReturnValue('/test/input/new/page.md');
      mockPath.relative.mockReturnValueOnce('new/page.md');

      const result = resolver.getUrlForFile(filePath);
      expect(result).toBe('/new/page.html'); // Fallback calculation for .md → .html
    });

    it('should return null for non-content file', () => {
      const filePath = '/nonexistent/file.txt';
      mockPath.resolve.mockReturnValue('/resolved/nonexistent/file.txt');

      const result = resolver.getUrlForFile(filePath);
      expect(result).toBeNull();
    });
  });

  describe('getFileForUrl', () => {
    it('should return file path for existing URL', () => {
      const filePath = '/test/file.md';
      const url = '/test.html';

      resolver['urlMap'].set(filePath, url);

      const result = resolver.getFileForUrl(url);
      expect(result).toBe(filePath);
    });

    it('should return null for non-existing URL', () => {
      const result = resolver.getFileForUrl('/nonexistent.html');
      expect(result).toBeNull();
    });

    it('should return first match for duplicate URLs', () => {
      const filePath1 = '/test/file1.md';
      const filePath2 = '/test/file2.md';
      const url = '/test.html';

      resolver['urlMap'].set(filePath1, url);
      resolver['urlMap'].set(filePath2, url);

      const result = resolver.getFileForUrl(url);
      expect([filePath1, filePath2]).toContain(result);
    });
  });

  describe('getAllMappings', () => {
    it('should return all file-URL mappings sorted by URL', () => {
      resolver['urlMap'].set('/test/b.md', '/b.html');
      resolver['urlMap'].set('/test/a.md', '/a.html');
      resolver['urlMap'].set('/test/c.md', '/c.html');

      const result = resolver.getAllMappings();

      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { filePath: '/test/a.md', url: '/a.html', isDirectory: false },
        { filePath: '/test/b.md', url: '/b.html', isDirectory: false },
        { filePath: '/test/c.md', url: '/c.html', isDirectory: false },
      ]);
    });

    it('should return empty array when no mappings exist', () => {
      const result = resolver.getAllMappings();
      expect(result).toEqual([]);
    });

    it('should mark all files as non-directories', () => {
      resolver['urlMap'].set('/test/file.md', '/file.html');

      const result = resolver.getAllMappings();
      expect(result[0].isDirectory).toBe(false);
    });
  });

  describe('getFileTree', () => {
    it('should build complete file tree successfully', async () => {
      const mockFiles = [
        { filePath: '/test/file1.md', url: '/file1.html', isDirectory: false },
        { filePath: '/test/dir1', url: '/dir1/', isDirectory: true },
      ];

      jest
        .spyOn(
          resolver as unknown as { addDirectoryToTree: (...args: unknown[]) => Promise<void> },
          'addDirectoryToTree'
        )
        .mockImplementation((...args: unknown[]) => {
          const [, , allFiles] = args;
          (allFiles as unknown[]).push(...mockFiles);
          return Promise.resolve();
        });

      const result = await resolver.getFileTree();

      expect(result).toEqual(mockFiles);
      expect(consoleLogSpy).toHaveBeenCalledWith('Building file tree for directory: /resolved//test/input');
      expect(consoleLogSpy).toHaveBeenCalledWith('File tree built successfully. Found 2 files/directories.');
    });

    it('should log sample files when files exist', async () => {
      const mockFiles = Array.from({ length: 10 }, (_, i) => ({
        filePath: `/test/file${i}.md`,
        url: `/file${i}.html`,
        isDirectory: false,
      }));

      jest
        .spyOn(
          resolver as unknown as { addDirectoryToTree: (...args: unknown[]) => Promise<void> },
          'addDirectoryToTree'
        )
        .mockImplementation((...args: unknown[]) => {
          const [, , allFiles] = args;
          (allFiles as unknown[]).push(...mockFiles);
          return Promise.resolve();
        });

      await resolver.getFileTree();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Sample files:',
        expect.arrayContaining([expect.objectContaining({ path: '/test/file0.md', url: '/file0.html', isDir: false })])
      );
    });

    it('should handle file tree building errors', async () => {
      const error = new Error('File tree failed');
      jest
        .spyOn(resolver as unknown as { addDirectoryToTree: () => Promise<void> }, 'addDirectoryToTree')
        .mockImplementation(() => Promise.reject(error));

      const result = await resolver.getFileTree();

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error building file tree:', error);
    });
  });

  // Note: addDirectoryToTree tests are complex due to recursion - skipping to avoid stack overflow

  describe('integration scenarios', () => {
    it('should handle complete workflow with file watching', async () => {
      // Set NODE_ENV to development to enable logging
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Setup initial files
      const initialFiles = ['/test/input/index.md', '/test/input/about.md'];
      mockGlob.mockResolvedValue(initialFiles);

      // Initialize resolver
      await resolver.initialize();

      // Verify initialization
      expect(mockChokidar.watch).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Built URL map for 2 files in /resolved//test/input');

      // Simulate file addition
      const addCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'add')?.[1];
      jest.spyOn(resolver as unknown as { isContentFile: () => boolean }, 'isContentFile').mockReturnValue(true);
      jest
        .spyOn(resolver as unknown as { calculateEleventyUrl: () => string }, 'calculateEleventyUrl')
        .mockReturnValue('/new-file.html');

      addCallback?.('/test/input/new-file.md');

      // Verify file was added to map
      expect(consoleLogSpy).toHaveBeenCalledWith('Added URL mapping: /test/input/new-file.md → /new-file.html');

      // Simulate file deletion
      const unlinkCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'unlink')?.[1];
      resolver['urlMap'].set('/test/input/new-file.md', '/new-file.html');

      unlinkCallback?.('/test/input/new-file.md');

      // Verify file was removed from map
      expect(consoleLogSpy).toHaveBeenCalledWith('Removed URL mapping: /test/input/new-file.md');

      // Cleanup
      resolver.destroy();
      expect(mockWatcher.close).toHaveBeenCalled();

      // Restore original NODE_ENV
      process.env.NODE_ENV = originalEnv;
    });
  });
});
