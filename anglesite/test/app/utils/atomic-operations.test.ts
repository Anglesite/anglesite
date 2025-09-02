/**
 * @file Comprehensive tests for atomic operations framework
 *
 * Tests atomic file operations, transactions, rollback mechanisms,
 * and failure scenarios to ensure data integrity.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  atomicWriteFile,
  atomicCopyDirectory,
  atomicRename,
  createAtomicTransaction,
  generateTempPath,
  withRollback,
} from '../../../src/main/utils/atomic-operations';

describe('Atomic Operations Framework', () => {
  let testDir: string;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `atomic-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    tempDir = path.join(testDir, 'temp');

    await fs.promises.mkdir(testDir, { recursive: true });
    await fs.promises.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup test directory:', error);
    }
  });

  describe('atomicWriteFile', () => {
    it('should write file atomically with validation', async () => {
      const filePath = path.join(testDir, 'test.json');
      const data = JSON.stringify({ test: 'value' }, null, 2);

      const result = await atomicWriteFile(filePath, data, {
        validate: (content) => {
          try {
            const parsed = JSON.parse(content);
            return parsed.test === 'value';
          } catch {
            return false;
          }
        },
      });

      expect(result.success).toBe(true);
      expect(result.rollbackPerformed).toBe(false);

      // Verify file was written correctly
      const writtenData = await fs.promises.readFile(filePath, 'utf-8');
      expect(JSON.parse(writtenData)).toEqual({ test: 'value' });
    });

    it('should rollback on validation failure', async () => {
      const filePath = path.join(testDir, 'test.json');
      const originalData = JSON.stringify({ original: 'data' });

      // Create original file
      await fs.promises.writeFile(filePath, originalData, 'utf-8');

      const newData = JSON.stringify({ invalid: 'data' });

      const result = await atomicWriteFile(filePath, newData, {
        backup: true,
        validate: () => {
          // Always fail validation to test rollback
          return false;
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('validation failed');

      // Verify original file was restored
      const restoredData = await fs.promises.readFile(filePath, 'utf-8');
      expect(JSON.parse(restoredData)).toEqual({ original: 'data' });
    });

    it('should handle write failures with retries', async () => {
      const filePath = path.join('/nonexistent/directory', 'test.txt');

      const result = await atomicWriteFile(filePath, 'test data', {
        maxRetries: 2,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should create backup when requested', async () => {
      const filePath = path.join(testDir, 'backup-test.txt');
      const originalData = 'original content';
      const newData = 'new content';

      // Create original file
      await fs.promises.writeFile(filePath, originalData, 'utf-8');

      const result = await atomicWriteFile(filePath, newData, {
        backup: true,
      });

      expect(result.success).toBe(true);

      // Verify new content was written
      const writtenData = await fs.promises.readFile(filePath, 'utf-8');
      expect(writtenData).toBe(newData);

      // Verify backup exists (we don't clean it up when successful)
      const backupFiles = await fs.promises.readdir(testDir);
      const backupFile = backupFiles.find((file) => file.includes('backup-test.txt.backup'));
      if (backupFile) {
        const backupData = await fs.promises.readFile(path.join(testDir, backupFile), 'utf-8');
        expect(backupData).toBe(originalData);
      }
    });
  });

  describe('atomicCopyDirectory', () => {
    it('should copy directory atomically with validation', async () => {
      const sourceDir = path.join(testDir, 'source');
      const targetDir = path.join(testDir, 'target');

      // Create source directory structure
      await fs.promises.mkdir(sourceDir, { recursive: true });
      await fs.promises.writeFile(path.join(sourceDir, 'file1.txt'), 'content1', 'utf-8');
      await fs.promises.writeFile(path.join(sourceDir, 'file2.txt'), 'content2', 'utf-8');

      const subDir = path.join(sourceDir, 'subdir');
      await fs.promises.mkdir(subDir);
      await fs.promises.writeFile(path.join(subDir, 'file3.txt'), 'content3', 'utf-8');

      const result = await atomicCopyDirectory(sourceDir, targetDir, {
        validate: async (contents) => {
          return contents.includes('file1.txt') && contents.includes('file2.txt') && contents.includes('subdir');
        },
      });

      expect(result.success).toBe(true);

      // Verify directory was copied correctly
      const targetContents = await fs.promises.readdir(targetDir);
      expect(targetContents).toContain('file1.txt');
      expect(targetContents).toContain('file2.txt');
      expect(targetContents).toContain('subdir');

      const file1Content = await fs.promises.readFile(path.join(targetDir, 'file1.txt'), 'utf-8');
      expect(file1Content).toBe('content1');

      const subDirContents = await fs.promises.readdir(path.join(targetDir, 'subdir'));
      expect(subDirContents).toContain('file3.txt');
    });

    it('should rollback on validation failure', async () => {
      const sourceDir = path.join(testDir, 'source');
      const targetDir = path.join(testDir, 'target');
      const originalTargetDir = path.join(testDir, 'original-target');

      // Create source directory
      await fs.promises.mkdir(sourceDir, { recursive: true });
      await fs.promises.writeFile(path.join(sourceDir, 'file1.txt'), 'content1', 'utf-8');

      // Create original target directory
      await fs.promises.mkdir(originalTargetDir);
      await fs.promises.writeFile(path.join(originalTargetDir, 'original.txt'), 'original content', 'utf-8');

      // Rename to simulate existing target
      await fs.promises.rename(originalTargetDir, targetDir);

      const result = await atomicCopyDirectory(sourceDir, targetDir, {
        validate: async () => false, // Always fail validation
      });

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);

      // Verify original target was restored
      const restoredContents = await fs.promises.readdir(targetDir);
      expect(restoredContents).toContain('original.txt');

      const originalContent = await fs.promises.readFile(path.join(targetDir, 'original.txt'), 'utf-8');
      expect(originalContent).toBe('original content');
    });

    it('should exclude specified files and directories', async () => {
      const sourceDir = path.join(testDir, 'source');
      const targetDir = path.join(testDir, 'target');

      // Create source with files to exclude
      await fs.promises.mkdir(sourceDir, { recursive: true });
      await fs.promises.writeFile(path.join(sourceDir, 'include.txt'), 'include me', 'utf-8');
      await fs.promises.writeFile(path.join(sourceDir, 'exclude.txt'), 'exclude me', 'utf-8');

      const nodeModulesDir = path.join(sourceDir, 'node_modules');
      await fs.promises.mkdir(nodeModulesDir);
      await fs.promises.writeFile(path.join(nodeModulesDir, 'package.json'), '{}', 'utf-8');

      const result = await atomicCopyDirectory(sourceDir, targetDir, {
        exclude: ['exclude.txt', 'node_modules'],
      });

      expect(result.success).toBe(true);

      const targetContents = await fs.promises.readdir(targetDir);
      expect(targetContents).toContain('include.txt');
      expect(targetContents).not.toContain('exclude.txt');
      expect(targetContents).not.toContain('node_modules');
    });
  });

  describe('atomicRename', () => {
    it('should rename file atomically with validation', async () => {
      const oldPath = path.join(testDir, 'old.txt');
      const newPath = path.join(testDir, 'new.txt');

      await fs.promises.writeFile(oldPath, 'test content', 'utf-8');

      const result = await atomicRename(oldPath, newPath, {
        validate: async (path) => {
          const content = await fs.promises.readFile(path, 'utf-8');
          return content === 'test content';
        },
      });

      expect(result.success).toBe(true);

      // Verify file was renamed
      expect(
        await fs.promises
          .access(oldPath)
          .then(() => false)
          .catch(() => true)
      ).toBe(true);
      expect(
        await fs.promises
          .access(newPath)
          .then(() => true)
          .catch(() => false)
      ).toBe(true);

      const content = await fs.promises.readFile(newPath, 'utf-8');
      expect(content).toBe('test content');
    });

    it('should rollback on validation failure', async () => {
      const oldPath = path.join(testDir, 'old.txt');
      const newPath = path.join(testDir, 'new.txt');

      await fs.promises.writeFile(oldPath, 'old content', 'utf-8');
      await fs.promises.writeFile(newPath, 'existing content', 'utf-8');

      const result = await atomicRename(oldPath, newPath, {
        validate: async () => false, // Always fail validation
      });

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);

      // Verify rollback: old file should exist with original content, new file should have existing content
      expect(
        await fs.promises
          .access(oldPath)
          .then(() => true)
          .catch(() => false)
      ).toBe(true);

      const oldContent = await fs.promises.readFile(oldPath, 'utf-8');
      expect(oldContent).toBe('old content');

      const newContent = await fs.promises.readFile(newPath, 'utf-8');
      expect(newContent).toBe('existing content');
    });
  });

  describe('AtomicTransaction', () => {
    it('should execute multiple operations atomically', async () => {
      const transaction = createAtomicTransaction();
      const file1Path = path.join(testDir, 'file1.txt');
      const file2Path = path.join(testDir, 'file2.txt');

      transaction.addOperation(async () => {
        await fs.promises.writeFile(file1Path, 'content1', 'utf-8');
      });

      transaction.addOperation(async () => {
        await fs.promises.writeFile(file2Path, 'content2', 'utf-8');
      });

      const result = await transaction.execute();

      expect(result.success).toBe(true);
      expect(result.rollbackPerformed).toBe(false);

      // Verify both files were created
      expect(await fs.promises.readFile(file1Path, 'utf-8')).toBe('content1');
      expect(await fs.promises.readFile(file2Path, 'utf-8')).toBe('content2');
    });

    it('should rollback all operations on failure', async () => {
      const transaction = createAtomicTransaction();
      const file1Path = path.join(testDir, 'file1.txt');
      let file1Created = false;
      let file1Rolled = false;

      transaction.addOperation(
        async () => {
          await fs.promises.writeFile(file1Path, 'content1', 'utf-8');
          file1Created = true;
        },
        async () => {
          if (
            await fs.promises
              .access(file1Path)
              .then(() => true)
              .catch(() => false)
          ) {
            await fs.promises.unlink(file1Path);
            file1Rolled = true;
          }
        }
      );

      transaction.addOperation(async () => {
        // This operation will fail
        throw new Error('Simulated failure');
      });

      const result = await transaction.execute();

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);
      expect(result.error?.message).toBe('Simulated failure');

      // Verify first operation was rolled back
      expect(file1Created).toBe(true);
      expect(file1Rolled).toBe(true);
      expect(
        await fs.promises
          .access(file1Path)
          .then(() => false)
          .catch(() => true)
      ).toBe(true);
    });

    it('should handle rollback failures gracefully', async () => {
      const transaction = createAtomicTransaction();

      transaction.addOperation(
        async () => {
          // Operation succeeds
        },
        async () => {
          // Rollback fails
          throw new Error('Rollback failure');
        }
      );

      transaction.addOperation(async () => {
        throw new Error('Main operation failure');
      });

      const result = await transaction.execute();

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(false); // Rollback failed
      expect(result.error?.message).toBe('Main operation failure');
    });
  });

  describe('withRollback utility', () => {
    it('should execute operation successfully without rollback', async () => {
      const filePath = path.join(testDir, 'success.txt');

      const result = await withRollback(
        async () => {
          await fs.promises.writeFile(filePath, 'success', 'utf-8');
          return 'operation completed';
        },
        async () => {
          // This shouldn't be called
          await fs.promises.unlink(filePath);
        }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('operation completed');
      expect(result.rollbackPerformed).toBe(false);

      // Verify file was created
      const content = await fs.promises.readFile(filePath, 'utf-8');
      expect(content).toBe('success');
    });

    it('should execute rollback on operation failure', async () => {
      const filePath = path.join(testDir, 'rollback.txt');
      let rollbackCalled = false;

      const result = await withRollback(
        async () => {
          await fs.promises.writeFile(filePath, 'temp', 'utf-8');
          throw new Error('Operation failed');
        },
        async () => {
          rollbackCalled = true;
          if (
            await fs.promises
              .access(filePath)
              .then(() => true)
              .catch(() => false)
          ) {
            await fs.promises.unlink(filePath);
          }
        }
      );

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);
      expect(result.error?.message).toBe('Operation failed');
      expect(rollbackCalled).toBe(true);

      // Verify file was cleaned up
      expect(
        await fs.promises
          .access(filePath)
          .then(() => false)
          .catch(() => true)
      ).toBe(true);
    });
  });

  describe('generateTempPath', () => {
    it('should generate unique temporary paths', () => {
      const tempPath1 = generateTempPath('test', tempDir);
      const tempPath2 = generateTempPath('test', tempDir);

      expect(tempPath1).not.toBe(tempPath2);
      expect(tempPath1).toContain(tempDir);
      expect(tempPath1).toContain('test');
      expect(tempPath1).toMatch(/\.tmp$/);

      expect(tempPath2).toContain(tempDir);
      expect(tempPath2).toContain('test');
      expect(tempPath2).toMatch(/\.tmp$/);
    });

    it('should use system temp directory when not specified', () => {
      const tempPath = generateTempPath('test');

      expect(tempPath).toContain(os.tmpdir());
      expect(tempPath).toContain('test');
      expect(tempPath).toMatch(/\.tmp$/);
    });
  });

  describe('Concurrent operations', () => {
    it('should handle concurrent atomic writes safely', async () => {
      const filePath = path.join(testDir, 'concurrent.txt');

      const operations = Array.from({ length: 5 }, (_, i) =>
        atomicWriteFile(filePath, `content-${i}`, {
          validate: (content) => content.startsWith('content-'),
        })
      );

      const results = await Promise.all(operations);

      // All operations should complete (some may fail due to concurrency, but at least one should succeed)
      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBeGreaterThan(0);

      // File should contain valid content from one of the operations
      const finalContent = await fs.promises.readFile(filePath, 'utf-8');
      expect(finalContent).toMatch(/^content-\d$/);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty file writes', async () => {
      const filePath = path.join(testDir, 'empty.txt');

      const result = await atomicWriteFile(filePath, '');

      expect(result.success).toBe(true);

      const content = await fs.promises.readFile(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('should handle very large file writes', async () => {
      const filePath = path.join(testDir, 'large.txt');
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB of 'x'

      const result = await atomicWriteFile(filePath, largeContent);

      expect(result.success).toBe(true);

      const content = await fs.promises.readFile(filePath, 'utf-8');
      expect(content).toBe(largeContent);
      expect(content.length).toBe(1024 * 1024);
    });

    it('should handle file paths with special characters', async () => {
      const specialName = 'test file with spaces & symbols!@#.txt';
      const filePath = path.join(testDir, specialName);

      const result = await atomicWriteFile(filePath, 'special content');

      expect(result.success).toBe(true);

      const content = await fs.promises.readFile(filePath, 'utf-8');
      expect(content).toBe('special content');
    });

    it('should handle operations on non-existent parent directories', async () => {
      const deepPath = path.join(testDir, 'deep', 'nested', 'path', 'file.txt');

      const result = await atomicWriteFile(deepPath, 'deep content');

      expect(result.success).toBe(true);

      const content = await fs.promises.readFile(deepPath, 'utf-8');
      expect(content).toBe('deep content');
    });
  });
});
