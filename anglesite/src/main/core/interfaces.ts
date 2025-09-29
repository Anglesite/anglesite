/**
 * @file Service Interfaces and Abstractions
 *
 * Defines contracts for all major services in Anglesite to enable
 * dependency injection, testing, and loose coupling between components.
 */

import { WindowState, AppSettings, MonitorInfo, MonitorConfiguration, Rectangle } from './types';
import { AtomicOperationResult } from '../utils/atomic-operations';
import { BrowserWindow } from 'electron';
import type { EleventyUrlResolver } from '../server/eleventy-url-resolver';
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

// Forward declare ManagedServer to avoid circular imports
// The actual interface is defined in '../server/website-server-manager'
// Type alias to avoid circular imports - actual WebsiteServer is defined in '../server/per-website-server'
type WebsiteServer = {
  eleventy: unknown;
  devServer: unknown;
  inputDir: string;
  outputDir: string;
  port: number;
  actualUrl?: string;
  urlResolver: EleventyUrlResolver;
  restoreConsole?: () => void;
};

export interface ManagedServer {
  websiteName: string;
  websitePath: string;
  port: number;
  actualUrl?: string;
  state: string;
  server?: WebsiteServer; // Use WebsiteServer type
  startedAt?: Date;
  lastError?: Error;
  retryCount: number;
}

/**
 * Base interface for all disposable services
 */
export interface IDisposable {
  dispose(): void | Promise<void>;
}

/**
 * Base interface for services that can be initialized
 */
export interface IInitializable {
  initialize(): void | Promise<void>;
}

/**
 * Configuration service interface
 */
export interface IConfigService extends IDisposable {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
  getAll(): Record<string, unknown>;
  save(): Promise<void>;
}

/**
 * Logging service interface
 */
export interface ILogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): ILogger;
}

/**
 * Error reporting service interface
 */
export interface IErrorReportingService extends IDisposable, IInitializable {
  // Report an error
  report(error: Error | unknown, context?: Record<string, unknown>): Promise<void>;

  // Get error statistics
  getStatistics(since?: Date): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  }>;

  // Get recent errors
  getRecentErrors(limit?: number): Promise<unknown[]>;

  // Clear error history
  clearHistory(): Promise<void>;

  // Enable/disable error reporting
  setEnabled(enabled: boolean): void;

  // Check if reporting is enabled
  isEnabled(): boolean;

  // Export errors for analysis
  exportErrors(filePath: string, since?: Date): Promise<void>;
}

/**
 * System notification service interface
 */
export interface ISystemNotificationService extends IDisposable, IInitializable {
  // Notification management
  showCriticalNotification(notification: unknown): Promise<void>;
  dismissSystemNotification(notificationId: string): Promise<void>;
  dismissAllSystemNotifications(): Promise<void>;

  // Badge management
  updateBadgeCount(): void;
  clearBadgeCount(): void;

  // State queries
  getActiveNotifications(): unknown[];
  isNotificationActive(notificationId: string): boolean;

  // Preferences
  setNotificationPreferences(prefs: unknown): void;
  getNotificationPreferences(): unknown;

  // Service status
  getCapabilities(): unknown;
  isHealthy(): boolean;
}

/**
 * Settings store interface
 */
export interface IStore extends IDisposable {
  get<K extends keyof AppSettings>(key: K): AppSettings[K];
  set<K extends keyof AppSettings>(key: K, val: AppSettings[K]): void;
  getAll(): AppSettings;
  setAll(settings: Partial<AppSettings>): void;

  // Window state management
  saveWindowStates(windowStates: WindowState[]): void;
  getWindowStates(): WindowState[];
  clearWindowStates(): void;

  // Recent websites management
  addRecentWebsite(websiteName: string): void;
  getRecentWebsites(): string[];
  clearRecentWebsites(): void;
  removeRecentWebsite(websiteName: string): void;

  // Persistence
  forceSave(): Promise<void>;
}

/**
 * Result of validating a website's structure and configuration.
 */
export interface WebsiteValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Git history management service interface
 */
export interface IGitHistoryManager extends IDisposable {
  initRepository(websitePath: string): Promise<void>;
  autoCommit(websitePath: string, action: 'save' | 'close'): Promise<void>;
  getHistory(websitePath: string, options?: { limit?: number; from?: string; to?: string }): Promise<GitCommitInfo[]>;
  rollback(websitePath: string, commitHash: string): Promise<void>;
  getCurrentCommit(websitePath: string): Promise<string | null>;
  disposeWebsite(websitePath: string): void;
  disposeAll(): void;
}

export interface GitCommitInfo {
  hash: string;
  date: Date;
  message: string;
  body: string;
  author: {
    name: string;
    email: string;
  };
}

/**
 * Website management service interface
 */
export interface IWebsiteManager extends IDisposable {
  // Website operations
  createWebsite(name: string): Promise<string>;
  renameWebsite(oldName: string, newName: string): Promise<boolean>;
  deleteWebsite(name: string): Promise<boolean>;

  // Website queries
  listWebsites(): Promise<string[]>;
  getWebsitePath(name: string): string;
  websiteExists(name: string): Promise<boolean>;

  // Validation
  validateWebsiteName(name: string): WebsiteValidationResult;
  validateWebsiteNameAsync(name: string): Promise<WebsiteValidationResult>;
}

/**
 * Website server information
 */
export interface WebsiteServerInfo {
  name: string;
  port: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  url?: string;
  error?: string;
  pid?: number;
}

/**
 * Website server management service interface
 * Note: This interface extends EventEmitter for server events
 */
export interface IWebsiteServerManager extends IDisposable {
  // EventEmitter methods for server lifecycle events
  on(event: 'server-log', listener: (websiteName: string, message: string, level: string) => void): this;
  on(event: 'server-started', listener: (websiteName: string, managedServer: ManagedServer) => void): this;
  on(event: 'server-error', listener: (websiteName: string, error: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;

  // Server lifecycle
  startServer(websiteName: string, websitePath: string): Promise<WebsiteServerInfo>;
  stopServer(websiteName: string): Promise<void>;
  restartServer(websiteName: string): Promise<WebsiteServerInfo>;

  // Server queries
  getServerInfo(websiteName: string): WebsiteServerInfo | undefined;
  getServer(websiteName: string): ManagedServer | undefined; // Returns ManagedServer but avoiding circular imports
  getAllServers(): ReadonlyMap<string, ManagedServer>; // Returns Map<string, ManagedServer>
  isServerRunning(websiteName: string): boolean;

  // Server management
  stopAllServers(): Promise<void>;
  cleanupOrphanedServers(): Promise<void>;
}

/**
 * DNS management service interface
 */
export interface IDnsManager extends IDisposable {
  // DNS operations
  updateHostsFile(hostname: string, ipAddress?: string): Promise<boolean>;
  cleanupHostsFile(): Promise<boolean>;

  // DNS queries
  isHostnameRegistered(hostname: string): Promise<boolean>;
  getRegisteredHostnames(): Promise<string[]>;
}

/**
 * Certificate management service interface
 */
export interface ICertificateManager extends IDisposable {
  // Certificate operations
  generateCertificate(hostname: string): Promise<{ cert: string; key: string }>;
  installCAInSystem(): Promise<boolean>;
  isCAInstalledInSystem(): Promise<boolean>;

  // Certificate queries
  getCertificatePath(hostname: string): string;
  certificateExists(hostname: string): Promise<boolean>;
}

/**
 * Menu management service interface
 */
export interface IMenuManager extends IDisposable {
  // Menu operations
  updateApplicationMenu(): void;
  createWebsiteContextMenu(websiteName: string): void;

  // Menu state
  setMenuEnabled(enabled: boolean): void;
}

/**
 * Monitor management service interface for multi-monitor window placement.
 */
export interface IMonitorManager extends IDisposable {
  // Monitor detection and configuration
  getCurrentConfiguration(): MonitorConfiguration;
  refreshConfiguration(): Promise<MonitorConfiguration>;

  // Window placement logic
  findBestMonitorForWindow(savedState: WindowState): MonitorInfo;
  calculateWindowBounds(windowState: WindowState, targetMonitor: MonitorInfo): Rectangle;

  // Monitor configuration analysis
  isMonitorConfigurationChanged(saved: MonitorConfiguration): boolean;
  findMonitorById(id: number): MonitorInfo | null;
  getPrimaryMonitor(): MonitorInfo;

  // Utility methods
  ensureWindowVisible(bounds: Rectangle): Rectangle;
  calculateRelativePosition(
    bounds: Rectangle,
    monitor: MonitorInfo
  ): { percentX: number; percentY: number; percentWidth: number; percentHeight: number };
}

/**
 * Window state information
 */
export interface WindowInfo {
  id: number;
  websiteName?: string;
  type: 'main' | 'website' | 'settings';
  bounds?: { x: number; y: number; width: number; height: number };
  isMaximized?: boolean;
}

/**
 * Window management service interface
 */
export interface IWindowManager extends IDisposable {
  // Window operations
  createMainWindow(): Promise<BrowserWindow>;
  createWebsiteWindow(websiteName: string): Promise<BrowserWindow>;
  createSettingsWindow(): Promise<BrowserWindow>;

  // Window queries
  getWindow(id: number): BrowserWindow | undefined;
  getWebsiteWindow(websiteName: string): BrowserWindow | undefined;
  getAllWindows(): BrowserWindow[];
  getAllWebsiteWindows(): BrowserWindow[];

  // Window state
  saveWindowState(window: BrowserWindow): void;
  restoreWindowState(window: BrowserWindow, websiteName?: string): void;

  // Window lifecycle
  closeWindow(id: number): void;
  closeAllWindows(): void;
  focusWindow(id: number): void;
}

/**
 * File system operations interface
 */
export interface IFileSystem {
  // File operations
  exists(path: string): Promise<boolean>;
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(path: string, data: string | Buffer, encoding?: BufferEncoding): Promise<void>;

  // Directory operations
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  // Path operations
  copyFile(src: string, dest: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number; mtime: Date }>;
}

/**
 * Atomic operations service interface
 */
export interface IAtomicOperations {
  // Atomic file operations
  writeFileAtomic(
    path: string,
    data: string | Buffer,
    options?: Record<string, unknown>
  ): Promise<AtomicOperationResult<void>>;
  copyDirectoryAtomic(
    src: string,
    dest: string,
    options?: Record<string, unknown>
  ): Promise<AtomicOperationResult<void>>;
  renameAtomic(
    oldPath: string,
    newPath: string,
    options?: Record<string, unknown>
  ): Promise<AtomicOperationResult<void>>;

  // Transaction support
  createTransaction(): IAtomicTransaction;
}

/**
 * Interface for managing atomic transactions with rollback capability.
 */
export interface IAtomicTransaction {
  addOperation(operation: () => Promise<void>, rollback?: () => Promise<void>): void;
  execute<T = void>(): Promise<AtomicOperationResult<T>>;
  rollback(): Promise<boolean>;
}

/**
 * Event emitter interface for services that emit events
 */
export interface IEventEmitter<T = unknown> {
  on(event: string, listener: (data: T) => void): void;
  off(event: string, listener: (data: T) => void): void;
  emit(event: string, data?: T): void;
  once(event: string, listener: (data: T) => void): void;
}

/**
 * Result of a service health check including status and details.
 */
export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Health monitoring service interface
 */
export interface IHealthMonitor extends IDisposable, IEventEmitter<HealthCheckResult> {
  // Health checks
  checkHealth(serviceName: string): Promise<HealthCheckResult>;
  checkAllServices(): Promise<HealthCheckResult[]>;

  // Health monitoring
  startMonitoring(intervalMs?: number): void;
  stopMonitoring(): void;

  // Health status
  getHealthStatus(serviceName: string): HealthCheckResult | undefined;
  getAllHealthStatuses(): HealthCheckResult[];
  isHealthy(serviceName: string): boolean;
}

/**
 * Service factory interface for creating services
 */
export interface IServiceFactory {
  createStore(): IStore;
  createWebsiteManager(): IWebsiteManager;
  createWebsiteServerManager(): IWebsiteServerManager;
  createDnsManager(): IDnsManager;
  createCertificateManager(): ICertificateManager;
  createMenuManager(): IMenuManager;
  createWindowManager(): IWindowManager;
  createLogger(context?: string): ILogger;
  createFileSystem(): IFileSystem;
  createAtomicOperations(): IAtomicOperations;
  createHealthMonitor(): IHealthMonitor;
}

/**
 * Application context interface
 */
export interface IApplicationContext extends IDisposable {
  // Service access
  getService<T>(serviceName: string): T;
  getServiceAsync<T>(serviceName: string): Promise<T>;

  // Application lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Configuration
  isProduction(): boolean;
  isDevelopment(): boolean;
  getVersion(): string;
  getAppDataPath(): string;
}

/**
 * Plugin interface for extensibility
 */
export interface IPlugin extends IDisposable {
  name: string;
  version: string;
  dependencies?: string[];

  initialize(context: IApplicationContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

/**
 * Plugin manager interface
 */
export interface IPluginManager extends IDisposable {
  // Plugin lifecycle
  loadPlugin(plugin: IPlugin): Promise<void>;
  unloadPlugin(name: string): Promise<void>;

  // Plugin queries
  getPlugin(name: string): IPlugin | undefined;
  getAllPlugins(): IPlugin[];
  isPluginLoaded(name: string): boolean;

  // Plugin management
  activatePlugin(name: string): Promise<void>;
  deactivatePlugin(name: string): Promise<void>;
  reloadPlugin(name: string): Promise<void>;
}

/**
 * Type guards for interface checking
 */
export const TypeGuards = {
  isDisposable(obj: unknown): obj is IDisposable {
    return obj !== null && typeof obj === 'object' && typeof (obj as IDisposable).dispose === 'function';
  },

  isInitializable(obj: unknown): obj is IInitializable {
    return obj !== null && typeof obj === 'object' && typeof (obj as IInitializable).initialize === 'function';
  },

  isEventEmitter(obj: unknown): obj is IEventEmitter {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      typeof (obj as IEventEmitter).on === 'function' &&
      typeof (obj as IEventEmitter).emit === 'function'
    );
  },
};

/**
 * Service lifecycle states
 */
export enum ServiceLifecycleState {
  NotInitialized = 'not-initialized',
  Initializing = 'initializing',
  Initialized = 'initialized',
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Error = 'error',
  Disposed = 'disposed',
}

/**
 * Service metadata interface
 */
export interface IServiceMetadata {
  name: string;
  version?: string;
  description?: string;
  dependencies: string[];
  state: ServiceLifecycleState;
  createdAt: Date;
  lastStateChange: Date;
  error?: Error;
}

/**
 * Service with metadata interface
 */
export interface IServiceWithMetadata<T = unknown> {
  service: T;
  metadata: IServiceMetadata;
}
