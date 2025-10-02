/**
 * @file Website Orchestrator - Central Management Layer
 *
 * Implements the "Node.js 11ty Website Manager" layer from the architecture diagram.
 * This service orchestrates all website lifecycle operations and maintains strict
 * layer boundaries: GUI ↔ Orchestrator ↔ Individual Websites
 */

import {
  IWebsiteOrchestrator,
  IsolatedWebsiteInstance,
  LayerCommunicationBus,
  createLayerCommunicationBus,
} from '../core/layer-boundaries';
import { ILogger, IFileSystem, IWebsiteManager } from '../core/interfaces';
import {
  startWebsiteServer,
  stopWebsiteServer,
  setServerLogCallback,
  WebsiteServer,
} from '../server/per-website-server';

/**
 * Wrapper that adapts WebsiteServer to IsolatedWebsiteInstance interface
 */
class WebsiteInstanceAdapter implements IsolatedWebsiteInstance {
  constructor(
    public readonly websiteName: string,
    private readonly server: WebsiteServer,
    private readonly logger: ILogger
  ) {}

  get port(): number {
    return this.server.port;
  }

  get url(): string {
    return this.server.actualUrl || `http://localhost:${this.server.port}`;
  }

  get rootPath(): string {
    // Server inputDir points to /src, so go up one level for root
    return this.server.inputDir.replace(/\/src$/, '');
  }

  get sourcePath(): string {
    return this.server.inputDir;
  }

  get outputPath(): string {
    return this.server.outputDir;
  }

  get isHealthy(): boolean {
    return this.server.devServer !== null && this.server.eleventy !== null;
  }

  get lastBuildTime(): number | undefined {
    return this.server.enhancedWatcher?.getMetrics().averageRebuildTime;
  }

  async rebuild(): Promise<void> {
    if (!this.server.eleventy) {
      throw new Error(`Cannot rebuild ${this.websiteName}: eleventy instance not available`);
    }
    await this.server.eleventy.write();
  }

  async resolveFileToUrl(filePath: string): Promise<string | null> {
    return this.server.urlResolver.getUrlForFile(filePath);
  }

  async shutdown(): Promise<void> {
    await stopWebsiteServer(this.server);
  }
}

/**
 * Website Orchestrator - Central management service for all websites
 */
export class WebsiteOrchestrator implements IWebsiteOrchestrator {
  private readonly logger: ILogger;
  private readonly runningInstances = new Map<string, WebsiteInstanceAdapter>();
  private readonly communicationBus: LayerCommunicationBus;
  private nextPort = 3000;

  constructor(
    logger: ILogger,
    private readonly websiteManager: IWebsiteManager,
    private readonly fileSystem: IFileSystem
  ) {
    this.logger = logger.child({ service: 'WebsiteOrchestrator' });
    this.communicationBus = createLayerCommunicationBus(this.logger);

    // Set up log callback to forward server logs through the communication bus
    // This removes the direct UI dependency from the server layer
    setServerLogCallback((websiteName, message, level) => {
      this.communicationBus.publishToGUI(
        'website:log',
        websiteName,
        message,
        level as 'info' | 'warn' | 'error' | 'debug'
      );
    });
  }

  /**
   * Get the communication bus for GUI layer integration
   */
  getCommunicationBus(): LayerCommunicationBus {
    return this.communicationBus;
  }

  async createWebsite(websiteName: string): Promise<IsolatedWebsiteInstance> {
    this.logger.info('Creating new website', { websiteName });

    // Validate name first
    const validation = this.validateWebsiteName(websiteName);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid website name');
    }

    // Create the website using the website manager
    const websitePath = await this.websiteManager.createWebsite(websiteName);

    this.logger.info('Website created successfully', { websiteName, path: websitePath });

    // Publish event to GUI layer
    this.communicationBus.publishToGUI('website:created', websiteName, websitePath);

    // Start the server and return the instance
    return this.startWebsiteServer(websiteName);
  }

  async startWebsiteServer(websiteName: string): Promise<IsolatedWebsiteInstance> {
    this.logger.info('Starting website server', { websiteName });

    // Check if already running
    if (this.runningInstances.has(websiteName)) {
      this.logger.warn('Website server already running', { websiteName });
      return this.runningInstances.get(websiteName)!;
    }

    // Get website path
    const websitePath = this.websiteManager.getWebsitePath(websiteName);

    // Verify website exists
    if (!(await this.fileSystem.exists(websitePath))) {
      throw new Error(`Website "${websiteName}" does not exist`);
    }

    // Allocate port
    const port = this.allocatePort();

    try {
      // Start the isolated server instance
      const server = await startWebsiteServer(websitePath, websiteName, port);

      // Wrap in adapter
      const instance = new WebsiteInstanceAdapter(websiteName, server, this.logger);

      // Store the running instance
      this.runningInstances.set(websiteName, instance);

      this.logger.info('Website server started', { websiteName, port, url: instance.url });

      // Publish event to GUI layer
      this.communicationBus.publishToGUI('website:started', websiteName, instance);

      return instance;
    } catch (error) {
      this.logger.error('Failed to start website server', error as Error, { websiteName, port });
      this.releasePort(port);
      throw error;
    }
  }

  async stopWebsiteServer(websiteName: string): Promise<void> {
    this.logger.info('Stopping website server', { websiteName });

    const instance = this.runningInstances.get(websiteName);
    if (!instance) {
      this.logger.warn('Website server not running', { websiteName });
      return;
    }

    try {
      // Shutdown the isolated instance
      await instance.shutdown();

      // Release the port
      this.releasePort(instance.port);

      // Remove from running instances
      this.runningInstances.delete(websiteName);

      this.logger.info('Website server stopped', { websiteName });

      // Publish event to GUI layer
      this.communicationBus.publishToGUI('website:stopped', websiteName);
    } catch (error) {
      this.logger.error('Error stopping website server', error as Error, { websiteName });
      throw error;
    }
  }

  getWebsiteInstance(websiteName: string): IsolatedWebsiteInstance | null {
    return this.runningInstances.get(websiteName) || null;
  }

  async listAllWebsites(): Promise<string[]> {
    return this.websiteManager.listWebsites();
  }

  listRunningWebsites(): string[] {
    return Array.from(this.runningInstances.keys());
  }

  async deleteWebsite(websiteName: string): Promise<boolean> {
    this.logger.info('Deleting website', { websiteName });

    // Stop the server if running
    if (this.runningInstances.has(websiteName)) {
      await this.stopWebsiteServer(websiteName);
    }

    // Delete using website manager
    const deleted = await this.websiteManager.deleteWebsite(websiteName);

    if (deleted) {
      this.logger.info('Website deleted', { websiteName });
      this.communicationBus.publishToGUI('website:deleted', websiteName);
    }

    return deleted;
  }

  async renameWebsite(oldName: string, newName: string): Promise<boolean> {
    this.logger.info('Renaming website', { oldName, newName });

    // Stop the server if running
    const wasRunning = this.runningInstances.has(oldName);
    if (wasRunning) {
      await this.stopWebsiteServer(oldName);
    }

    // Rename using website manager
    const renamed = await this.websiteManager.renameWebsite(oldName, newName);

    if (renamed) {
      this.logger.info('Website renamed', { oldName, newName });
      this.communicationBus.publishToGUI('website:renamed', oldName, newName);

      // Restart if it was running
      if (wasRunning) {
        await this.startWebsiteServer(newName);
      }
    }

    return renamed;
  }

  validateWebsiteName(name: string): { valid: boolean; error?: string } {
    return this.websiteManager.validateWebsiteName(name);
  }

  async shutdownAll(): Promise<void> {
    this.logger.info('Shutting down all website servers');

    const shutdownPromises = Array.from(this.runningInstances.keys()).map((websiteName) =>
      this.stopWebsiteServer(websiteName).catch((error) => {
        this.logger.error('Error stopping website during shutdown', error, { websiteName });
      })
    );

    await Promise.all(shutdownPromises);

    this.logger.info('All website servers shut down');
  }

  /**
   * Port allocation - simple sequential allocation
   */
  private allocatePort(): number {
    // Find first available port
    while (this.isPortInUse(this.nextPort)) {
      this.nextPort++;
    }
    return this.nextPort++;
  }

  private releasePort(port: number): void {
    // In a more sophisticated system, we might track available ports
    // For now, we just let the sequential allocator continue
    this.logger.debug('Port released', { port });
  }

  private isPortInUse(port: number): boolean {
    return Array.from(this.runningInstances.values()).some((instance) => instance.port === port);
  }
}

/**
 * Factory function for creating the orchestrator with DI
 */
export function createWebsiteOrchestrator(
  logger: ILogger,
  websiteManager: IWebsiteManager,
  fileSystem: IFileSystem
): IWebsiteOrchestrator {
  return new WebsiteOrchestrator(logger, websiteManager, fileSystem);
}
