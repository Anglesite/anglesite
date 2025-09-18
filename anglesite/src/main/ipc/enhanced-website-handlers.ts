/**
 * @file Enhanced Website IPC Handlers with Comprehensive Error Handling
 *
 * Example implementation showing how to integrate the new resilience frameworks
 * into existing IPC handlers for robust error handling and validation.
 */

// Enhanced website handlers implementation
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';
import { IWebsiteManager, IStore } from '../core/interfaces';
import {
  IPCResilienceManager,
  CommonValidationSchemas,
  createStandardIPCHandler,
  createFileOperationIPCHandler,
} from './ipc-resilience';
import { Logger } from '../core/service-registry';

/**
 * Enhanced website handlers with resilience features
 */
export class EnhancedWebsiteHandlers {
  private ipcManager: IPCResilienceManager;
  private logger = new Logger('EnhancedWebsiteHandlers');

  constructor() {
    this.ipcManager = new IPCResilienceManager(this.logger);
    this.setupHandlers();
  }

  /**
   * Set up all website-related IPC handlers with comprehensive resilience protection.
   */
  private setupHandlers(): void {
    // Website listing with validation and error handling
    createStandardIPCHandler(
      this.ipcManager,
      'list-websites',
      this.handleListWebsites.bind(this),
      [], // No input parameters
      { timeout: 5000 }
    );

    // Website creation with comprehensive validation
    createFileOperationIPCHandler(
      this.ipcManager,
      'create-website',
      this.handleCreateWebsite.bind(this),
      [CommonValidationSchemas.websiteName],
      { timeout: 30000 }
    );

    // Website validation
    createStandardIPCHandler(
      this.ipcManager,
      'validate-website-name',
      this.handleValidateWebsiteName.bind(this),
      [CommonValidationSchemas.websiteName],
      { timeout: 3000 }
    );

    // Website renaming with validation
    createFileOperationIPCHandler(
      this.ipcManager,
      'rename-website',
      this.handleRenameWebsite.bind(this),
      [
        CommonValidationSchemas.websiteName, // old name
        CommonValidationSchemas.websiteName, // new name
      ],
      { timeout: 20000 }
    );

    // Website deletion with confirmation
    createFileOperationIPCHandler(
      this.ipcManager,
      'delete-website',
      this.handleDeleteWebsite.bind(this),
      [CommonValidationSchemas.websiteName],
      { timeout: 15000 }
    );

    // Website opening
    createStandardIPCHandler(
      this.ipcManager,
      'open-website',
      this.handleOpenWebsite.bind(this),
      [CommonValidationSchemas.websiteName],
      { timeout: 10000 }
    );

    this.logger.info('Enhanced website IPC handlers registered');
  }

  /**
   * Handle website listing with resilient service access and error fallback.
   */
  private async handleListWebsites(): Promise<string[]> {
    try {
      const appContext = getGlobalContext();
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);

      // Use resilient service wrapper
      const websites = await websiteManager.execute(async (service) => {
        return service.listWebsites();
      });

      this.logger.info(`Listed ${websites.length} websites`);
      return websites;
    } catch (error) {
      this.logger.error('Failed to list websites', error instanceof Error ? error : undefined);

      // Provide graceful fallback
      if (error instanceof Error && error.message.includes('Circuit breaker is OPEN')) {
        throw new Error('Website service is temporarily unavailable. Please try again in a moment.');
      }

      throw new Error(`Unable to list websites: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle website creation with comprehensive validation and atomic file operations.
   */
  private async handleCreateWebsite(websiteName: string): Promise<string> {
    try {
      const appContext = getGlobalContext();
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      const store = appContext.getResilientService<IStore>(ServiceKeys.STORE);

      // Validate website name
      const validation = await websiteManager.execute(async (service) => {
        return service.validateWebsiteNameAsync(websiteName);
      });

      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid website name');
      }

      // Create website with resilience
      const websitePath = await websiteManager.execute(async (service) => {
        return service.createWebsite(websiteName);
      });

      // Add to recent websites
      await store.execute(async (service) => {
        service.addRecentWebsite(websiteName);
        return service.forceSave();
      });

      this.logger.info(`Successfully created website: ${websiteName}`, {
        path: websitePath,
      });

      return websitePath;
    } catch (error) {
      this.logger.error(`Failed to create website: ${websiteName}`, error instanceof Error ? error : undefined);

      // Clean error messages for user
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          throw new Error(`A website named "${websiteName}" already exists. Please choose a different name.`);
        }
        if (error.message.includes('invalid characters')) {
          throw new Error(
            `Website name contains invalid characters. Please use only letters, numbers, hyphens, and underscores.`
          );
        }
        if (error.message.includes('Circuit breaker is OPEN')) {
          throw new Error('Website service is temporarily unavailable. Please try again in a moment.');
        }
      }

      throw new Error(`Failed to create website: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle website name validation with service resilience protection.
   */
  private async handleValidateWebsiteName(websiteName: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const appContext = getGlobalContext();
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);

      const result = await websiteManager.execute(async (service) => {
        return service.validateWebsiteName(websiteName);
      });

      return result;
    } catch (error) {
      this.logger.error(`Failed to validate website name: ${websiteName}`, error instanceof Error ? error : undefined);

      // Return validation failure instead of throwing
      return {
        valid: false,
        error: 'Unable to validate website name due to service error',
      };
    }
  }

  /**
   * Handle website renaming with atomic operations and rollback capability.
   */
  private async handleRenameWebsite(oldName: string, newName: string): Promise<boolean> {
    try {
      const appContext = getGlobalContext();
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      const store = appContext.getResilientService<IStore>(ServiceKeys.STORE);

      // Validate new name first
      const validation = await websiteManager.execute(async (service) => {
        return service.validateWebsiteName(newName);
      });

      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid new website name');
      }

      // Perform rename with resilience
      const success = await websiteManager.execute(async (service) => {
        return service.renameWebsite(oldName, newName);
      });

      if (success) {
        // Update recent websites
        await store.execute(async (service) => {
          service.removeRecentWebsite(oldName);
          service.addRecentWebsite(newName);
          return service.forceSave();
        });

        this.logger.info(`Successfully renamed website: ${oldName} -> ${newName}`);
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to rename website: ${oldName} -> ${newName}`,
        error instanceof Error ? error : undefined
      );

      // Provide specific error messages
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          throw new Error(`Website "${oldName}" not found.`);
        }
        if (error.message.includes('already exists')) {
          throw new Error(`A website named "${newName}" already exists.`);
        }
        if (error.message.includes('Circuit breaker is OPEN')) {
          throw new Error('Website service is temporarily unavailable. Please try again in a moment.');
        }
      }

      throw error;
    }
  }

  /**
   * Handle website deletion with safety checks and cleanup operations.
   */
  private async handleDeleteWebsite(websiteName: string): Promise<boolean> {
    try {
      const appContext = getGlobalContext();
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      const store = appContext.getResilientService<IStore>(ServiceKeys.STORE);

      // Delete website with resilience
      const deleted = await websiteManager.execute(async (service) => {
        return service.deleteWebsite(websiteName);
      });

      if (deleted) {
        // Remove from recent websites
        await store.execute(async (service) => {
          service.removeRecentWebsite(websiteName);
          return service.forceSave();
        });

        this.logger.info(`Successfully deleted website: ${websiteName}`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete website: ${websiteName}`, error instanceof Error ? error : undefined);

      // Provide specific error messages
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          throw new Error(`Website "${websiteName}" not found.`);
        }
        if (error.message.includes('in use')) {
          throw new Error(`Cannot delete "${websiteName}" because it is currently open. Please close it first.`);
        }
        if (error.message.includes('Circuit breaker is OPEN')) {
          throw new Error('Website service is temporarily unavailable. Please try again in a moment.');
        }
      }

      throw error;
    }
  }

  /**
   * Handle website opening with path validation and window management.
   */
  private async handleOpenWebsite(websiteName: string): Promise<void> {
    try {
      const appContext = getGlobalContext();
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);

      // Get website path with resilience
      const websitePath = await websiteManager.execute(async (service) => {
        return service.getWebsitePath(websiteName);
      });

      // Import and call the website opening function
      const { openWebsiteInNewWindow } = await import('./website');
      await openWebsiteInNewWindow(websiteName, websitePath);

      this.logger.info(`Successfully opened website: ${websiteName}`);
    } catch (error) {
      this.logger.error(`Failed to open website: ${websiteName}`, error instanceof Error ? error : undefined);

      // Provide specific error messages
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          throw new Error(`Website "${websiteName}" not found.`);
        }
        if (error.message.includes('already open')) {
          throw new Error(`Website "${websiteName}" is already open.`);
        }
        if (error.message.includes('Circuit breaker is OPEN')) {
          throw new Error('Website service is temporarily unavailable. Please try again in a moment.');
        }
      }

      throw error;
    }
  }

  /**
   * Get comprehensive resilience metrics for system monitoring and debugging.
   */
  getMetrics(): Record<string, unknown> {
    return this.ipcManager.getMetrics();
  }

  /**
   * Cleanup resources and dispose of IPC resilience manager.
   */
  dispose(): void {
    this.ipcManager.cleanup();
    this.logger.info('Enhanced website handlers disposed');
  }
}
