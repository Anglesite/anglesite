/**
 * @file Service Registry and Factory System
 *
 * Provides centralized service registration, factory patterns, and lifecycle.
 * management for all Anglesite services. Integrates with the DI container
 * to provide a clean, testable architecture.
 */

import { DIContainer, ServiceKeys, container } from './container';
import { SystemError, AtomicOperationError, ErrorUtils, withContext, handleError } from './errors';
import { ResilientServiceWrapper, HealthMonitor } from './service-resilience';
import {
  IStore,
  IWebsiteManager,
  IWebsiteServerManager,
  IDnsManager,
  ICertificateManager,
  IMenuManager,
  IWindowManager,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  IMonitorManager,
  ILogger,
  IFileSystem,
  IAtomicOperations,
  IHealthMonitor,
  IApplicationContext,
  IServiceFactory,
  ServiceLifecycleState,
  IServiceMetadata,
  TypeGuards,
  IGitHistoryManager,
} from './interfaces';

// Store class removed - now using DI with StoreService
import { createStoreService } from './store-service';
import { createWebsiteManager } from '../utils/website-manager';
import { createWebsiteServerManager } from '../server/website-server-manager';
import { createWebsiteBundler } from '../utils/website-bundler';
import { EventEmitter } from 'events';
import { app } from 'electron';
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

/**
 * Enhanced logger implementation.
 */
export class Logger implements ILogger {
  private isTestEnvironment: boolean;

  constructor(
    private context: string = 'app',
    private parentContext?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  ) {
    // Detect test environment - same logic as build-logger.ts
    this.isTestEnvironment =
      process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined || typeof jest !== 'undefined';
  }

  // prettier-ignore
  debug(message: string, meta?: Record<string, any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.log('debug', message, meta);
  }

  // prettier-ignore
  info(message: string, meta?: Record<string, any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.log('info', message, meta);
  }

  // prettier-ignore
  warn(message: string, meta?: Record<string, any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.log('warn', message, meta);
  }

  // prettier-ignore
  error(message: string, error?: Error, meta?: Record<string, any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    const errorMeta = error ? { error: error.message, stack: error.stack } : {};
    this.log('error', message, { ...errorMeta, ...meta });
  }

  // prettier-ignore
  child(context: Record<string, any>): ILogger { // eslint-disable-line @typescript-eslint/no-explicit-any
    return new Logger(this.context, { ...this.parentContext, ...context });
  }

  private shouldLog(level: string, message?: string): boolean {
    // Suppress info/debug in tests
    if (this.isTestEnvironment && (level === 'debug' || level === 'info')) {
      return false;
    }

    // In test environment, suppress validation error logs as they're typically intentional test cases
    if (this.isTestEnvironment && level === 'error' && message) {
      if (message.includes('validation failed') || message.includes('Setting validation failed')) {
        return false;
      }
    }

    // Always log errors and warnings (except suppressed validation errors above)
    if (level === 'error' || level === 'warn') {
      return true;
    }

    return true;
  }

  // prettier-ignore
  private log(level: string, message: string, meta?: Record<string, any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!this.shouldLog(level, message)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const contextStr = this.parentContext ? JSON.stringify(this.parentContext) : '';
    const metaStr = meta ? JSON.stringify(meta) : '';

    const logLine = `[${timestamp}] ${level.toUpperCase()} [${this.context}] ${message}`;

    if (level === 'error') {
      console.error(logLine, contextStr, metaStr);
    } else if (level === 'warn') {
      console.warn(logLine, contextStr, metaStr);
    } else if (level === 'debug') {
      console.debug(logLine, contextStr, metaStr);
    } else {
      console.log(logLine, contextStr, metaStr);
    }
  }
}

/**
 * File system abstraction for testing and consistency.
 */
export class FileSystemService implements IFileSystem {
  async exists(path: string): Promise<boolean> {
    try {
      const fs = await import('fs');
      await fs.promises.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const fs = await import('fs');
    return fs.promises.readFile(path, encoding);
  }

  async writeFile(path: string, data: string | Buffer, encoding?: BufferEncoding): Promise<void> {
    const fs = await import('fs');
    return fs.promises.writeFile(path, data, encoding);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import('fs');
    await fs.promises.mkdir(path, options);
  }

  async readdir(path: string): Promise<string[]> {
    const fs = await import('fs');
    return fs.promises.readdir(path);
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import('fs');
    await fs.promises.rm(path, { recursive: options?.recursive, force: true });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const fs = await import('fs');
    return fs.promises.copyFile(src, dest);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fs = await import('fs');
    return fs.promises.rename(oldPath, newPath);
  }

  async stat(path: string) {
    const fs = await import('fs');
    const stats = await fs.promises.stat(path);
    return {
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
      size: stats.size,
      mtime: stats.mtime,
    };
  }
}

/**
 * Application context providing centralized service access.
 */
export class ApplicationContext extends EventEmitter implements IApplicationContext {
  private isInitialized = false;
  private services = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  private serviceMetadata = new Map<string, IServiceMetadata>();
  private resilientServices = new Map<string, ResilientServiceWrapper<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  private healthMonitor: HealthMonitor;
  private logger: ILogger;

  constructor(private container: DIContainer) {
    super();
    this.logger = new Logger('ApplicationContext');
    this.healthMonitor = new HealthMonitor(this.logger);
    this.setupHealthMonitorEvents();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.logger.info('Initializing application context');

    try {
      await withContext({ operation: 'initializeApplicationContext' }, async () => {
        // Validate all service dependencies
        this.container.validateDependencies();

        // Initialize core services first
        await this.initializeCoreServices();

        // Initialize other services
        await this.initializeServices();

        this.isInitialized = true;
        this.emit('initialized');
        this.logger.info('Application context initialized successfully');
      });
    } catch (error) {
      const wrappedError = ErrorUtils.wrap(error, {
        operation: 'initializeApplicationContext',
      });
      await handleError(wrappedError);
      throw wrappedError;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down application context');

    try {
      // Dispose services in reverse order
      const disposePromises: Promise<void>[] = [];

      for (const [serviceName, service] of this.services) {
        if (TypeGuards.isDisposable(service)) {
          const metadata = this.serviceMetadata.get(serviceName);
          if (metadata) {
            metadata.state = ServiceLifecycleState.Stopping;
            metadata.lastStateChange = new Date();
          }

          disposePromises.push(
            Promise.resolve(service.dispose()).catch((error) => {
              this.logger.error(`Error disposing service ${serviceName}`, error);
            })
          );
        }
      }

      await Promise.all(disposePromises);

      // Dispose container
      await this.container.dispose();

      // Dispose health monitor
      this.healthMonitor.dispose();

      this.services.clear();
      this.serviceMetadata.clear();
      this.resilientServices.clear();
      this.isInitialized = false;

      this.emit('shutdown');
      this.logger.info('Application context shut down successfully');
    } catch (error) {
      this.logger.error('Error during application context shutdown', error as Error);
      throw error;
    }
  }

  getService<T>(serviceName: string): T {
    if (!this.isInitialized) {
      throw new (class ContextNotInitializedError extends SystemError {
        constructor() {
          super('Application context is not initialized', 'CONTEXT_NOT_INITIALIZED');
        }
      })();
    }

    try {
      const service = this.container.resolve<T>(serviceName);
      return service;
    } catch (error) {
      const wrappedError = ErrorUtils.wrap(error, {
        operation: 'getService',
        context: { serviceName },
      });
      this.logger.error(`Failed to resolve service ${serviceName}`, wrappedError);
      throw wrappedError;
    }
  }

  async getServiceAsync<T>(serviceName: string): Promise<T> {
    if (!this.isInitialized) {
      throw new (class ContextNotInitializedError extends SystemError {
        constructor() {
          super('Application context is not initialized', 'CONTEXT_NOT_INITIALIZED');
        }
      })();
    }

    try {
      const service = await this.container.resolveAsync<T>(serviceName);
      return service;
    } catch (error) {
      const wrappedError = ErrorUtils.wrap(error, {
        operation: 'getServiceAsync',
        context: { serviceName },
      });
      this.logger.error(`Failed to resolve service ${serviceName} async`, wrappedError);
      throw wrappedError;
    }
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  isDevelopment(): boolean {
    return !this.isProduction();
  }

  getVersion(): string {
    try {
      return app.getVersion();
    } catch {
      // Fallback for test environments
      return '0.0.0-test';
    }
  }

  getAppDataPath(): string {
    try {
      // Check if app is available before trying to use it
      if (app && typeof app.getPath === 'function') {
        const appPath = app.getPath('userData');
        // Ensure the path is valid (not undefined or empty)
        if (appPath && typeof appPath === 'string' && appPath.trim().length > 0) {
          return appPath;
        }
      }
    } catch {
      // Fall through to fallback logic
    }

    // Fallback for test environments where app may not be available
    const fallbackPath = process.env.ANGLESITE_TEST_DATA || '/tmp/anglesite-test';
    return fallbackPath;
  }

  async dispose(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Setup health monitor event handlers for service state tracking.
   */
  private setupHealthMonitorEvents(): void {
    this.healthMonitor.on('unhealthy', (serviceName: string) => {
      this.logger.warn(`Service ${serviceName} is unhealthy`);
      this.emit('serviceUnhealthy', serviceName);
    });

    this.healthMonitor.on('healthy', (serviceName: string) => {
      this.logger.info(`Service ${serviceName} is healthy`);
      this.emit('serviceHealthy', serviceName);
    });
  }

  /**
   * Get a service wrapped with circuit breaker and retry protection.
   */
  getResilientService<T>(serviceName: string): ResilientServiceWrapper<T> {
    if (!this.isInitialized) {
      throw new (class ContextNotInitializedError extends SystemError {
        constructor() {
          super('Application context is not initialized', 'CONTEXT_NOT_INITIALIZED');
        }
      })();
    }

    const existingWrapper = this.resilientServices.get(serviceName);
    if (existingWrapper) {
      return existingWrapper as ResilientServiceWrapper<T>;
    }

    // Create new resilient wrapper
    const service = this.getService<T>(serviceName);
    const wrapper = new ResilientServiceWrapper(serviceName, service, this.logger.child({ service: serviceName }));

    this.resilientServices.set(serviceName, wrapper);
    return wrapper;
  }

  /**
   * Register a service for automated health monitoring and status tracking.
   */
  registerHealthCheck(serviceName: string, healthCheck: () => Promise<boolean>, checkInterval?: number): void {
    this.healthMonitor.registerService(serviceName, healthCheck, checkInterval);
  }

  /**
   * Get comprehensive health status for all monitored services.
   */
  getServiceHealth(): Map<string, unknown> {
    return this.healthMonitor.getAllHealthStatus();
  }

  /**
   * Get circuit breaker and retry metrics for all resilient services.
   */
  getResilienceMetrics(): Record<string, unknown> {
    const metrics: Record<string, unknown> = {};

    for (const [serviceName, wrapper] of this.resilientServices) {
      metrics[serviceName] = wrapper.getMetrics();
    }

    return metrics;
  }

  private async initializeCoreServices(): Promise<void> {
    // Register core services that other services depend on

    // Logger
    this.container.registerInstance(ServiceKeys.LOGGER, new Logger('app'));

    // File system
    this.container.registerInstance(ServiceKeys.FILE_SYSTEM, new FileSystemService());

    // Configuration/Store - use the new DI-compatible version
    this.container.register(
      ServiceKeys.STORE,
      () => {
        const logger = this.container.resolve<ILogger>(ServiceKeys.LOGGER);
        const fileSystem = this.container.resolve<IFileSystem>(ServiceKeys.FILE_SYSTEM);
        const appDataPath = this.getAppDataPath();
        return createStoreService(logger, fileSystem, undefined, appDataPath);
      },
      'singleton'
    );
  }

  private async initializeServices(): Promise<void> {
    // Initialize services that have been registered
    // For now, just ensure they can be resolved

    const coreServices = [ServiceKeys.STORE, ServiceKeys.LOGGER, ServiceKeys.FILE_SYSTEM, ServiceKeys.MONITOR_MANAGER];

    for (const serviceName of coreServices) {
      try {
        const service = this.container.resolve(serviceName);
        this.services.set(serviceName, service);

        // Create metadata
        this.serviceMetadata.set(serviceName, {
          name: serviceName,
          dependencies: this.container.getServiceDefinition(serviceName)?.dependencies || [],
          state: ServiceLifecycleState.Running,
          createdAt: new Date(),
          lastStateChange: new Date(),
        });

        // Initialize if needed
        if (TypeGuards.isInitializable(service)) {
          await Promise.resolve(service.initialize());
        }

        this.logger.info(`Service ${serviceName} initialized successfully`);
      } catch (error) {
        this.logger.error(`Failed to initialize service ${serviceName}`, error as Error);
        throw error;
      }
    }
  }
}

/**
 * Service factory implementation.
 */
export class ServiceFactory implements IServiceFactory {
  constructor(private logger: ILogger) {}

  createStore(): IStore {
    // Use the new DI-compatible StoreService
    const logger = this.logger.child({ service: 'Store' });
    const fileSystem = new FileSystemService();

    // Get data path with fallback for test environments
    let appDataPath: string;
    try {
      appDataPath = app.getPath('userData');
    } catch {
      appDataPath = process.env.ANGLESITE_TEST_DATA || '/tmp/anglesite-test';
    }

    return createStoreService(logger, fileSystem, undefined, appDataPath);
  }

  createWebsiteManager(): IWebsiteManager {
    // Will be fully implemented when AtomicOperations is refactored for DI
    throw new Error('WebsiteManager not yet fully refactored - waiting for AtomicOperations DI');
  }

  createWebsiteServerManager(): IWebsiteServerManager {
    const logger = this.logger.child({ service: 'WebsiteServerManager' });
    const fileSystem = new FileSystemService();
    return createWebsiteServerManager(logger, fileSystem);
  }

  createDnsManager(): IDnsManager {
    // Will be implemented when we refactor DnsManager
    throw new Error('DnsManager not yet refactored for DI');
  }

  createCertificateManager(): ICertificateManager {
    // Will be implemented when we refactor CertificateManager
    throw new Error('CertificateManager not yet refactored for DI');
  }

  createMenuManager(): IMenuManager {
    // Will be implemented when we refactor MenuManager
    throw new Error('MenuManager not yet refactored for DI');
  }

  createWindowManager(): IWindowManager {
    // Will be implemented when we refactor WindowManager
    throw new Error('WindowManager not yet refactored for DI');
  }

  createLogger(context?: string): ILogger {
    return new Logger(context);
  }

  createFileSystem(): IFileSystem {
    return new FileSystemService();
  }

  createAtomicOperations(): IAtomicOperations {
    // Will be implemented when we refactor AtomicOperations
    throw new Error('AtomicOperations not yet refactored for DI');
  }

  createHealthMonitor(): IHealthMonitor {
    // Will be implemented as needed
    throw new Error('HealthMonitor not yet implemented');
  }
}

/**
 * Create a stub atomic operations service for temporary use.
 */
function createStubAtomicOperations(fileSystem: IFileSystem): IAtomicOperations {
  return {
    writeFileAtomic: (path: string, content: string | Buffer) => {
      // Basic implementation - just write the file
      return fileSystem.writeFile(path, content, 'utf-8').then(
        () => ({
          success: true,
          rollbackPerformed: false,
          temporaryPaths: [],
        }),
        (error) => ({
          success: false,
          error: ErrorUtils.wrap(error) as AtomicOperationError,
          rollbackPerformed: false,
          temporaryPaths: [],
        })
      );
    },
    copyDirectoryAtomic: () => {
      // Basic stub implementation
      const error = new AtomicOperationError(
        'copyDirectoryAtomic not implemented yet',
        'NOT_IMPLEMENTED',
        'copyDirectoryAtomic'
      );
      return Promise.resolve({
        success: false,
        error: error,
        rollbackPerformed: false,
        temporaryPaths: [],
      });
    },
    renameAtomic: (oldPath: string, newPath: string) => {
      // Basic implementation using fileSystem
      return fileSystem.rename(oldPath, newPath).then(
        () => ({
          success: true,
          rollbackPerformed: false,
          temporaryPaths: [],
        }),
        (error) => ({
          success: false,
          error: ErrorUtils.wrap(error) as AtomicOperationError,
          rollbackPerformed: false,
          temporaryPaths: [],
        })
      );
    },
    createTransaction: () => {
      // Basic stub implementation
      throw new AtomicOperationError('createTransaction not implemented yet', 'NOT_IMPLEMENTED', 'createTransaction');
    },
  };
}

/**
 * Service registration helper functions.
 */
export class ServiceRegistrar {
  private static logger = new Logger('ServiceRegistrar');

  /**
   * Register all core Anglesite services with the DI container.
   */
  static registerCoreServices(container: DIContainer): void {
    ServiceRegistrar.logger.info('Registering core services');

    // Core infrastructure
    container.register(ServiceKeys.LOGGER, () => new Logger('app'), 'singleton');
    container.register(ServiceKeys.FILE_SYSTEM, () => new FileSystemService(), 'singleton');

    // Application services - these will be refactored one by one
    container.register(
      ServiceKeys.STORE,
      () => {
        const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
        const fileSystem = container.resolve<IFileSystem>(ServiceKeys.FILE_SYSTEM);
        // Get data path with fallback for test environments
        let appDataPath: string;
        try {
          appDataPath = app.getPath('userData');
        } catch {
          appDataPath = process.env.ANGLESITE_TEST_DATA || '/tmp/anglesite-test';
        }
        return createStoreService(logger, fileSystem, undefined, appDataPath);
      },
      'singleton'
    );

    // Git history manager (needs to be registered before website manager)
    container.register(
      ServiceKeys.GIT_HISTORY_MANAGER,
      () => {
        const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GitHistoryManager } = require('../utils/git-history-manager');
        return new GitHistoryManager(logger);
      },
      'singleton'
    );

    // Website management services
    container.register(
      ServiceKeys.WEBSITE_MANAGER,
      () => {
        const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
        const fileSystem = container.resolve<IFileSystem>(ServiceKeys.FILE_SYSTEM);
        const atomicOps = createStubAtomicOperations(fileSystem);
        const websiteManager = createWebsiteManager(logger, fileSystem, atomicOps);

        // Inject GitHistoryManager if available
        try {
          const gitHistoryManager = container.resolve<IGitHistoryManager>(ServiceKeys.GIT_HISTORY_MANAGER);
          if (websiteManager && 'setGitHistoryManager' in websiteManager) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (websiteManager as any).setGitHistoryManager(gitHistoryManager);
          }
        } catch (error) {
          logger.warn('GitHistoryManager not available', { error });
        }

        return websiteManager;
      },
      'singleton'
    );

    container.register(
      ServiceKeys.WEBSITE_SERVER_MANAGER,
      () => {
        const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
        const fileSystem = container.resolve<IFileSystem>(ServiceKeys.FILE_SYSTEM);
        return createWebsiteServerManager(logger, fileSystem);
      },
      'singleton'
    );

    container.register(
      ServiceKeys.WEBSITE_BUNDLER,
      () => {
        const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
        const fileSystem = container.resolve<IFileSystem>(ServiceKeys.FILE_SYSTEM);
        const websiteManager = container.resolve<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
        return createWebsiteBundler(logger, fileSystem, websiteManager);
      },
      'singleton'
    );

    // Monitor Manager for multi-monitor window state persistence
    container.register(
      ServiceKeys.MONITOR_MANAGER,
      () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { MonitorManager } = require('../services/monitor-manager');
        return new MonitorManager();
      },
      'singleton'
    );

    // Factory
    container.register(
      'serviceFactory',
      () => {
        const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
        return new ServiceFactory(logger);
      },
      'singleton'
    );

    ServiceRegistrar.logger.info('Core services registered successfully');
  }

  /**
   * Register development/testing services.
   */
  static registerDevelopmentServices(): void {
    if (process.env.NODE_ENV !== 'production') {
      ServiceRegistrar.logger.info('Registering development services');

      // Add development-specific services here
      // e.g., mock services, debugging tools, etc.
    }
  }

  /**
   * Register all services for production use.
   */
  static registerAllServices(container: DIContainer): void {
    ServiceRegistrar.registerCoreServices(container);
    ServiceRegistrar.registerDevelopmentServices();

    // Validate all dependencies
    container.validateDependencies();

    ServiceRegistrar.logger.info('All services registered and validated');
  }
}

/**
 * Bootstrap function to set up the entire DI system.
 */
export async function bootstrapServices(): Promise<ApplicationContext> {
  const logger = new Logger('Bootstrap');
  logger.info('Bootstrapping Anglesite services');

  try {
    // Register all services
    ServiceRegistrar.registerAllServices(container);

    // Create application context
    const appContext = new ApplicationContext(container);

    // Initialize the context
    await appContext.initialize();

    logger.info('Services bootstrapped successfully');
    return appContext;
  } catch (error) {
    logger.error('Failed to bootstrap services', error as Error);
    throw error;
  }
}

/**
 * Shutdown function for clean application termination.
 */
export async function shutdownServices(appContext: ApplicationContext): Promise<void> {
  const logger = new Logger('Shutdown');
  logger.info('Shutting down Anglesite services');

  try {
    await appContext.shutdown();
    logger.info('Services shut down successfully');
  } catch (error) {
    logger.error('Failed to shut down services cleanly', error as Error);
    throw error;
  }
}

// Export the global application context for use throughout the app
export let globalAppContext: ApplicationContext | null = null;

/**
 * Initialize the global application context.
 */
export async function initializeGlobalContext(): Promise<ApplicationContext> {
  if (!globalAppContext) {
    globalAppContext = await bootstrapServices();
  }
  return globalAppContext;
}

/**
 * Get the global application context (throws if not initialized).
 */
export function getGlobalContext(): ApplicationContext {
  if (!globalAppContext) {
    throw new Error('Global application context has not been initialized. Call initializeGlobalContext() first.');
  }
  return globalAppContext;
}

/**
 * Shutdown the global application context.
 */
export async function shutdownGlobalContext(): Promise<void> {
  if (globalAppContext) {
    await shutdownServices(globalAppContext);
    globalAppContext = null;
  }
}
