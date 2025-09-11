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
import { cleanupHostsFile, checkAndSuggestTouchIdSetup } from './dns/hosts-manager';
import { themeManager } from './ui/theme-manager';
import { initializeGlobalContext, shutdownGlobalContext, getGlobalContext } from './core/service-registry';
import { IStore } from './core/interfaces';
import { ServiceKeys } from './core/container';

// Set application name as early as possible
app.setName('Anglesite');

/**
 * Main window instance
 */
let mainWindow: BrowserWindow | null = null;

/**
 * App settings store
 */
let store: IStore;

/**
 * Initialize the application.
 */
async function initializeApp(): Promise<void> {
  // Initialize DI container and global application context first
  await initializeGlobalContext();

  // Initialize app settings store from DI container
  const appContext = getGlobalContext();
  store = appContext.getService<IStore>(ServiceKeys.STORE);

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

// Handle certificate errors for development
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  // Allow self-signed certificates for local development
  if (url.includes('localhost') || url.includes('.test')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Disable web security for development (allows self-signed certs)
app.commandLine.appendSwitch('--ignore-certificate-errors-spki-list');
app.commandLine.appendSwitch('--ignore-certificate-errors');
app.commandLine.appendSwitch('--ignore-ssl-errors');

// Suppress Node.js deprecation warnings in development
if (process.env.NODE_ENV !== 'production') {
  process.removeAllListeners('warning');
}

export { mainWindow };
