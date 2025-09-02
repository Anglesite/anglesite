/**
 * @file Type definitions for bagit-fs package
 * @module bagit-fs
 * @description A Node.js filesystem implementation for the BagIt format,
 * which is a hierarchical file packaging format designed to support reliable
 * storage and transfer of arbitrary digital content.
 * @see {@link https://tools.ietf.org/html/rfc8493} BagIt File Packaging Format
 */

/**
 * @module bagit-fs
 * @description BagIt filesystem implementation for Node.js
 */
declare module 'bagit-fs' {
  import { Writable } from 'stream';

  /**
   * @interface BagOptions
   * @description Metadata options for BagIt bag creation
   */
  interface BagOptions {
    /**
     * @property {string} [key]
     * @description Arbitrary metadata key-value pairs for bag-info.txt
     */
    [key: string]: string;
  }

  /**
   * @interface ManifestEntry
   * @description Entry in the BagIt manifest file representing a data file
   */
  interface ManifestEntry {
    /**
     * @property {string} name
     * @description Relative path of the file within the bag
     */
    name: string;

    /**
     * @property {string} hash
     * @description Checksum hash of the file (algorithm depends on bag configuration)
     */
    hash: string;
  }

  /**
   * @interface Stats
   * @description File statistics information similar to Node.js fs.Stats
   */
  interface Stats {
    /**
     * @function isFile
     * @description Check if the entry is a file
     * @returns True if the entry is a file
     */
    isFile(): boolean;

    /**
     * @function isDirectory
     * @description Check if the entry is a directory
     * @returns True if the entry is a directory
     */
    isDirectory(): boolean;

    /**
     * @property {number} size
     * @description Size of the file in bytes
     */
    size: number;

    /**
     * @property {Date} mtime
     * @description Last modification time of the file
     */
    mtime: Date;
  }

  /**
   * @interface BagItBag
   * @description Main interface for interacting with a BagIt bag,
   * providing filesystem-like operations for reading and writing bag contents
   */
  interface BagItBag {
    /**
     * @function createWriteStream
     * @description Create a writable stream for adding a file to the bag
     * @param path Relative path within the bag where the file will be stored
     * @returns Node.js writable stream for file content
     */
    createWriteStream(path: string): Writable;

    /**
     * @function finalize
     * @description Finalize the bag by generating manifests and tag files
     * @param callback Callback invoked when finalization is complete
     */
    finalize(callback: () => void): void;

    /**
     * @function readFile
     * @description Read a file from the bag
     * @param name Path of the file within the bag
     * @param callback Callback with error or file data
     */
    readFile(name: string, callback: (err: Error | null, data: Buffer) => void): void;

    /**
     * @function readFile
     * @description Read a file from the bag with options
     * @param name Path of the file within the bag
     * @param opts Read options (e.g., encoding)
     * @param callback Callback with error or file data
     */
    readFile(name: string, opts: Record<string, unknown>, callback: (err: Error | null, data: Buffer) => void): void;

    /**
     * @function readManifest
     * @description Read the bag's manifest file containing checksums
     * @param callback Callback with error or manifest entries
     */
    readManifest(callback: (err: Error | null, manifest: ManifestEntry[]) => void): void;

    /**
     * @function getManifestEntry
     * @description Get a specific entry from the manifest
     * @param name File path to look up in the manifest
     * @param callback Callback with error or manifest entry
     */
    getManifestEntry(name: string, callback: (err: Error | null, entry: ManifestEntry | null) => void): void;

    /**
     * @function mkdir
     * @description Create a directory within the bag
     * @param path Directory path to create
     * @param [callback] Optional callback invoked when complete
     */
    mkdir(path: string, callback?: (err: Error | null) => void): void;

    /**
     * @function stat
     * @description Get file or directory statistics
     * @param path Path to stat
     * @param callback Callback with error or stats object
     */
    stat(path: string, callback: (err: Error | null, stats: Stats) => void): void;

    /**
     * @function readdir
     * @description Read directory contents
     * @param path Directory path to read
     * @param callback Callback with error or array of filenames
     */
    readdir(path: string, callback: (err: Error | null, files: string[]) => void): void;

    /**
     * @function unlink
     * @description Remove a file from the bag
     * @param path File path to remove
     * @param [callback] Optional callback invoked when complete
     */
    unlink(path: string, callback?: (err: Error | null) => void): void;

    /**
     * @function rmdir
     * @description Remove a directory from the bag
     * @param path Directory path to remove
     * @param [callback] Optional callback invoked when complete
     */
    rmdir(path: string, callback?: (err: Error | null) => void): void;
  }

  /**
   * Create a new BagIt bag instance.
   * @param destination File system path where the bag will be created
   * @param algorithm Checksum algorithm to use (e.g., 'md5', 'sha256', 'sha512')
   * @param metadata Optional metadata for bag-info.txt
   * @returns BagIt bag instance for reading and writing operations
   */
  function BagIt(destination: string, algorithm?: string, metadata?: BagOptions): BagItBag;

  export default BagIt;
}
