/**
 * @file Atomic operations framework for safe data operations
 *
 * This module provides atomic operation capabilities with temporary files,
 * validation, and automatic rollback mechanisms to ensure data integrity
 * during critical operations like file creation, updates, and directory operations.
 *
 * Features:
 * - Atomic file operations with temporary files
 * - Directory operations with rollback capability
 * - Validation hooks for pre and post operation checks
 * - Automatic cleanup on success or failure
 * - Transaction-like semantics for complex operations
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import {
  AtomicOperationError,
  AtomicWriteError,
  FileNotFoundError,
  DirectoryNotFoundError,
  ErrorUtils,
} from '../core/errors';
// BufferEncoding is a built-in Node.js type alias
type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const copyFile = promisify(fs.copyFile);
const rename = promisify(fs.rename);
const rm = promisify(fs.rm);
const lstat = promisify(fs.lstat);

// Helper to check if file exists using fs.promises.stat
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Result of an atomic operation containing success status, results, and cleanup information.
 */
export interface AtomicOperationResult<T = void> {
  success: boolean;
  result?: T;
  error?: AtomicOperationError;
  rollbackPerformed: boolean;
  temporaryPaths: string[];
}

/**
 * Validation function type for atomic operations
 */
export type ValidationFunction<T = unknown> = (data: T) => Promise<boolean> | boolean;

/**
 * Rollback function type for cleanup operations
 */
export type RollbackFunction = () => Promise<void> | void;

/**
 * Options for atomic file operations
 */
export interface AtomicFileOptions {
  /** Custom temporary directory (defaults to system temp) */
  tempDir?: string;
  /** File encoding for text operations */
  encoding?: BufferEncoding;
  /** Backup original file before overwrite */
  backup?: boolean;
  /** Custom validation function */
  validate?: ValidationFunction<string>;
  /** Maximum number of retry attempts for temporary file creation */
  maxRetries?: number;
}

/**
 * Options for atomic directory operations
 */
export interface AtomicDirectoryOptions {
  /** Custom temporary directory for staging operations */
  tempDir?: string;
  /** Files/directories to exclude from operations */
  exclude?: string[];
  /** Preserve timestamps during copy operations */
  preserveTimestamps?: boolean;
  /** Custom validation function for directory contents */
  validate?: ValidationFunction<string[]>;
  /** Maximum depth for recursive operations */
  maxDepth?: number;
}

/**
 * Transaction context for complex atomic operations
 */
export class AtomicTransaction {
  private operations: Array<() => Promise<void>> = [];
  private rollbacks: RollbackFunction[] = [];
  private temporaryPaths: string[] = [];
  private completed = false;
  private rolledBack = false;

  /**
   * Add an operation to the transaction.
   * @param operation Function to execute
   * @param rollback Function to rollback the operation
   */
  addOperation(operation: () => Promise<void>, rollback?: RollbackFunction): void {
    if (this.completed) {
      throw new AtomicOperationError(
        'Cannot add operations to completed transaction',
        'TRANSACTION_ALREADY_COMPLETED',
        'addOperation',
        false
      );
    }
    this.operations.push(operation);
    if (rollback) {
      this.rollbacks.unshift(rollback); // Add to front for reverse order cleanup
    }
  }

  /**
   * Track a temporary path for cleanup.
   * @param tempPath Path to track for cleanup
   */
  trackTemporaryPath(tempPath: string): void {
    this.temporaryPaths.push(tempPath);
  }

  /**
   * Execute all operations atomically.
   * @returns Result of the transaction
   */
  async execute<T = void>(): Promise<AtomicOperationResult<T>> {
    if (this.completed) {
      throw new AtomicOperationError(
        'Transaction already completed',
        'TRANSACTION_ALREADY_COMPLETED',
        'execute',
        false
      );
    }

    try {
      // Execute all operations in sequence
      for (const operation of this.operations) {
        await operation();
      }

      // Mark as completed
      this.completed = true;

      // Clean up temporary paths
      await this.cleanupTemporaryPaths();

      return {
        success: true,
        rollbackPerformed: false,
        temporaryPaths: [...this.temporaryPaths],
      };
    } catch (error) {
      // Rollback all operations
      const rollbackResult = await this.rollback();

      return {
        success: false,
        error: ErrorUtils.wrap(error) as AtomicOperationError,
        rollbackPerformed: rollbackResult,
        temporaryPaths: [...this.temporaryPaths],
      };
    }
  }

  /**
   * Rollback all operations.
   * @returns True if rollback was successful
   */
  async rollback(): Promise<boolean> {
    if (this.rolledBack) {
      return true;
    }

    let rollbackSuccess = true;

    // Execute rollbacks in reverse order
    for (const rollback of this.rollbacks) {
      try {
        await rollback();
      } catch (error) {
        console.error('Rollback operation failed:', error);
        rollbackSuccess = false;
      }
    }

    // Clean up temporary paths
    await this.cleanupTemporaryPaths();

    this.rolledBack = true;
    return rollbackSuccess;
  }

  /**
   * Clean up temporary paths.
   */
  private async cleanupTemporaryPaths(): Promise<void> {
    for (const tempPath of this.temporaryPaths) {
      try {
        if (await exists(tempPath)) {
          const stat = await lstat(tempPath);
          if (stat.isDirectory()) {
            await rm(tempPath, { recursive: true, force: true });
          } else {
            await rm(tempPath, { force: true });
          }
        }
      } catch (error) {
        console.warn(`Failed to cleanup temporary path ${tempPath}:`, error);
      }
    }
    this.temporaryPaths.length = 0;
  }
}

/**
 * Generate a unique temporary file path.
 * @param baseName Base name for the temporary file
 * @param tempDir Temporary directory (defaults to system temp)
 * @returns Unique temporary file path
 */
export function generateTempPath(baseName: string, tempDir?: string): string {
  const dir = tempDir || os.tmpdir();
  const uniqueSuffix = randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return path.join(dir, `${baseName}.${timestamp}.${uniqueSuffix}.tmp`);
}

/**
 * Atomically write data to a file using temporary file.
 * @param filePath Target file path
 * @param data Data to write
 * @param options Atomic operation options
 * @returns Result of the atomic operation
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options: AtomicFileOptions = {}
): Promise<AtomicOperationResult<void>> {
  const { tempDir, encoding = 'utf8', backup = false, validate, maxRetries = 3 } = options;

  const tempPath = generateTempPath(path.basename(filePath), tempDir);
  const backupPath = backup ? `${filePath}.backup.${Date.now()}` : undefined;
  let backupCreated = false;

  try {
    // Ensure target directory exists
    const targetDir = path.dirname(filePath);
    if (!(await exists(targetDir))) {
      await mkdir(targetDir, { recursive: true });
    }

    // Create backup if requested and original file exists
    if (backup && (await exists(filePath))) {
      await copyFile(filePath, backupPath!);
      backupCreated = true;
    }

    // Write to temporary file with retries
    let writeSuccess = false;
    let writeError: AtomicOperationError | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (typeof data === 'string') {
          await writeFile(tempPath, data, encoding);
        } else {
          await writeFile(tempPath, data);
        }
        writeSuccess = true;
        break;
      } catch (error) {
        writeError = ErrorUtils.wrap(error) as AtomicOperationError;
        if (attempt < maxRetries) {
          // Wait before retry with exponential backoff
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        }
      }
    }

    if (!writeSuccess) {
      throw new AtomicWriteError(writeError?.message || 'Failed to write temporary file', tempPath, filePath, {
        operation: 'atomicWriteFile',
      });
    }

    // Validate the written data if validator provided
    if (validate) {
      const writtenData = await readFile(tempPath, encoding);
      const dataAsString = Buffer.isBuffer(writtenData) ? writtenData.toString() : writtenData;
      const isValid = await validate(dataAsString);
      if (!isValid) {
        throw new AtomicWriteError('File validation failed after write', tempPath, filePath, {
          operation: 'validation',
        });
      }
    }

    // Atomic move from temporary to target
    await rename(tempPath, filePath);

    // Clean up backup if successful and not needed
    if (backupCreated && backupPath && !backup) {
      try {
        await rm(backupPath);
      } catch {
        // Ignore backup cleanup errors
      }
    }

    return {
      success: true,
      rollbackPerformed: false,
      temporaryPaths: [tempPath],
    };
  } catch (error) {
    // Cleanup temporary file
    try {
      if (await exists(tempPath)) {
        await rm(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }

    // Restore backup if it was created
    if (backupCreated && backupPath) {
      try {
        if (await exists(backupPath)) {
          await rename(backupPath, filePath);
        }
      } catch (restoreError) {
        console.error('Failed to restore backup:', restoreError);
      }
    }

    return {
      success: false,
      error: ErrorUtils.wrap(error) as AtomicOperationError,
      rollbackPerformed: backupCreated,
      temporaryPaths: [tempPath],
    };
  }
}

/**
 * Atomically copy a directory using temporary staging.
 * @param sourcePath Path to the source directory to copy from
 * @param targetPath Path to the target directory to copy to
 * @param options Atomic directory operation options
 * @returns Result of the atomic operation
 */
export async function atomicCopyDirectory(
  sourcePath: string,
  targetPath: string,
  options: AtomicDirectoryOptions = {}
): Promise<AtomicOperationResult<void>> {
  const { tempDir, exclude = [], preserveTimestamps = true, validate, maxDepth = 50 } = options;

  // Generate temporary staging directory
  const stagingPath = generateTempPath(`copy-${path.basename(targetPath)}`, tempDir);
  let stagingCreated = false;
  let targetExisted = false;
  let backupPath: string | undefined;

  try {
    // Check if source exists
    if (!(await exists(sourcePath))) {
      throw new DirectoryNotFoundError(sourcePath, {
        operation: 'atomicCopyDirectory',
      });
    }

    // Check if target exists (for potential rollback)
    targetExisted = await exists(targetPath);
    if (targetExisted) {
      backupPath = generateTempPath(`backup-${path.basename(targetPath)}`, tempDir);
      await rename(targetPath, backupPath);
    }

    // Create staging directory
    await mkdir(stagingPath, { recursive: true });
    stagingCreated = true;

    // Copy source to staging area
    await copyDirectoryRecursive(sourcePath, stagingPath, {
      exclude,
      preserveTimestamps,
      maxDepth,
      currentDepth: 0,
    });

    // Validate staging directory if validator provided
    if (validate) {
      const contents = await readdir(stagingPath);
      const isValid = await validate(contents);
      if (!isValid) {
        throw new Error('Directory validation failed after copy');
      }
    }

    // Atomic move from staging to target
    await rename(stagingPath, targetPath);

    // Clean up backup if successful
    if (backupPath && (await exists(backupPath))) {
      await rm(backupPath, { recursive: true, force: true });
    }

    return {
      success: true,
      rollbackPerformed: false,
      temporaryPaths: [stagingPath],
    };
  } catch (error) {
    // Rollback: restore original target if it existed
    if (targetExisted && backupPath) {
      try {
        if (await exists(targetPath)) {
          await rm(targetPath, { recursive: true, force: true });
        }
        if (await exists(backupPath)) {
          await rename(backupPath, targetPath);
        }
      } catch (rollbackError) {
        console.error('Failed to rollback directory operation:', rollbackError);
      }
    }

    // Clean up staging directory
    if (stagingCreated && (await exists(stagingPath))) {
      try {
        await rm(stagingPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      success: false,
      error: ErrorUtils.wrap(error) as AtomicOperationError,
      rollbackPerformed: targetExisted,
      temporaryPaths: [stagingPath],
    };
  }
}

/**
 * Atomically rename/move a file or directory.
 * @param oldPath Current path of the file or directory to rename
 * @param newPath New path for the renamed file or directory
 * @param options Optional configuration including validation function
 * @param options.validate Optional validation function to verify the rename operation
 * @returns Result of the atomic operation
 */
export async function atomicRename(
  oldPath: string,
  newPath: string,
  options: { validate?: ValidationFunction<string> } = {}
): Promise<AtomicOperationResult<void>> {
  const { validate } = options;

  let backupPath: string | undefined;
  let newPathExisted = false;

  try {
    // Check if source exists
    if (!(await exists(oldPath))) {
      throw new FileNotFoundError(oldPath, {
        operation: 'atomicRename',
      });
    }

    // Check if target already exists
    newPathExisted = await exists(newPath);
    if (newPathExisted) {
      // Create backup of existing target
      backupPath = generateTempPath(`backup-${path.basename(newPath)}`);
      await rename(newPath, backupPath);
    }

    // Perform the rename
    await rename(oldPath, newPath);

    // Validate the result if validator provided
    if (validate) {
      const isValid = await validate(newPath);
      if (!isValid) {
        throw new Error('Rename validation failed');
      }
    }

    // Clean up backup if successful
    if (backupPath && (await exists(backupPath))) {
      const stat = await lstat(backupPath);
      if (stat.isDirectory()) {
        await rm(backupPath, { recursive: true, force: true });
      } else {
        await rm(backupPath);
      }
    }

    return {
      success: true,
      rollbackPerformed: false,
      temporaryPaths: backupPath ? [backupPath] : [],
    };
  } catch (error) {
    // Rollback: restore original state
    try {
      // If newPath exists, move it back to oldPath
      if (await exists(newPath)) {
        await rename(newPath, oldPath);
      }

      // If there was a backup, restore it
      if (newPathExisted && backupPath && (await exists(backupPath))) {
        await rename(backupPath, newPath);
      }
    } catch (rollbackError) {
      console.error('Failed to rollback rename operation:', rollbackError);
    }

    return {
      success: false,
      error: ErrorUtils.wrap(error) as AtomicOperationError,
      rollbackPerformed: true,
      temporaryPaths: backupPath ? [backupPath] : [],
    };
  }
}

/**
 * Helper function to recursively copy directories.
 */
async function copyDirectoryRecursive(
  source: string,
  target: string,
  options: {
    exclude: string[];
    preserveTimestamps: boolean;
    maxDepth: number;
    currentDepth: number;
  }
): Promise<void> {
  const { exclude, preserveTimestamps, maxDepth, currentDepth } = options;

  if (currentDepth >= maxDepth) {
    throw new AtomicOperationError(
      `Maximum directory depth (${maxDepth}) exceeded`,
      'MAX_DEPTH_EXCEEDED',
      'copyDirectoryRecursive',
      false,
      undefined,
      { maxDepth, currentDepth }
    );
  }

  // Ensure target directory exists
  if (!(await exists(target))) {
    await mkdir(target, { recursive: true });
  }

  const items = await readdir(source);

  for (const item of items) {
    // Skip excluded items
    if (exclude.includes(item)) {
      continue;
    }

    const sourcePath = path.join(source, item);
    const targetPath = path.join(target, item);

    const stat = await lstat(sourcePath);

    if (stat.isDirectory()) {
      // Recursively copy subdirectory
      await copyDirectoryRecursive(sourcePath, targetPath, {
        ...options,
        currentDepth: currentDepth + 1,
      });
    } else if (stat.isFile()) {
      // Copy file
      await copyFile(sourcePath, targetPath);

      // Preserve timestamps if requested
      if (preserveTimestamps) {
        try {
          await fs.promises.utimes(targetPath, stat.atime, stat.mtime);
        } catch {
          // Ignore timestamp preservation errors
        }
      }
    }
    // Skip symbolic links and other special files for security
  }
}

/**
 * Create a new atomic transaction.
 * @returns New atomic transaction instance
 */
export function createAtomicTransaction(): AtomicTransaction {
  return new AtomicTransaction();
}

/**
 * Utility to safely execute an operation with automatic rollback.
 * @param operation Function to execute
 * @param rollback Function to call on failure
 * @returns Result of the operation
 */
export async function withRollback<T>(
  operation: () => Promise<T>,
  rollback: RollbackFunction
): Promise<AtomicOperationResult<T>> {
  try {
    const result = await operation();
    return {
      success: true,
      result,
      rollbackPerformed: false,
      temporaryPaths: [],
    };
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
    }

    return {
      success: false,
      error: ErrorUtils.wrap(error) as AtomicOperationError,
      rollbackPerformed: true,
      temporaryPaths: [],
    };
  }
}
