/**
 * @file Unit tests for Enhanced File Watcher
 */
import {
  EnhancedFileWatcher,
  createEnhancedFileWatcher,
  FileChangeInfo,
} from '../../src/main/server/enhanced-file-watcher';
import * as path from 'path';

// Mock chokidar
jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('EnhancedFileWatcher', () => {
  let mockRebuildCallback: jest.MockedFunction<(changes: FileChangeInfo[]) => Promise<void>>;
  let watcher: EnhancedFileWatcher;
  let mockChokidarWatcher: {
    on: jest.MockedFunction<(event: string, callback: (...args: unknown[]) => void) => typeof mockChokidarWatcher>;
    close: jest.MockedFunction<() => Promise<void>>;
  };

  beforeEach(() => {
    mockRebuildCallback = jest.fn().mockResolvedValue(undefined);
    mockChokidarWatcher = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const chokidar = require('chokidar');
    (chokidar.watch as jest.Mock).mockReturnValue(mockChokidarWatcher);

    watcher = createEnhancedFileWatcher(mockRebuildCallback, {
      inputDir: '/test/input',
      outputDir: '/test/output',
      debounceMs: 100, // Short debounce for testing
      maxBatchSize: 10,
      enableMetrics: true,
    });
  });

  afterEach(async () => {
    await watcher.stop();
  });

  describe('initialization', () => {
    it('should create watcher with default configuration', () => {
      const watcher = createEnhancedFileWatcher(mockRebuildCallback, {
        inputDir: '/test/input',
        outputDir: '/test/output',
      });

      expect(watcher).toBeInstanceOf(EnhancedFileWatcher);
    });

    it('should merge custom configuration with defaults', () => {
      const customConfig = {
        inputDir: '/custom/input',
        outputDir: '/custom/output',
        debounceMs: 500,
        maxBatchSize: 20,
        enableMetrics: false,
      };

      const watcher = createEnhancedFileWatcher(mockRebuildCallback, customConfig);
      expect(watcher).toBeInstanceOf(EnhancedFileWatcher);
    });
  });

  describe('file watching', () => {
    it('should start watching files with correct configuration', async () => {
      await watcher.start();

      const chokidar = require('chokidar');
      expect(chokidar.watch).toHaveBeenCalledWith(
        path.join('/test/input', '/**/*'),
        expect.objectContaining({
          ignored: expect.arrayContaining(['/test/output/**']),
          ignoreInitial: true,
          persistent: true,
        })
      );

      expect(mockChokidarWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockChokidarWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockChokidarWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('should stop watching and clean up resources', async () => {
      await watcher.start();
      await watcher.stop();

      expect(mockChokidarWatcher.close).toHaveBeenCalled();
    });
  });

  describe('metrics', () => {
    it('should track performance metrics', async () => {
      const metrics = watcher.getMetrics();

      expect(metrics).toMatchObject({
        totalChanges: 0,
        totalRebuilds: 0,
        averageRebuildTime: 0,
        batchedChanges: 0,
        ignoredChanges: 0,
        peakMemoryUsage: expect.any(Number),
        startTime: expect.any(Number),
      });
    });

    it('should update metrics when files change', async () => {
      await watcher.start();

      // Simulate file change by calling the handler directly
      const changeHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'change')[1];

      // Simulate a change to a valid file
      changeHandler('/test/input/src/index.md');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      const metrics = watcher.getMetrics();
      expect(metrics.totalChanges).toBe(1);
    });
  });

  describe('file filtering', () => {
    it('should ignore output directory changes', async () => {
      await watcher.start();

      const changeHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'change')[1];

      // Simulate change in output directory
      changeHandler('/test/output/generated.html');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockRebuildCallback).not.toHaveBeenCalled();
    });

    it('should ignore temporary files', async () => {
      await watcher.start();

      const changeHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'change')[1];

      // Simulate change to temporary file
      changeHandler('/test/input/src/temp.tmp');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockRebuildCallback).not.toHaveBeenCalled();
    });

    it('should process valid file changes', async () => {
      await watcher.start();

      const changeHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'change')[1];

      // Simulate change to valid file
      changeHandler('/test/input/src/index.md');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockRebuildCallback).toHaveBeenCalledWith([
        expect.objectContaining({
          path: '/test/input/src/index.md',
          event: 'change',
          relativePath: 'src/index.md',
          isDirectory: false,
        }),
      ]);
    });
  });

  describe('debouncing and batching', () => {
    it('should debounce multiple rapid changes', async () => {
      await watcher.start();

      const changeHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'change')[1];

      // Simulate rapid file changes
      changeHandler('/test/input/src/file1.md');
      changeHandler('/test/input/src/file2.md');
      changeHandler('/test/input/src/file3.md');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should only trigger one rebuild with all changes batched
      expect(mockRebuildCallback).toHaveBeenCalledTimes(1);
      expect(mockRebuildCallback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ relativePath: 'src/file1.md' }),
          expect.objectContaining({ relativePath: 'src/file2.md' }),
          expect.objectContaining({ relativePath: 'src/file3.md' }),
        ])
      );
    });

    it('should respect maximum batch size', async () => {
      // Create watcher with small batch size
      const smallBatchWatcher = createEnhancedFileWatcher(mockRebuildCallback, {
        inputDir: '/test/input',
        outputDir: '/test/output',
        debounceMs: 100,
        maxBatchSize: 2,
      });

      await smallBatchWatcher.start();

      const changeHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'change')[1];

      // Simulate more changes than max batch size
      changeHandler('/test/input/src/file1.md');
      changeHandler('/test/input/src/file2.md');
      changeHandler('/test/input/src/file3.md');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should only process up to max batch size
      expect(mockRebuildCallback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ relativePath: 'src/file1.md' }),
          expect.objectContaining({ relativePath: 'src/file2.md' }),
        ])
      );

      await smallBatchWatcher.stop();
    });
  });

  describe('error handling', () => {
    it('should handle rebuild callback errors gracefully', async () => {
      const errorCallback = jest.fn().mockRejectedValue(new Error('Rebuild failed'));
      const errorWatcher = createEnhancedFileWatcher(errorCallback, {
        inputDir: '/test/input',
        outputDir: '/test/output',
        debounceMs: 100,
      });

      await errorWatcher.start();

      const changeHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'change')[1];

      changeHandler('/test/input/src/index.md');

      // Wait for debounce and error handling
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(errorCallback).toHaveBeenCalled();

      await errorWatcher.stop();
    });

    it('should handle watcher errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await watcher.start();

      const errorHandler = mockChokidarWatcher.on.mock.calls.find((call) => call[0] === 'error')[1];

      const testError = new Error('File system error');
      errorHandler(testError);

      expect(consoleSpy).toHaveBeenCalledWith('[Watch Mode] Watcher error:', testError);

      consoleSpy.mockRestore();
    });
  });
});
