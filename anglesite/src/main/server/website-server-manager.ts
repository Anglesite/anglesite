/**
 * @file DI-compatible Centralized Website Server Management
 *
 * Refactored version that implements IWebsiteServerManager interface and uses
 * dependency injection for better testability and maintainability.
 *
 * Features:
 * - Centralized server lifecycle management
 * - Port management and conflict resolution
 * - State tracking and persistence
 * - Graceful cleanup and shutdown
 * - Event-driven architecture with logging
 * - Error handling and recovery
 */
import * as path from 'path';
import * as net from 'net';
import { EventEmitter } from 'events';
import { WebsiteServer, startWebsiteServer as createWebsiteServer, stopWebsiteServer } from './per-website-server';
import { IWebsiteServerManager, ILogger, IFileSystem, WebsiteServerInfo } from '../core/interfaces';

/**
 * Server state enumeration for tracking server lifecycle
 */
export enum ServerState {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  ERROR = 'error',
}

/**
 * Server information interface for tracking managed servers
 */
export interface ManagedServer {
  websiteName: string;
  websitePath: string;
  port: number;
  actualUrl?: string;
  state: ServerState;
  server?: WebsiteServer;
  startedAt?: Date;
  lastError?: Error;
  retryCount: number;
}

/**
 * Server manager events for observing server lifecycle
 */
export interface ServerManagerEvents {
  'server-starting': (websiteName: string) => void;
  'server-started': (websiteName: string, server: ManagedServer) => void;
  'server-stopping': (websiteName: string) => void;
  'server-stopped': (websiteName: string) => void;
  'server-error': (websiteName: string, error: Error) => void;
  'server-log': (websiteName: string, message: string, level: string) => void;
  'port-allocated': (websiteName: string, port: number) => void;
  'port-released': (websiteName: string, port: number) => void;
}

/**
 * Configuration options for the server manager
 */
export interface ServerManagerConfig {
  /** Starting port for automatic port allocation */
  startPort: number;
  /** Maximum number of retry attempts for server start failures */
  maxRetries: number;
  /** Timeout in milliseconds for server startup */
  startupTimeout: number;
  /** Grace period in milliseconds for server shutdown */
  shutdownTimeout: number;
  /** Enable detailed logging */
  enableLogging: boolean;
}

/**
 * Default configuration for the server manager
 */
const DEFAULT_CONFIG: ServerManagerConfig = {
  startPort: 8081,
  maxRetries: 3,
  startupTimeout: 30000, // 30 seconds
  shutdownTimeout: 10000, // 10 seconds
  enableLogging: true,
};

/**
 * DI-compatible WebsiteServerManager class
 *
 * Provides comprehensive server management capabilities for website development servers
 * including lifecycle management, port allocation, state tracking, and cleanup.
 */
export class WebsiteServerManager extends EventEmitter implements IWebsiteServerManager {
  private servers = new Map<string, ManagedServer>();
  private allocatedPorts = new Set<number>();
  private config: ServerManagerConfig;
  private isShuttingDown = false;
  private readonly logger: ILogger;

  constructor(
    logger: ILogger,
    private readonly fileSystem: IFileSystem,
    config: Partial<ServerManagerConfig> = {}
  ) {
    super();
    this.logger = logger.child({ service: 'WebsiteServerManager' });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupGracefulShutdown();
  }

  /**
   * Static factory method for DI container integration.
   */
  static create(
    logger: ILogger,
    fileSystem: IFileSystem,
    config: Partial<ServerManagerConfig> = {}
  ): WebsiteServerManager {
    return new WebsiteServerManager(logger, fileSystem, config);
  }

  /**
   * Start a website server for the specified website (DI interface compatibility).
   * @param websiteName Unique identifier for the website to process
   * @param websitePath File system path to the website directory
   * @returns Promise resolving to the website server info
   */
  async startServer(websiteName: string, websitePath: string): Promise<WebsiteServerInfo> {
    const managedServer = await this.startServerWithPath(websiteName, websitePath);
    return this.convertToWebsiteServerInfo(managedServer);
  }

  /**
   * Start a website server for the specified website with explicit path.
   * @param websiteName Unique identifier for the website to process
   * @param websitePath File system path to the website directory
   * @returns Promise resolving to the managed server info
   */
  async startServerWithPath(websiteName: string, websitePath: string): Promise<ManagedServer> {
    if (this.isShuttingDown) {
      throw new Error('Server manager is shutting down');
    }

    // Check if server already exists
    const existingServer = this.servers.get(websiteName);
    if (existingServer) {
      if (existingServer.state === ServerState.RUNNING) {
        this.log(websiteName, `Server already running at ${existingServer.actualUrl}`, 'info');
        return existingServer;
      }

      if (existingServer.state === ServerState.STARTING) {
        throw new Error(`Server for ${websiteName} is already starting`);
      }

      // Stop existing server if in error state
      if (existingServer.state === ServerState.ERROR) {
        await this.stopServer(websiteName);
      }
    }

    // Validate website path
    if (!(await this.validateWebsitePath(websitePath))) {
      throw new Error(`Invalid website path: ${websitePath}`);
    }

    // Allocate port
    const port = await this.allocatePort();

    // Create managed server entry
    const managedServer: ManagedServer = {
      websiteName,
      websitePath,
      port,
      state: ServerState.STARTING,
      retryCount: 0,
      startedAt: new Date(),
    };

    this.servers.set(websiteName, managedServer);
    this.allocatedPorts.add(port);

    this.emit('server-starting', websiteName);
    this.emit('port-allocated', websiteName, port);
    this.log(websiteName, `Starting server on port ${port}`, 'info');

    // Try to start the server with retries
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Start the actual server with timeout
        const server = await this.startWithTimeout(websitePath, websiteName, port);

        // Update managed server with success info
        managedServer.server = server;
        managedServer.state = ServerState.RUNNING;
        managedServer.actualUrl = server.actualUrl || `http://localhost:${server.port}`;
        managedServer.lastError = undefined;

        this.emit('server-started', websiteName, managedServer);
        this.log(
          websiteName,
          `Server started successfully at ${managedServer.actualUrl}${attempt > 0 ? ` after ${attempt} retries` : ''}`,
          'info'
        );

        return managedServer;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        managedServer.retryCount = attempt;

        // Update state to error and emit error (but don't release port yet if retrying)
        managedServer.state = ServerState.ERROR;
        managedServer.lastError = lastError;

        this.emit('server-error', websiteName, lastError);
        this.log(
          websiteName,
          `Failed to start server (attempt ${attempt + 1}/${this.config.maxRetries + 1}): ${lastError.message}`,
          'error'
        );

        // If we have more attempts left, retry with backoff
        if (attempt < this.config.maxRetries) {
          this.log(websiteName, `Retrying server start in ${Math.pow(2, attempt)}s...`, 'warning');
          await this.delay(1000 * Math.pow(2, attempt));
          managedServer.state = ServerState.STARTING;
        }
      }
    }

    // All attempts failed - clean up and throw
    this.allocatedPorts.delete(port);
    this.emit('port-released', websiteName, port);

    if (lastError) {
      throw lastError;
    } else {
      throw new Error('Server start failed for unknown reason');
    }
  }

  /**
   * Stop a website server.
   * @param websiteName Unique identifier for the website server to stop
   * @returns Promise that resolves when server is stopped
   */
  async stopServer(websiteName: string): Promise<void> {
    const managedServer = this.servers.get(websiteName);
    if (!managedServer) {
      this.log(websiteName, 'No server found to stop', 'warning');
      return;
    }

    if (managedServer.state === ServerState.STOPPED) {
      this.log(websiteName, 'Server already stopped', 'info');
      return;
    }

    if (managedServer.state === ServerState.STOPPING) {
      this.log(websiteName, 'Server already stopping', 'info');
      return;
    }

    managedServer.state = ServerState.STOPPING;
    this.emit('server-stopping', websiteName);
    this.log(websiteName, 'Stopping server', 'info');

    try {
      if (managedServer.server) {
        await this.stopWithTimeout(managedServer.server);
      }

      // Clean up resources
      this.allocatedPorts.delete(managedServer.port);
      managedServer.state = ServerState.STOPPED;
      managedServer.server = undefined;

      this.emit('server-stopped', websiteName);
      this.emit('port-released', websiteName, managedServer.port);
      this.log(websiteName, 'Server stopped successfully', 'info');
    } catch (error) {
      const serverError = error instanceof Error ? error : new Error(String(error));
      managedServer.state = ServerState.ERROR;
      managedServer.lastError = serverError;

      this.emit('server-error', websiteName, serverError);
      this.log(websiteName, `Error stopping server: ${serverError.message}`, 'error');

      // Still clean up resources even on error
      this.allocatedPorts.delete(managedServer.port);
      managedServer.server = undefined;
    }
  }

  /**
   * Restart a website server (DI interface compatibility).
   * @param websiteName Unique identifier for the website server to restart
   * @returns Promise resolving to the website server info
   */
  async restartServer(websiteName: string): Promise<WebsiteServerInfo> {
    const managedServer = this.servers.get(websiteName);
    if (!managedServer) {
      throw new Error(`No server found for website: ${websiteName}`);
    }

    this.log(websiteName, 'Restarting server', 'info');

    await this.stopServer(websiteName);
    const restarted = await this.startServerWithPath(websiteName, managedServer.websitePath);
    return this.convertToWebsiteServerInfo(restarted);
  }

  /**
   * Get server information for a specific website (DI interface compatibility).
   * @param websiteName Unique identifier for the website to query
   * @returns Website server info or undefined if not found
   */
  getServerInfo(websiteName: string): WebsiteServerInfo | undefined {
    const managedServer = this.servers.get(websiteName);
    return managedServer ? this.convertToWebsiteServerInfo(managedServer) : undefined;
  }

  /**
   * Get server information for a specific website (legacy method).
   * @param websiteName Unique identifier for the website to query
   * @returns Managed server info or undefined if not found
   */
  getServer(websiteName: string): ManagedServer | undefined {
    return this.servers.get(websiteName);
  }

  /**
   * Get all currently managed servers (DI interface compatibility).
   * @returns ReadonlyMap of website names to managed server info
   */
  getAllServers(): ReadonlyMap<string, ManagedServer> {
    return new Map(this.servers);
  }

  /**
   * Get all currently managed servers (legacy method).
   * @returns Map of website names to managed server info
   */
  getAllManagedServers(): ReadonlyMap<string, ManagedServer> {
    return new Map(this.servers);
  }

  /**
   * Filter and retrieve servers that match a specific operational state.
   * @param state The specific server state to filter managed servers by
   * @returns Array of managed servers in the specified state
   */
  getServersByState(state: ServerState): ManagedServer[] {
    return Array.from(this.servers.values()).filter((server) => server.state === state);
  }

  /**
   * Count the total number of servers currently in running state.
   * @returns Number of currently running servers
   */
  getRunningServersCount(): number {
    return this.getServersByState(ServerState.RUNNING).length;
  }

  /**
   * Check if a server is running for a website.
   * @param websiteName Unique identifier for the website to check status for
   * @returns True if server is running, false otherwise
   */
  isServerRunning(websiteName: string): boolean {
    const server = this.servers.get(websiteName);
    return server?.state === ServerState.RUNNING || false;
  }

  /**
   * Stop all servers and clean up resources.
   * @returns Promise that resolves when all servers are stopped
   */
  async stopAllServers(): Promise<void> {
    this.isShuttingDown = true;
    this.log('manager', 'Stopping all servers', 'info');

    const stopPromises = Array.from(this.servers.keys()).map((websiteName) =>
      this.stopServer(websiteName).catch((error) => {
        this.log(websiteName, `Error during shutdown: ${error.message}`, 'error');
      })
    );

    await Promise.all(stopPromises);

    this.servers.clear();
    this.allocatedPorts.clear();
    this.log('manager', 'All servers stopped', 'info');
  }

  /**
   * Compile comprehensive operational metrics and performance statistics for all managed servers.
   * @returns Comprehensive statistics object with server counts, ports, and uptime data
   */
  getStatistics(): {
    totalServers: number;
    runningServers: number;
    stoppedServers: number;
    errorServers: number;
    allocatedPorts: number[];
    uptime: { [websiteName: string]: number };
  } {
    const servers = Array.from(this.servers.values());
    const now = new Date();

    return {
      totalServers: servers.length,
      runningServers: this.getServersByState(ServerState.RUNNING).length,
      stoppedServers: this.getServersByState(ServerState.STOPPED).length,
      errorServers: this.getServersByState(ServerState.ERROR).length,
      allocatedPorts: Array.from(this.allocatedPorts).sort(),
      uptime: servers.reduce(
        (acc, server) => {
          if (server.startedAt && server.state === ServerState.RUNNING) {
            acc[server.websiteName] = now.getTime() - server.startedAt.getTime();
          }
          return acc;
        },
        {} as { [websiteName: string]: number }
      ),
    };
  }

  /**
   * Find an available port starting from the configured start port.
   * @returns Promise resolving to an available port number
   */
  private async allocatePort(): Promise<number> {
    let port = this.config.startPort;

    while (this.allocatedPorts.has(port) || !(await this.isPortAvailable(port))) {
      port++;
      // Prevent infinite loop by limiting port range
      if (port > this.config.startPort + 1000) {
        throw new Error('No available ports found in range');
      }
    }

    return port;
  }

  /**
   * Check if a port is available for use.
   * @param port Network port number to check for availability
   * @returns Promise resolving to true if port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  }

  /**
   * Validate that a website path exists and contains required files.
   * @param websitePath Path to validate
   * @returns Promise resolving to true if path is valid
   */
  private async validateWebsitePath(websitePath: string): Promise<boolean> {
    try {
      // Check if main directory exists
      if (!(await this.fileSystem.exists(websitePath))) {
        return false;
      }

      // Check if src directory exists (required for Anglesite websites)
      const srcPath = path.join(websitePath, 'src');
      if (!(await this.fileSystem.exists(srcPath))) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start a website server with timeout.
   * @param websitePath Path to the website directory
   * @param websiteName Unique identifier for the website to start
   * @param port Port to use for the server
   * @returns Promise resolving to the website server
   */
  private async startWithTimeout(websitePath: string, websiteName: string, port: number): Promise<WebsiteServer> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server startup timed out after ${this.config.startupTimeout}ms`));
      }, this.config.startupTimeout);

      createWebsiteServer(websitePath, websiteName, port)
        .then((server) => {
          clearTimeout(timeout);
          resolve(server);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Stop a website server with timeout.
   * @param server WebsiteServer instance to gracefully shutdown
   * @returns Promise that resolves when server is stopped
   */
  private async stopWithTimeout(server: WebsiteServer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server shutdown timed out after ${this.config.shutdownTimeout}ms`));
      }, this.config.shutdownTimeout);

      stopWebsiteServer(server)
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Delay utility for retry logic.
   * @param ms Milliseconds to delay
   * @returns Promise that resolves after the delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Log messages with injected logger and emit events.
   * @param websiteName Website name or 'manager' for manager logs
   * @param message Log message content
   * @param level Log level (info, warning, error)
   */
  private log(websiteName: string, message: string, level: string = 'info'): void {
    if (!this.config.enableLogging) return;

    const meta = { websiteName };

    // Log with injected logger based on level
    switch (level) {
      case 'error':
        this.logger.error(message, undefined, meta);
        break;
      case 'warn':
      case 'warning':
        this.logger.warn(message, meta);
        break;
      case 'debug':
        this.logger.debug(message, meta);
        break;
      default:
        this.logger.info(message, meta);
    }

    // Emit log event for external subscribers
    this.emit('server-log', websiteName, message, level);
  }

  /**
   * Clean up orphaned servers (DI interface compatibility).
   * @returns Promise that resolves when cleanup is complete
   */
  async cleanupOrphanedServers(): Promise<void> {
    this.logger.info('Cleaning up orphaned servers');
    // For now, just stop servers in error state
    const errorServers = this.getServersByState(ServerState.ERROR);
    for (const server of errorServers) {
      try {
        await this.stopServer(server.websiteName);
      } catch (error) {
        this.logger.warn('Failed to cleanup orphaned server', { websiteName: server.websiteName, error });
      }
    }
  }

  /**
   * Convert ManagedServer to WebsiteServerInfo for interface compatibility.
   */
  private convertToWebsiteServerInfo(managedServer: ManagedServer): WebsiteServerInfo {
    return {
      name: managedServer.websiteName,
      port: managedServer.port,
      status: this.convertServerState(managedServer.state),
      url: managedServer.actualUrl,
      error: managedServer.lastError?.message,
      pid: undefined, // TODO: Add PID tracking to WebsiteServer interface
    };
  }

  /**
   * Convert ServerState to the interface-expected status.
   */
  private convertServerState(state: ServerState): 'starting' | 'running' | 'stopping' | 'stopped' | 'error' {
    switch (state) {
      case ServerState.STARTING:
        return 'starting';
      case ServerState.RUNNING:
        return 'running';
      case ServerState.STOPPING:
        return 'stopping';
      case ServerState.STOPPED:
        return 'stopped';
      case ServerState.ERROR:
        return 'error';
      default:
        return 'stopped';
    }
  }

  /**
   * Dispose of the server manager service.
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing WebsiteServerManager service');
    await this.stopAllServers();
  }

  /**
   * Set up graceful shutdown handlers.
   * Note: Only set up process handlers for the singleton instance.
   */
  private setupGracefulShutdown(): void {
    // Only set up process handlers if this is likely the singleton instance
    // (to avoid memory leaks in tests)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (this === (globalThis as any).__anglesiteServerManager) {
      const signals = ['SIGTERM', 'SIGINT', 'SIGQUIT'] as const;

      signals.forEach((signal) => {
        process.on(signal, async () => {
          this.log('manager', `Received ${signal}, shutting down gracefully`, 'info');
          try {
            await this.stopAllServers();
            process.exit(0);
          } catch (error) {
            this.log('manager', `Error during graceful shutdown: ${error}`, 'error');
            process.exit(1);
          }
        });
      });

      // Handle uncaught exceptions
      process.on('uncaughtException', (error) => {
        this.log('manager', `Uncaught exception: ${error.message}`, 'error');
        this.stopAllServers().finally(() => process.exit(1));
      });

      process.on('unhandledRejection', (reason) => {
        this.log('manager', `Unhandled rejection: ${reason}`, 'error');
        this.stopAllServers().finally(() => process.exit(1));
      });
    }
  }
}

/**
 * Factory function for creating WebsiteServerManager with proper dependencies.
 */
export function createWebsiteServerManager(
  logger: ILogger,
  fileSystem: IFileSystem,
  config: Partial<ServerManagerConfig> = {}
): IWebsiteServerManager {
  return WebsiteServerManager.create(logger, fileSystem, config);
}

/**
 * Type guard to check if an object is a website server manager.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isWebsiteServerManager(obj: any): obj is WebsiteServerManager {
  return (
    obj &&
    typeof obj.startServer === 'function' &&
    typeof obj.stopServer === 'function' &&
    typeof obj.getAllServers === 'function' &&
    typeof obj.dispose === 'function'
  );
}

/**
 * @deprecated Legacy singleton export for backward compatibility during transition period
 * Use DI container instead
 */
export const websiteServerManager = {
  startServer: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
  stopServer: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
  getAllServers: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
  getServer: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
  stopAllServers: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
  dispose: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
  on: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
  emit: (): never => {
    throw new Error('websiteServerManager is deprecated. Use DI container instead.');
  },
};
