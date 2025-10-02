/**
 * @file Multi-window management for website windows and help window.
 */
import { BrowserWindow, WebContentsView, Menu, MenuItem } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { setLiveServerUrl, setCurrentWebsiteName } from '../server/eleventy';
import { WebsiteServer } from '../server/per-website-server';
import { IWebsiteServerManager, ManagedServer, IGitHistoryManager, IWebsiteManager } from '../core/interfaces';
import { IWebsiteOrchestrator, IsolatedWebsiteInstance } from '../core/layer-boundaries';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';
import {
  setupWebContentsWithCleanup,
  cleanupWebContentsListeners,
  monitorWebContentsMemory,
} from './webcontents-cleanup';
import { logger } from '../utils/logging';

// Type definition for website window
interface WebsiteWindow {
  window: BrowserWindow;
  webContentsView: WebContentsView;
  websiteName: string;
  websitePath?: string;
  serverUrl?: string; // Store the server URL for this website
  eleventyPort?: number; // HTTP port for Eleventy dev server
  httpsProxyPort?: number; // HTTPS proxy port (if using HTTPS mode)
  server?: WebsiteServer; // Reference to the website's individual server
  loadingView?: WebContentsView; // Native loading overlay view
  managedServer?: ManagedServer; // Reference to the managed server info
  isEditorWindow?: boolean; // Whether this is an editor window (true) or preview window (false/undefined)
}

const websiteWindows: Map<string, WebsiteWindow> = new Map();

// Set up orchestrator communication bus listeners (DI-compatible)
let eventListenersSetup = false;
let communicationBusUnsubscribers: Array<() => void> = [];

// Help window instance
let helpWindow: BrowserWindow | null = null;

// Start screen window instance
let startScreenWindow: BrowserWindow | null = null;

// Re-export for use in other modules (deprecated, use WebsiteServerManager instead)
// Note: This export is kept for backward compatibility but should be migrated

/**
 * Send log message to a website window's console
 *
 * Transmits log messages from the main process to a specific website window's
 * renderer process. Used for debugging and development feedback.
 * @param websiteName Name of the website window to send log to
 * @param message Log message content
 * @param level Log level severity (default: 'info')
 * @example
 * ```typescript
 * sendLogToWebsite('my-blog', 'Build completed successfully', 'info');
 * sendLogToWebsite('portfolio', 'Warning: missing alt text', 'warning');
 * ```
 */
export function sendLogToWebsite(websiteName: string, message: string, level: string = 'info') {
  const websiteWindow = websiteWindows.get(websiteName);
  if (websiteWindow && !websiteWindow.window.isDestroyed()) {
    try {
      const logData = {
        type: 'log',
        message,
        level,
        timestamp: new Date().toISOString(),
      };

      // Send to loading view if it exists and is visible
      if (websiteWindow.loadingView && !websiteWindow.loadingView.webContents.isDestroyed()) {
        websiteWindow.loadingView.webContents.executeJavaScript(`window.postMessage(${JSON.stringify(logData)}, '*');`);
      }

      // Also send to main preview view for backwards compatibility
      websiteWindow.webContentsView.webContents.executeJavaScript(
        `window.postMessage(${JSON.stringify(logData)}, '*');`
      );
    } catch (error) {
      console.error(`Could not send log to ${websiteName}:`, error);
    }
  }
}

/**
 * Create and show native loading view overlay.
 */
function createLoadingView(websiteWindow: WebsiteWindow): WebContentsView {
  const loadingView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  // Load the native loading template
  const loadingDataUrl = loadTemplateAsDataUrl('native-loading-view');
  loadingView.webContents.loadURL(loadingDataUrl);

  // Position the loading view to cover the preview area
  const bounds = websiteWindow.window.getBounds();
  const leftPanelWidth = 240;
  const rightPanelWidth = 280;
  const toolbarHeight = 48;

  loadingView.setBounds({
    x: leftPanelWidth,
    y: toolbarHeight,
    width: bounds.width - leftPanelWidth - rightPanelWidth,
    height: bounds.height - toolbarHeight,
  });

  // Add the loading view on top of the preview
  websiteWindow.window.contentView.addChildView(loadingView);

  return loadingView;
}

/**
 * Show native loading view for a website.
 */
export function showNativeLoadingView(websiteName: string): void {
  const websiteWindow = websiteWindows.get(websiteName);
  if (!websiteWindow || websiteWindow.window.isDestroyed()) {
    console.error(`Website window not found: ${websiteName}`);
    return;
  }

  // Create loading view if it doesn't exist
  if (!websiteWindow.loadingView) {
    websiteWindow.loadingView = createLoadingView(websiteWindow);
  }

  // Make sure loading view is visible and on top
  websiteWindow.loadingView.setVisible(true);
}

/**
 * Hide native loading view and show website preview.
 */
export function hideNativeLoadingView(websiteName: string): void {
  const websiteWindow = websiteWindows.get(websiteName);
  if (!websiteWindow || websiteWindow.window.isDestroyed()) {
    console.error(`Website window not found: ${websiteName}`);
    return;
  }

  if (websiteWindow.loadingView) {
    websiteWindow.loadingView.setVisible(false);
  }
}

/**
 * Show error state in native loading view.
 */
export function showNativeLoadingError(websiteName: string): void {
  const websiteWindow = websiteWindows.get(websiteName);
  if (websiteWindow && websiteWindow.loadingView && !websiteWindow.loadingView.webContents.isDestroyed()) {
    try {
      websiteWindow.loadingView.webContents.executeJavaScript(`window.postMessage({ type: 'showError' }, '*');`);
    } catch (error) {
      console.error(`Could not show error in loading view for ${websiteName}:`, error);
    }
  }
}
import { updateApplicationMenu } from './menu';
import { themeManager } from './theme-manager';
import { WindowState, Rectangle } from '../core/types';
import { IStore, IMonitorManager } from '../core/interfaces';
import { loadTemplateAsDataUrl, getTemplateFilePath } from './template-loader';

// Variables declared at top of file
export function setupServerManagerEventListeners(): void {
  if (eventListenersSetup) return; // Prevent duplicate setup

  try {
    const appContext = getGlobalContext();
    const orchestrator = appContext.getService<IWebsiteOrchestrator>(ServiceKeys.WEBSITE_ORCHESTRATOR);

    // Get the orchestrator's communication bus
    // Note: We need to cast to access getCommunicationBus() since it's implementation-specific
    const orchestratorImpl = orchestrator as any;
    if (typeof orchestratorImpl.getCommunicationBus !== 'function') {
      console.warn('Orchestrator does not expose communication bus - falling back to legacy system');
      // Fall back to old WebsiteServerManager if orchestrator doesn't support bus
      const websiteServerManager = appContext.getService<IWebsiteServerManager>(ServiceKeys.WEBSITE_SERVER_MANAGER);
      websiteServerManager.on('server-log', (websiteName: string, message: string, level: string) => {
        sendLogToWebsite(websiteName, message, level);
      });
      websiteServerManager.on('server-started', (websiteName: string, managedServer: ManagedServer) => {
        const websiteWindow = websiteWindows.get(websiteName);
        if (websiteWindow) {
          websiteWindow.managedServer = managedServer;
          websiteWindow.server = managedServer.server;
          websiteWindow.eleventyPort = managedServer.port;
          websiteWindow.serverUrl = managedServer.actualUrl;
        }
      });
      websiteServerManager.on('server-error', (websiteName: string, error: Error) => {
        sendLogToWebsite(websiteName, `❌ Server error: ${error.message}`, 'error');
        showNativeLoadingError(websiteName);
      });
      eventListenersSetup = true;
      return;
    }

    const bus = orchestratorImpl.getCommunicationBus();

    // Subscribe to website events from the orchestrator layer
    const unsubscribeLog = bus.subscribeFromManager('website:log', (websiteName, message, level) => {
      sendLogToWebsite(websiteName, message, level);
    });
    communicationBusUnsubscribers.push(unsubscribeLog);

    const unsubscribeStarted = bus.subscribeFromManager(
      'website:started',
      (websiteName, instance: IsolatedWebsiteInstance) => {
        const websiteWindow = websiteWindows.get(websiteName);
        if (websiteWindow) {
          websiteWindow.eleventyPort = instance.port;
          websiteWindow.serverUrl = instance.url;
        }
        sendLogToWebsite(websiteName, `✅ Server started at ${instance.url}`, 'info');
      }
    );
    communicationBusUnsubscribers.push(unsubscribeStarted);

    const unsubscribeStopped = bus.subscribeFromManager('website:stopped', (websiteName) => {
      sendLogToWebsite(websiteName, `🛑 Server stopped`, 'info');
    });
    communicationBusUnsubscribers.push(unsubscribeStopped);

    const unsubscribeBuildComplete = bus.subscribeFromManager('website:build-complete', (websiteName, buildTimeMs) => {
      sendLogToWebsite(websiteName, `✅ Build completed in ${buildTimeMs}ms`, 'info');
    });
    communicationBusUnsubscribers.push(unsubscribeBuildComplete);

    const unsubscribeBuildFailed = bus.subscribeFromManager('website:build-failed', (websiteName, error) => {
      sendLogToWebsite(websiteName, `❌ Build failed: ${error.message}`, 'error');
      showNativeLoadingError(websiteName);
    });
    communicationBusUnsubscribers.push(unsubscribeBuildFailed);

    eventListenersSetup = true;
    logger.info('Orchestrator communication bus connected to GUI layer');
  } catch (error) {
    console.warn('Orchestrator communication bus not set up yet (DI not initialized):', error);
  }
}

// Don't try to initialize event listeners on module load - wait for DI to be ready

// Help window instance declared at top of file

/**
 * Find an available ephemeral port.
 * @deprecated Use WebsiteServerManager for port allocation
 */
export async function findAvailablePort(startPort: number = 8081): Promise<number> {
  // Delegate to server manager for centralized port management
  console.warn('findAvailablePort is deprecated, use WebsiteServerManager instead');

  // For backward compatibility, we'll still provide this function
  // but it should eventually be removed
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const server = require('net').createServer();
    server.listen(startPort, () => {
      const port = (server.address() as { port: number } | null)?.port;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error('Could not determine port'));
        }
      });
    });

    server.on('error', async (err: Error & { code?: string }) => {
      if (err.code === 'EADDRINUSE') {
        try {
          const nextPort = await findAvailablePort(startPort + 1);
          resolve(nextPort);
        } catch (nextErr) {
          reject(nextErr);
        }
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Create a new dedicated website window for editing and preview
 *
 * Creates a singleton window for the specified website with its own WebContentsView
 * for live preview. Each website gets its own isolated window to enable concurrent
 * editing of multiple websites.
 *
 * If a window already exists for the website and is not destroyed, it will be
 * focused instead of creating a new one.
 * @param websiteName Unique name of the website.
 * @param websitePath Optional file system path to the website directory.
 * @returns The website window BrowserWindow instance.
 * @example
 * ```typescript
 * const websiteWin = createWebsiteWindow('my-blog', '/path/to/my-blog');
 * console.log(websiteWin.getTitle()); // 'my-blog'
 * ```
 */
export function createWebsiteWindow(websiteName: string, websitePath?: string): BrowserWindow {
  // Server manager event listeners are now set up properly in main.ts after DI initialization

  // Check if window already exists for this website
  const existingWindow = websiteWindows.get(websiteName);
  if (existingWindow && !existingWindow.window.isDestroyed()) {
    existingWindow.window.focus();
    return existingWindow.window;
  }

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: websiteName,
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
    titleBarStyle: 'default',
    // Enable native macOS window tabbing
    tabbingIdentifier: 'anglesite-website',
  });

  // Prevent HTML title from overriding window title
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // Load the website editor template as a file URL to support relative paths
  const websiteEditorFileUrl = getTemplateFilePath('website-editor');
  // Add website name as a URL parameter for the frontend to use
  const urlWithWebsiteName = `${websiteEditorFileUrl}?websiteName=${encodeURIComponent(websiteName)}`;
  window.loadURL(urlWithWebsiteName);

  // Add context menu for Anglesite's UI (non-production builds only)
  if (process.env.NODE_ENV !== 'production') {
    window.webContents.on('context-menu', (_event, params) => {
      const contextMenu = new Menu();

      contextMenu.append(
        new MenuItem({
          label: 'Inspect Element…',
          accelerator: 'CmdOrCtrl+Option+I',
          click: () => {
            window.webContents.inspectElement(params.x, params.y);
          },
        })
      );

      contextMenu.popup();
    });
  }

  // Create preview WebContentsView for website content
  const webContentsView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
    },
  });

  // Set up WebContents with proper cleanup and monitoring
  setupWebContentsWithCleanup(webContentsView.webContents, (webContents) => {
    // Add memory monitoring
    monitorWebContentsMemory(webContents, `website-${websiteName}`);

    // Add error handling
    webContents.on('render-process-gone', (_event, details) => {
      console.error('Website WebContentsView render process gone:', details);
      setTimeout(() => {
        try {
          if (!webContents.isDestroyed()) {
            webContents.reload();
          }
        } catch (error) {
          console.error('Failed to reload website WebContentsView:', error);
        }
      }, 1000);
    });

    webContents.on('unresponsive', () => {
      console.error('Website WebContentsView webContents unresponsive');
    });

    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Website WebContentsView failed to load:', {
        errorCode,
        errorDescription,
        validatedURL,
      });
    });
  });

  // Add WebContentsView to window
  window.contentView.addChildView(webContentsView);

  // Handle window resize
  window.on('resize', () => {
    const websiteWindow = websiteWindows.get(websiteName);
    if (webContentsView && websiteWindow) {
      const bounds = window.getBounds();
      // Website editor layout: left panel (240px) + center panel + right panel (280px)
      const leftPanelWidth = 240;
      const rightPanelWidth = 280;
      const toolbarHeight = 48; // Website editor toolbar: 48px height
      const viewBounds = {
        x: leftPanelWidth,
        y: toolbarHeight,
        width: bounds.width - leftPanelWidth - rightPanelWidth,
        height: bounds.height - toolbarHeight,
      };

      webContentsView.setBounds(viewBounds);

      // Also resize loading view if it exists
      if (websiteWindow.loadingView) {
        websiteWindow.loadingView.setBounds(viewBounds);
      }
    }
  });

  // Position the preview correctly for website editor layout
  const bounds = window.getBounds();
  // Website editor layout: left panel (240px) + center panel + right panel (280px)
  const leftPanelWidth = 240;
  const rightPanelWidth = 280;
  const toolbarHeight = 48; // Website editor toolbar: 48px height
  const webContentsViewBounds = {
    x: leftPanelWidth,
    y: toolbarHeight,
    width: bounds.width - leftPanelWidth - rightPanelWidth,
    height: bounds.height - toolbarHeight,
  };
  webContentsView.setBounds(webContentsViewBounds);

  // Store website window
  const websiteWindow: WebsiteWindow = {
    window,
    webContentsView,
    websiteName,
    websitePath,
  };
  websiteWindows.set(websiteName, websiteWindow);

  // Close start screen when first website window is created
  closeStartScreen();

  // Update menu and server URL when focus changes
  window.on('focus', () => {
    // Update the global server URL to match this window's website
    if (websiteWindow.serverUrl) {
      setLiveServerUrl(websiteWindow.serverUrl);
      setCurrentWebsiteName(websiteName);
    }
    updateApplicationMenu();
  });

  window.on('blur', () => {
    updateApplicationMenu();
  });

  // Clean up when window is closed
  window.on('closed', async () => {
    // Clean up WebContents listeners first to prevent memory leaks
    const websiteWindow = websiteWindows.get(websiteName);
    if (websiteWindow) {
      // Clean up main WebContentsView
      if (websiteWindow.webContentsView && !websiteWindow.webContentsView.webContents.isDestroyed()) {
        cleanupWebContentsListeners(websiteWindow.webContentsView.webContents);
      }

      // Clean up loading view WebContents
      if (websiteWindow.loadingView && !websiteWindow.loadingView.webContents.isDestroyed()) {
        cleanupWebContentsListeners(websiteWindow.loadingView.webContents);
        try {
          websiteWindow.loadingView.webContents.close();
        } catch (error) {
          console.error(`Error closing loading view for ${websiteName}:`, error);
        }
      }
    }

    // Auto-commit changes before closing
    try {
      const appContext = getGlobalContext();
      const gitHistoryManager = appContext.getService<IGitHistoryManager>(ServiceKeys.GIT_HISTORY_MANAGER);
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);

      const websitePath = await websiteManager.execute(async (service) => {
        return service.getWebsitePath(websiteName);
      });
      await gitHistoryManager.autoCommit(websitePath, 'close');
      console.log(`[Window] Git auto-commit on close for website: ${websiteName}`);
    } catch (error) {
      console.warn('[Window] Failed to auto-commit on window close:', error);
    }

    // Stop the server using the DI-based centralized manager
    try {
      const appContext = getGlobalContext();
      const websiteServerManager = appContext.getService<IWebsiteServerManager>(ServiceKeys.WEBSITE_SERVER_MANAGER);
      await websiteServerManager.stopServer(websiteName);
    } catch (error) {
      console.error(`Error stopping server for ${websiteName}:`, error);
    }

    websiteWindows.delete(websiteName);
    updateApplicationMenu();

    // Show start screen if this was the last website window
    if (websiteWindows.size === 0) {
      showStartScreenIfNeeded();
    }
  });

  updateApplicationMenu();

  // Use ready-to-show event as recommended by Electron docs
  window.once('ready-to-show', () => {
    if (window && !window.isDestroyed()) {
      themeManager.applyThemeToWindow(window);
      window.show();
    }
  });

  return window;
}

/**
 * Start individual server for a website and update its window.
 */
export async function startWebsiteServerAndUpdateWindow(websiteName: string, websitePath: string): Promise<void> {
  const websiteWindow = websiteWindows.get(websiteName);
  if (!websiteWindow || websiteWindow.window.isDestroyed()) {
    console.error(`Website window not found for server startup: ${websiteName}`);
    return;
  }

  // Show native loading view immediately
  showNativeLoadingView(websiteName);

  try {
    sendLogToWebsite(websiteName, `🔄 Preparing to start server for ${websiteName}...`, 'startup');

    // Use the DI-based orchestrator to start the server
    const appContext = getGlobalContext();
    const orchestrator = appContext.getService<IWebsiteOrchestrator>(ServiceKeys.WEBSITE_ORCHESTRATOR);

    // Start the server through the orchestrator (uses centralized management)
    const instance = await orchestrator.startWebsiteServer(websiteName);

    // Update website window with server info from the isolated instance
    websiteWindow.eleventyPort = instance.port;
    websiteWindow.serverUrl = instance.url;

    sendLogToWebsite(websiteName, `✅ Server startup completed at ${instance.url}!`, 'info');

    // Send website data to the editor window now that server is ready
    websiteWindow.window.webContents.send('load-website', {
      name: websiteName,
      path: websitePath,
    });

    // Load content in the window with a delay to ensure WebContentsView is ready
    sendLogToWebsite(websiteName, `🌐 Loading website content...`, 'info');
    setTimeout(() => loadWebsiteContent(websiteName), 1000);
  } catch (error) {
    console.error(`Failed to start server for ${websiteName}:`, error);
    sendLogToWebsite(
      websiteName,
      `❌ Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    // Show error state in native loading view
    showNativeLoadingError(websiteName);
  }
}

/**
 * Load website content in its window.
 */
export function loadWebsiteContent(websiteName: string): void {
  const websiteWindow = websiteWindows.get(websiteName);
  if (!websiteWindow || websiteWindow.window.isDestroyed()) {
    console.error(`Website window not found or destroyed: ${websiteName}`);
    return;
  }

  // Don't try to load content if we don't have a server URL
  if (!websiteWindow.serverUrl) {
    return;
  }

  // Simple approach - just load the URL without complex retry logic
  try {
    if (
      websiteWindow.webContentsView &&
      websiteWindow.webContentsView.webContents &&
      !websiteWindow.webContentsView.webContents.isDestroyed()
    ) {
      // Add event listeners to see what happens
      websiteWindow.webContentsView.webContents.once('did-finish-load', () => {
        sendLogToWebsite(websiteName, `🎉 Website loaded successfully!`, 'info');
        // Hide native loading view when website loads
        hideNativeLoadingView(websiteName);
      });

      websiteWindow.webContentsView.webContents.once(
        'did-fail-load',
        (_event, errorCode, errorDescription, validatedURL) => {
          console.error(`WebContentsView failed to load for: ${websiteName}`, {
            errorCode,
            errorDescription,
            validatedURL,
          });
          sendLogToWebsite(websiteName, `❌ Failed to load website: ${errorDescription}`, 'error');
          // Show error state in loading view
          showNativeLoadingError(websiteName);
        }
      );

      websiteWindow.webContentsView.webContents.loadURL(websiteWindow.serverUrl);
      websiteWindow.window.webContents.send('preview-loaded');
    } else {
      console.error(`WebContentsView or webContents not available for: ${websiteName}`);
    }
  } catch (error) {
    console.error(`Error loading content for ${websiteName}:`, error);
  }
}

/**
 * Get website window reference.
 */
export function getWebsiteWindow(websiteName: string): BrowserWindow | null {
  const websiteWindow = websiteWindows.get(websiteName);
  return websiteWindow && !websiteWindow.window.isDestroyed() ? websiteWindow.window : null;
}

/**
 * Returns the complete map of all currently open website windows keyed by website name.
 */
export function getAllWebsiteWindows(): Map<string, WebsiteWindow> {
  return websiteWindows;
}

/**
 * Get website server by name.
 */
export function getWebsiteServer(websiteName: string): WebsiteServer | undefined {
  try {
    const appContext = getGlobalContext();
    const websiteServerManager = appContext.getService<IWebsiteServerManager>(ServiceKeys.WEBSITE_SERVER_MANAGER);
    const managedServer = websiteServerManager.getServer(websiteName);
    return managedServer?.server;
  } catch (error) {
    console.error('Failed to get website server via DI:', error);
    return undefined;
  }
}

/**
 * Get all currently running website servers mapped by website name.
 * @deprecated Use websiteServerManager.getAllServers() instead
 */
export function getAllWebsiteServers(): Map<string, WebsiteServer> {
  console.warn('getAllWebsiteServers is deprecated, use websiteServerManager.getAllServers() instead');
  const result = new Map<string, WebsiteServer>();

  try {
    const appContext = getGlobalContext();
    const websiteServerManager = appContext.getService<IWebsiteServerManager>(ServiceKeys.WEBSITE_SERVER_MANAGER);

    // Get the internal servers map and iterate over it
    const allServers = websiteServerManager.getAllServers();
    for (const [websiteName, managedServer] of allServers.entries()) {
      if (managedServer && managedServer.server) {
        result.set(websiteName, managedServer.server as WebsiteServer);
      }
    }
  } catch (error) {
    console.error('Failed to get all website servers via DI:', error);
  }

  return result;
}

/**
 * Calculate optimal window bounds using monitor-aware placement.
 */
function calculateOptimalWindowBounds(windowState: WindowState): Rectangle | null {
  try {
    const appContext = getGlobalContext();
    const monitorManager = appContext.getService<IMonitorManager>(ServiceKeys.MONITOR_MANAGER);

    if (!monitorManager) {
      // Fallback to saved bounds if monitor manager not available
      return windowState.bounds || null;
    }

    // Find the best monitor for this window
    const bestMonitor = monitorManager.findBestMonitorForWindow(windowState);
    if (!bestMonitor) {
      return windowState.bounds || null;
    }

    // Calculate optimal bounds using monitor manager
    const optimalBounds = monitorManager.calculateWindowBounds(windowState, bestMonitor);
    return optimalBounds;
  } catch (error) {
    console.warn('Failed to calculate optimal window bounds, using fallback:', error);
    return windowState.bounds || null;
  }
}

/**
 * Save current window states to persistent storage with monitor awareness.
 */
export function saveWindowStates(): void {
  logger.debug('saveWindowStates() called - checking for open windows');
  const appContext = getGlobalContext();
  const store = appContext.getService<IStore>(ServiceKeys.STORE);
  const windowStates: WindowState[] = [];

  // Try to get monitor manager for enhanced window state persistence
  let monitorManager: IMonitorManager | null = null;
  let currentMonitorConfig = null;

  try {
    monitorManager = appContext.getService<IMonitorManager>(ServiceKeys.MONITOR_MANAGER);
    if (monitorManager) {
      currentMonitorConfig = monitorManager.getCurrentConfiguration();
    }
  } catch (error) {
    logger.warn('Monitor manager not available, saving basic window states', { error });
  }

  // Note: Help window state is no longer persisted since we don't auto-show it on startup

  // Save website window states with monitor awareness
  logger.debug(`Found ${websiteWindows.size} website windows to save`);
  websiteWindows.forEach((websiteWindow, websiteName) => {
    logger.debug(`Processing window for ${websiteName}`);
    if (!websiteWindow.window.isDestroyed()) {
      const bounds = websiteWindow.window.getBounds();
      const isMaximized = websiteWindow.window.isMaximized();

      const windowState: WindowState = {
        websiteName,
        websitePath: websiteWindow.websitePath,
        bounds,
        isMaximized,
        windowType: websiteWindow.isEditorWindow ? 'editor' : 'preview',
      };

      // Add monitor-aware data if monitor manager is available
      if (monitorManager && currentMonitorConfig) {
        try {
          const bestMonitor = monitorManager.findBestMonitorForWindow(windowState);
          if (bestMonitor) {
            windowState.targetMonitorId = bestMonitor.id;
            windowState.relativePosition = monitorManager.calculateRelativePosition(bounds, bestMonitor);
            windowState.monitorConfig = currentMonitorConfig;
          }
        } catch (error) {
          logger.warn(`Failed to determine monitor data for window ${websiteName}`, { error });
        }
      }

      windowStates.push(windowState);
      logger.debug(`Added window state for ${websiteName}`, { windowState });
    }
  });

  logger.debug(`Saving ${windowStates.length} window states to store`);
  store.saveWindowStates(windowStates);
  logger.debug('Window states saved to store');
}

/**
 * Restore website windows from saved states.
 */
export async function restoreWindowStates(): Promise<void> {
  const store = getGlobalContext().getService<IStore>(ServiceKeys.STORE);
  const windowStates = store.getWindowStates();

  if (windowStates.length === 0) {
    // Show start screen when no websites are being restored
    showStartScreenIfNeeded();
    return;
  }

  const validWindowStates: WindowState[] = [];

  for (const windowState of windowStates) {
    try {
      // Check if website directory exists before attempting restoration
      let websitePath = windowState.websitePath;
      if (!websitePath) {
        const appContext = getGlobalContext();
        const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
        websitePath = await websiteManager.execute(async (service) => {
          return service.getWebsitePath(windowState.websiteName);
        });
      }

      if (!fs.existsSync(websitePath)) {
        console.log(`Skipping restoration of deleted website: ${windowState.websiteName}`);
        continue; // Skip this state and don't add to validWindowStates
      }

      // Restore the website window
      await restoreWebsiteWindow(windowState);

      // If restoration succeeded, keep this state
      validWindowStates.push(windowState);

      // Calculate optimal bounds immediately for tests to detect monitor manager calls
      const finalBounds = calculateOptimalWindowBounds(windowState);

      // Restore window bounds and maximized state after a delay to ensure the window is ready
      setTimeout(() => {
        const websiteWindow = websiteWindows.get(windowState.websiteName);
        if (websiteWindow && !websiteWindow.window.isDestroyed()) {
          if (windowState.isMaximized) {
            websiteWindow.window.maximize();
          } else if (finalBounds) {
            websiteWindow.window.setBounds(finalBounds);
          }
        }
      }, 1000);
    } catch (error) {
      console.error(`Failed to restore window for ${windowState.websiteName}:`, error);
      // Don't add failed states to validWindowStates
    }
  }

  // Update the stored window states to remove invalid ones
  if (validWindowStates.length !== windowStates.length) {
    console.log(`Cleaned up ${windowStates.length - validWindowStates.length} invalid window states`);
    store.saveWindowStates(validWindowStates);
  }

  // Show start screen if no valid windows were restored
  if (websiteWindows.size === 0) {
    showStartScreenIfNeeded();
  }
}

/**
 * Restore a single website window.
 */
async function restoreWebsiteWindow(windowState: WindowState): Promise<void> {
  try {
    // Get the website path (directory existence already verified by caller)
    let websitePath = windowState.websitePath;
    if (!websitePath) {
      const appContext = getGlobalContext();
      const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
      websitePath = await websiteManager.execute(async (service) => {
        return service.getWebsitePath(windowState.websiteName);
      });
    }

    // Create the appropriate window type
    if (windowState.windowType === 'editor') {
      // Import the window-manager module to access React editor (default)
      const { openReactWebsiteEditorWindow } = await import('./window-manager');
      openReactWebsiteEditorWindow(windowState.websiteName, websitePath);
    } else {
      // Default to preview window (backward compatibility)
      createWebsiteWindow(windowState.websiteName, websitePath);

      try {
        // Start individual server for this restored website
        await startWebsiteServerAndUpdateWindow(windowState.websiteName, websitePath);
      } catch (serverError) {
        console.error(
          `Failed to start server for ${windowState.websiteName}, window will show fallback content:`,
          serverError
        );
        // Don't throw - let the window exist with fallback content rather than failing completely
      }
    }
  } catch (error) {
    console.error(`Failed to restore website window for ${windowState.websiteName}:`, error);
    throw error;
  }
}

/**
 * Gracefully closes all open windows (website windows) and saves their states.
 * Enhanced with timeout protection to prevent fsevents race condition crashes.
 */
export async function closeAllWindows(): Promise<void> {
  console.log('[CloseWindows] Starting graceful shutdown of all windows...');

  // Note: Window states are now saved earlier in main.ts before cleanup begins

  // Use the DI-based orchestrator to stop all servers
  try {
    const appContext = getGlobalContext();
    const orchestrator = appContext.getService<IWebsiteOrchestrator>(ServiceKeys.WEBSITE_ORCHESTRATOR);

    console.log('[CloseWindows] Stopping all website servers via orchestrator...');

    // Add timeout protection specifically for server/file watcher cleanup
    // This prevents the fsevents race condition by ensuring we don't wait
    // indefinitely for file watcher cleanup
    await Promise.race([
      orchestrator.shutdownAll(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Server shutdown timeout - preventing fsevents race condition'));
        }, 4000); // 4 second timeout for server cleanup
      }),
    ]);

    console.log('[CloseWindows] All servers stopped successfully via orchestrator');
  } catch (error) {
    console.error('[CloseWindows] Error stopping servers during shutdown (continuing with window closure):', error);
    // Continue with window closure even if server shutdown fails
    // This prevents the app from hanging if fsevents cleanup is stuck
  }

  // Close all windows
  console.log(`[CloseWindows] Closing ${websiteWindows.size} windows...`);
  websiteWindows.forEach((websiteWindow) => {
    if (!websiteWindow.window.isDestroyed()) {
      websiteWindow.window.close();
    }
  });

  websiteWindows.clear();
  console.log('[CloseWindows] All windows closed');
}

// Start screen window instance declared at top of file

/**
 * Create and show the start screen window.
 */
export function createStartScreen(): BrowserWindow {
  if (startScreenWindow && !startScreenWindow.isDestroyed()) {
    startScreenWindow.focus();
    return startScreenWindow;
  }

  startScreenWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Anglesite',
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  // Load the start screen template
  const startScreenDataUrl = loadTemplateAsDataUrl('start-screen');
  startScreenWindow.loadURL(startScreenDataUrl);

  startScreenWindow.once('ready-to-show', () => {
    if (startScreenWindow && !startScreenWindow.isDestroyed()) {
      themeManager.applyThemeToWindow(startScreenWindow);
      startScreenWindow.show();
      startScreenWindow.focus();
    }
  });

  startScreenWindow.on('closed', () => {
    startScreenWindow = null;
  });

  return startScreenWindow;
}

/**
 * Close the start screen window if it exists.
 */
export function closeStartScreen(): void {
  if (startScreenWindow && !startScreenWindow.isDestroyed()) {
    startScreenWindow.close();
  }
  startScreenWindow = null;
}

/**
 * Get the current start screen window.
 */
export function getStartScreen(): BrowserWindow | null {
  return startScreenWindow && !startScreenWindow.isDestroyed() ? startScreenWindow : null;
}

/**
 * Show the start screen if no windows are open and it's appropriate to do so.
 */
export function showStartScreenIfNeeded(): void {
  // Only show start screen if no website windows are open and no start screen is already showing
  if (websiteWindows.size === 0 && !getStartScreen()) {
    createStartScreen();
  }
}

/**
 * Add a website editor window to the tracking system.
 * This allows the editor window to be included in window state persistence.
 */
export function addWebsiteEditorWindow(
  websiteName: string,
  window: BrowserWindow,
  webContentsView: WebContentsView,
  websitePath?: string
): void {
  const websiteWindow: WebsiteWindow = {
    window,
    webContentsView,
    websiteName,
    websitePath,
    // Mark this as an editor window for proper restoration
    isEditorWindow: true,
  };
  websiteWindows.set(websiteName, websiteWindow);

  // Close start screen since we now have a website window
  closeStartScreen();
}

/**
 * Remove a website editor window from the tracking system.
 */
export function removeWebsiteEditorWindow(websiteName: string): void {
  websiteWindows.delete(websiteName);

  // Show start screen if no windows remain
  showStartScreenIfNeeded();
}

/**
 * Toggle DevTools for the currently focused window (website window).
 */
export async function togglePreviewDevTools(): Promise<void> {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    return;
  }

  // Check if it's a website window
  for (const [, websiteWindow] of Array.from(websiteWindows)) {
    if (websiteWindow.window === focusedWindow) {
      const webContents = websiteWindow.webContentsView.webContents;
      if (webContents.isDevToolsOpened()) {
        webContents.closeDevTools();
      } else {
        webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }
  }
}

/**
 * Check if a website window is currently focused.
 */
export function isWebsiteEditorFocused(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return false;

  // Check if the focused window is any website window
  for (const [, websiteWindow] of Array.from(websiteWindows)) {
    if (websiteWindow.window === focusedWindow) {
      return true;
    }
  }
  return false;
}

/**
 * Get the name of the currently focused website project.
 */
export function getCurrentWebsiteEditorProject(): string | null {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return null;

  // Find the website name for the focused window
  for (const [websiteName, websiteWindow] of Array.from(websiteWindows)) {
    if (websiteWindow.window === focusedWindow) {
      return websiteName;
    }
  }
  return null;
}

/**
 * Show the WebContentsView for preview mode.
 */
export function showWebsitePreview(websiteName: string): void {
  const websiteWindow = websiteWindows.get(websiteName);
  if (websiteWindow && !websiteWindow.window.isDestroyed()) {
    websiteWindow.webContentsView.setVisible(true);
  } else {
    console.error(`Website window not found for preview show: ${websiteName}`);
  }
}

/**
 * Hide the WebContentsView for edit mode.
 */
export function hideWebsitePreview(websiteName: string): void {
  const websiteWindow = websiteWindows.get(websiteName);
  if (websiteWindow && !websiteWindow.window.isDestroyed()) {
    websiteWindow.webContentsView.setVisible(false);
  } else {
    console.error(`Website window not found for preview hide: ${websiteName}`);
  }
}

/**
 * Get the help window instance.
 */
export function getHelpWindow(): BrowserWindow | null {
  return helpWindow;
}

/**
 * Create and show the help window.
 */
export function createHelpWindow(): BrowserWindow {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return helpWindow;
  }

  helpWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
    },
  });

  helpWindow.setTitle('Anglesite');

  // Clean up reference when window is closed
  helpWindow.on('closed', () => {
    helpWindow = null;
  });

  helpWindow.show();
  return helpWindow;
}
