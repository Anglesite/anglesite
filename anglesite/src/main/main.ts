/**
 * @file Main process of the Electron application (Refactored)
 * @see {@link https://www.electronjs.org/docs/latest/tutorial/quick-start}
 */
import { app, Menu, BrowserWindow } from 'electron';
// Import modular components
import { closeAllWindows, restoreWindowStates } from './ui/multi-window-manager';
import { createApplicationMenu } from './ui/menu';
import { setupIpcMainListeners } from './ipc/handlers';
// Store class removed - now using DI with IStore interface
import { handleFirstLaunch } from './utils/first-launch';
import { checkAndSuggestTouchIdSetup } from './dns/hosts-manager';
import { themeManager } from './ui/theme-manager';
import { initializeGlobalContext, shutdownGlobalContext, getGlobalContext } from './core/service-registry';
import { IStore } from './core/interfaces';
import { ServiceKeys } from './core/container';
import { logger, sanitize } from './utils/logging';

/**
 * Main window instance
 */
let mainWindow: BrowserWindow | null = null;

/**
 * App settings store
 */
let store: IStore;

/**
 * Set up global error handlers for the main process
 */
function setupGlobalErrorHandlers(errorReportingService: any): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error(`Uncaught exception in main process: ${sanitize.error(error)}`);
    errorReportingService
      .report(error, {
        type: 'uncaughtException',
        process: 'main',
      })
      .catch((reportError: Error) => {
        logger.error(`Failed to report uncaught exception: ${sanitize.error(reportError)}`);
      });
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error(`Unhandled promise rejection in main process: ${sanitize.error(reason)}`);
    errorReportingService
      .report(reason, {
        type: 'unhandledRejection',
        process: 'main',
        promise: promise.toString(),
      })
      .catch((reportError: Error) => {
        logger.error(`Failed to report unhandled rejection: ${sanitize.error(reportError)}`);
      });
  });

  logger.info('Global error handlers configured');
}

/**
 * Initialize the application.
 */
async function initializeApp(): Promise<void> {
  // Set application name
  app.setName('Anglesite');

  // Initialize DI container and global application context first
  await initializeGlobalContext();

  // Initialize app settings store from DI container
  const appContext = getGlobalContext();
  store = appContext.getService<IStore>(ServiceKeys.STORE);

  // Initialize error reporting service (skip in test environment)
  let errorReportingService: any = null;
  if (process.env.NODE_ENV !== 'test') {
    errorReportingService = appContext.getService(ServiceKeys.ERROR_REPORTING) as any;
    await errorReportingService.initialize();

    // Set up global error handlers
    setupGlobalErrorHandlers(errorReportingService);
  }

  // Initialize telemetry service (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    try {
      logger.info('Initializing telemetry service');
      const telemetryService = appContext.getService(ServiceKeys.TELEMETRY) as any;
      await telemetryService.initialize();

      // Enable telemetry in production by default (user can opt-out)
      if (process.env.NODE_ENV === 'production') {
        const telemetryEnabled = store.get('telemetryEnabled');
        if (telemetryEnabled !== false) {
          // Default to true if not explicitly disabled
          await telemetryService.configure({
            enabled: true,
            samplingRate: 1.0,
            anonymizeErrors: true,
          });
        }
      }

      logger.info('Telemetry service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize telemetry service: ${sanitize.error(error)}`);
      // Don't fail the app if telemetry fails to initialize
    }
  }

  // Initialize notification services
  try {
    logger.info('Initializing notification services');
    const { registerNotificationServices, initializeNotificationServices } = await import(
      './services/notification-service-registrar'
    );
    const { container } = await import('./core/container');

    // Register notification services in the DI container
    registerNotificationServices(container);

    // Initialize the services
    await initializeNotificationServices(container);

    logger.info('Notification services initialized successfully');
  } catch (error) {
    logger.error(`Failed to initialize notification services: ${sanitize.error(error)}`);
    // Don't fail the app if notification services fail to initialize
  }

  // Check if first launch is needed
  if (!store.get('firstLaunchCompleted')) {
    await handleFirstLaunch(store);
  }

  // Note: Help window is only created when explicitly requested by the user

  // Set up the application menu
  const menu = createApplicationMenu();
  Menu.setApplicationMenu(menu);

  // Setup IPC handlers
  setupIpcMainListeners();

  // Initialize window manager IPC handlers
  const { initializeWindowManagerIPC } = await import('./ui/window-manager');
  initializeWindowManagerIPC();

  // Initialize theme manager
  themeManager.initialize();

  // Note: Hosts file cleanup moved to manual menu option to avoid permission dialogs on startup

  // Check Touch ID setup and provide helpful information
  await checkAndSuggestTouchIdSetup();

  // Initialize server manager event listeners now that DI is ready
  const { setupServerManagerEventListeners } = await import('./ui/multi-window-manager');
  setupServerManagerEventListeners();

  // Restore previously open website windows
  await restoreWindowStates();

  // Note: Help window is now only created when explicitly requested by the user
}

/**
 * App event handlers
 */
app.whenReady().then(() => {
  initializeApp();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
      initializeApp();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up resources when the app is about to quit
app.on('before-quit', async () => {
  console.log('[Quit] Starting application shutdown...');

  try {
    // CRITICAL: Save window states FIRST, before any cleanup that might timeout
    console.log('[Quit] Saving window states before cleanup...');
    const { saveWindowStates } = await import('./ui/multi-window-manager');
    saveWindowStates();

    // Force save any pending settings changes (including the window states we just saved)
    if (store) {
      console.log('[Quit] Saving application state...');
      await store.forceSave();
    }

    // Close all windows with timeout protection to prevent fsevents race condition
    console.log('[Quit] Closing windows and stopping servers...');
    await Promise.race([
      closeAllWindows(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Window cleanup timeout')), 5000)),
    ]);

    console.log('[Quit] Shutting down services...');
    // Shutdown DI container and services with timeout protection
    await Promise.race([
      shutdownGlobalContext(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service shutdown timeout')), 3000)),
    ]);

    console.log('[Quit] Application shutdown completed successfully');
  } catch (error) {
    console.error('[Quit] Error during shutdown, forcing exit:', error);
    // Don't block quit even if cleanup fails - this prevents hanging
    // The timeout ensures we don't wait indefinitely for fsevents cleanup
  }
});

// Handle certificate errors ONLY for development
app.on('certificate-error', (event, _webContents, url, error, certificate, callback) => {
  // SECURITY: Only allow self-signed certificates for local development in non-production
  if (
    process.env.NODE_ENV !== 'production' &&
    (url.includes('localhost') || url.includes('.test') || url.includes('127.0.0.1'))
  ) {
    logger.warn('[DEV] Accepting self-signed certificate for local development', {
      url: sanitize.path(url),
      fingerprint: certificate?.fingerprint || 'N/A',
    });
    event.preventDefault();
    callback(true);
  } else {
    // SECURITY: Reject all invalid certificates in production or for external domains
    logger.error('[SECURITY] Certificate error rejected for external domain', {
      domain: sanitize.path(url),
      error: sanitize.error(error),
    });
    callback(false);
  }
});

// SECURITY: Only disable certificate validation in development for local domains
if (process.env.NODE_ENV !== 'production') {
  console.warn('[DEV] Certificate validation relaxed for local development');
  app.commandLine.appendSwitch('--ignore-certificate-errors-spki-list');
  app.commandLine.appendSwitch('--ignore-certificate-errors');
  app.commandLine.appendSwitch('--ignore-ssl-errors');
}

// Suppress Node.js deprecation warnings in development
if (process.env.NODE_ENV !== 'production') {
  process.removeAllListeners('warning');
}

export { mainWindow };
