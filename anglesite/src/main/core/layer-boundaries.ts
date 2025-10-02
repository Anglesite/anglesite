/**
 * @file Layer Boundary Definitions
 *
 * Defines strict layer boundaries based on the Anglesite architecture diagram:
 *
 * Layer 1: GUI (Electron App) - React UI and window management
 * Layer 2: Node.js 11ty Website Manager - Orchestrates all website operations
 * Layer 3: Individual Website Repos - Isolated 11ty instances
 *
 * This file establishes interfaces that enforce one-way dependencies:
 * GUI → Manager → Websites (never the reverse)
 */

import { ILogger } from './interfaces';

/**
 * Layer 3: Individual Website Server Instance
 *
 * Represents a single isolated website with its own 11ty server.
 * Each instance is completely independent and cannot communicate with other websites.
 */
export interface IsolatedWebsiteInstance {
  /** Unique identifier for this website */
  readonly websiteName: string;

  /** Local development server port */
  readonly port: number;

  /** Server URL (e.g., http://localhost:3000) */
  readonly url: string;

  /** Absolute path to website root directory */
  readonly rootPath: string;

  /** Absolute path to website source directory */
  readonly sourcePath: string;

  /** Absolute path to website output directory */
  readonly outputPath: string;

  /** Server health status */
  readonly isHealthy: boolean;

  /** Last build time in milliseconds */
  readonly lastBuildTime?: number;

  /** Rebuild the website */
  rebuild(): Promise<void>;

  /** Resolve a source file path to its URL */
  resolveFileToUrl(filePath: string): Promise<string | null>;

  /** Shutdown this website server */
  shutdown(): Promise<void>;
}

/**
 * Layer 2: Website Manager Layer
 *
 * Central orchestration service that manages all website instances.
 * This is the "Node.js 11ty Website Manager" from the diagram.
 */
export interface IWebsiteOrchestrator {
  /**
   * Create a new website from template
   * @returns The isolated website instance
   */
  createWebsite(websiteName: string): Promise<IsolatedWebsiteInstance>;

  /**
   * Start a server for an existing website
   * @returns The running website instance
   */
  startWebsiteServer(websiteName: string): Promise<IsolatedWebsiteInstance>;

  /**
   * Stop a website server
   */
  stopWebsiteServer(websiteName: string): Promise<void>;

  /**
   * Get a running website instance (without starting it)
   */
  getWebsiteInstance(websiteName: string): IsolatedWebsiteInstance | null;

  /**
   * List all available websites (both running and stopped)
   */
  listAllWebsites(): Promise<string[]>;

  /**
   * List currently running website instances
   */
  listRunningWebsites(): string[];

  /**
   * Delete a website permanently
   */
  deleteWebsite(websiteName: string): Promise<boolean>;

  /**
   * Rename a website
   */
  renameWebsite(oldName: string, newName: string): Promise<boolean>;

  /**
   * Validate a website name
   */
  validateWebsiteName(name: string): { valid: boolean; error?: string };

  /**
   * Shutdown all website servers
   */
  shutdownAll(): Promise<void>;
}

/**
 * Layer 1: GUI Communication Interface
 *
 * Events that the GUI layer can subscribe to.
 * The Manager layer publishes these events upward to the GUI.
 */
export interface WebsiteManagerEvents {
  /** Website server started successfully */
  'website:started': (websiteName: string, instance: IsolatedWebsiteInstance) => void;

  /** Website server stopped */
  'website:stopped': (websiteName: string) => void;

  /** Website build completed */
  'website:build-complete': (websiteName: string, buildTimeMs: number) => void;

  /** Website build failed */
  'website:build-failed': (websiteName: string, error: Error) => void;

  /** Website created */
  'website:created': (websiteName: string, path: string) => void;

  /** Website deleted */
  'website:deleted': (websiteName: string) => void;

  /** Website renamed */
  'website:renamed': (oldName: string, newName: string) => void;

  /** Log message from a website */
  'website:log': (websiteName: string, message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;
}

/**
 * Layer Boundary Communication Protocol
 *
 * Defines how layers communicate without direct coupling.
 */
export interface LayerCommunicationBus {
  /**
   * Publish an event upward to the GUI layer
   */
  publishToGUI<K extends keyof WebsiteManagerEvents>(event: K, ...args: Parameters<WebsiteManagerEvents[K]>): void;

  /**
   * Subscribe to events from the Manager layer (GUI only)
   */
  subscribeFromManager<K extends keyof WebsiteManagerEvents>(event: K, handler: WebsiteManagerEvents[K]): () => void;
}

/**
 * Factory for creating the layer communication bus
 */
export function createLayerCommunicationBus(logger: ILogger): LayerCommunicationBus {
  const subscribers = new Map<string, Set<Function>>();

  return {
    publishToGUI(event, ...args) {
      const handlers = subscribers.get(event);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(...args);
          } catch (error) {
            logger.error(`Error in GUI event handler for ${event}`, error as Error);
          }
        });
      }
    },

    subscribeFromManager(event, handler) {
      if (!subscribers.has(event)) {
        subscribers.set(event, new Set());
      }
      subscribers.get(event)!.add(handler);

      // Return unsubscribe function
      return () => {
        subscribers.get(event)?.delete(handler);
      };
    },
  };
}
