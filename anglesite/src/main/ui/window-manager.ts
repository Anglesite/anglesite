/**
 * @file Window and WebContentsView management.
 */
import { BrowserWindow, ipcMain, WebContentsView, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { themeManager } from './theme-manager';
import { loadTemplateAsDataUrl } from './template-loader';
import {
  getAllWebsiteWindows,
  addWebsiteEditorWindow,
  removeWebsiteEditorWindow,
  saveWindowStates,
} from './multi-window-manager';
import { updateApplicationMenu } from './menu';

let settingsWindow: BrowserWindow | null = null;
let aboutWindow: BrowserWindow | null = null;

/**
 * Get build number based on git hash and working tree status.
 * @returns Build number string (git hash + dirty indicator if applicable)
 */
function getBuildNumber(): string {
  try {
    // Get short git hash
    const gitHash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      cwd: process.cwd(),
    }).trim();

    // Check if working tree is dirty
    const isDirty =
      execSync('git diff --quiet || echo "dirty"', {
        encoding: 'utf8',
        cwd: process.cwd(),
      }).trim() === 'dirty';

    return isDirty ? `${gitHash}-dirty` : gitHash;
  } catch (error) {
    console.warn('Failed to get git build number:', error);
    return 'dev-build';
  }
}

// Set up IPC handler for opening external URLs
ipcMain.on('open-external-url', (_event, url: string) => {
  shell.openExternal(url);
});

// Set up IPC handler for closing about window
ipcMain.on('close-about-window', () => {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.close();
  }
});
let websiteEditorWindow: BrowserWindow | null = null;
let websiteEditorWebContentsView: WebContentsView | null = null;
let currentWebsiteEditorProject: string | null = null;

/**
 * Toggle DevTools for the currently focused window.
 */
export async function togglePreviewDevTools(): Promise<void> {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    return;
  }

  // Use imported functions (previously dynamic import to avoid circular dependency)

  // Check if it's a website window
  const websiteWindows = getAllWebsiteWindows();
  for (const [, websiteWindow] of Array.from(websiteWindows)) {
    if (websiteWindow.window === focusedWindow) {
      const webContents = websiteWindow.webContentsView.webContents;
      if (webContents.isDevToolsOpened()) {
        webContents.closeDevTools();
      } else {
        webContents.openDevTools();
      }
      return;
    }
  }
}

/**
 * BagIt metadata collection result.
 */
export interface BagItMetadata {
  externalIdentifier: string;
  externalDescription: string;
  sourceOrganization: string;
  organizationAddress: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

/**
 * Show BagIt metadata collection dialog for archival export
 *
 * Creates a modal dialog that collects Dublin Core metadata required for BagIt
 * archival format. The dialog pre-fills the external identifier with the website
 * name and allows the user to enter additional preservation metadata.
 * @param websiteName Name of the website being exported (used as default identifier).
 * @returns Promise resolving to collected metadata object or null if cancelled.
 * @example
 * ```typescript
 * const metadata = await getBagItMetadata('my-website');
 * if (metadata) {
 *   // Use metadata for BagIt export
 *   console.log(metadata.externalIdentifier); // 'my-website'
 * }
 * ```
 */
export async function getBagItMetadata(websiteName: string): Promise<BagItMetadata | null> {
  return new Promise((resolve) => {
    const metadataWindow = new BrowserWindow({
      width: 500,
      height: 650,
      title: 'BagIt Archive Metadata',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      modal: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js'),
      },
    });

    const metadataDataUrl = loadTemplateAsDataUrl('bagit-metadata');
    metadataWindow.loadURL(metadataDataUrl);

    metadataWindow.once('ready-to-show', () => {
      if (metadataWindow && !metadataWindow.isDestroyed()) {
        themeManager.applyThemeToWindow(metadataWindow);
        metadataWindow.show();

        // Send default values to the dialog
        metadataWindow.webContents.send('bagit-metadata-defaults', {
          externalIdentifier: websiteName,
          externalDescription: '',
          sourceOrganization: '',
          organizationAddress: '',
          contactName: '',
          contactPhone: '',
          contactEmail: '',
        });
      }
    });

    const handleMetadataResult = (result: BagItMetadata | null) => {
      if (!metadataWindow.isDestroyed()) {
        metadataWindow.close();
      }
      resolve(result);
    };

    metadataWindow.on('closed', () => {
      resolve(null);
    });

    // Set up IPC listeners
    const handleDefaults = () => {
      if (!metadataWindow.isDestroyed()) {
        metadataWindow.webContents.send('bagit-metadata-defaults', {
          externalIdentifier: websiteName,
          externalDescription: '',
          sourceOrganization: '',
          organizationAddress: '',
          contactName: '',
          contactPhone: '',
          contactEmail: '',
        });
      }
    };

    const handleResult = (_event: unknown, result: BagItMetadata | null) => {
      ipcMain.removeListener('get-bagit-metadata-defaults', handleDefaults);
      ipcMain.removeListener('bagit-metadata-result', handleResult);
      handleMetadataResult(result);
    };

    ipcMain.on('get-bagit-metadata-defaults', handleDefaults);
    ipcMain.on('bagit-metadata-result', handleResult);
  });
}

/**
 * Get native input from user.
 */
export async function getNativeInput(title: string, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    // Create a simple input dialog window with nodeIntegration enabled for this specific use case
    const inputWindow = new BrowserWindow({
      width: 400,
      height: 200,
      title,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      modal: true,
      show: false, // Don't show immediately to prevent white flash
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js'),
      },
    });

    const inputDataUrl = loadTemplateAsDataUrl('input-dialog', {
      title,
      prompt,
    });

    inputWindow.loadURL(inputDataUrl);

    // Use ready-to-show event following Electron best practices
    inputWindow.once('ready-to-show', () => {
      if (inputWindow && !inputWindow.isDestroyed()) {
        // Apply current theme to the input window before showing
        themeManager.applyThemeToWindow(inputWindow);
        inputWindow.show();
      }
    });

    // Handle input result
    const handleInputResult = (result: string | null) => {
      inputWindow.close();
      resolve(result);
    };

    // Handle window close
    inputWindow.on('closed', () => {
      resolve(null);
    });

    // Set up IPC listener for the result
    const handleResult = (_event: unknown, result: string | null) => {
      ipcMain.removeListener('input-dialog-result', handleResult);
      handleInputResult(result);
    };
    ipcMain.on('input-dialog-result', handleResult);
  });
}

/**
 * Show first launch setup assistant for HTTPS/HTTP mode selection
 * Displays a modal dialog allowing users to choose between HTTPS (with CA installation)
 * or HTTP (simple) mode for local development.
 * @returns Promise resolving to "https", "http", or null if cancelled.
 */
export async function showFirstLaunchAssistant(): Promise<'https' | 'http' | null> {
  return new Promise((resolve) => {
    const assistantWindow = new BrowserWindow({
      width: 520,
      height: 480,
      title: 'Welcome to Anglesite',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      modal: true,
      show: false, // Don't show immediately to prevent white flash
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js'),
      },
    });

    // Load the HTML file
    const htmlFilePath = path.join(__dirname, '..', 'ui', 'first-launch.html');

    // Check if file exists
    if (fs.existsSync(htmlFilePath)) {
      assistantWindow.loadFile(htmlFilePath);
    } else {
      console.error('First launch HTML file not found at:', htmlFilePath);
      // Fall back to a simple HTML
      const welcomeDataUrl = loadTemplateAsDataUrl('welcome-assistant');
      assistantWindow.loadURL(welcomeDataUrl);
    }

    // Use ready-to-show event following Electron best practices
    assistantWindow.once('ready-to-show', () => {
      if (assistantWindow && !assistantWindow.isDestroyed()) {
        // Apply current theme to the first launch assistant before showing
        themeManager.applyThemeToWindow(assistantWindow);
        assistantWindow.show();
      }
    });

    // Handle window close
    assistantWindow.on('closed', () => {
      resolve(null);
    });

    // Set up IPC listener for the result
    const handleResult = (_event: unknown, result: 'https' | 'http' | null) => {
      ipcMain.removeListener('first-launch-result', handleResult);
      assistantWindow.close();
      resolve(result);
    };
    ipcMain.on('first-launch-result', handleResult);
  });
}

/**
 * Creates and displays a modal window for selecting and opening existing websites.
 */
export function openWebsiteSelectionWindow(): void {
  const websiteSelectionWindow = new BrowserWindow({
    width: 600,
    height: 500,
    title: 'Open Website',
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false, // Don't show immediately to prevent white flash
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  // Set up ready-to-show event handler before loading content
  websiteSelectionWindow.once('ready-to-show', () => {
    if (websiteSelectionWindow && !websiteSelectionWindow.isDestroyed()) {
      // Apply current theme to the website selection window before showing
      themeManager.applyThemeToWindow(websiteSelectionWindow);
      websiteSelectionWindow.show();
    }
  });

  const htmlFilePath = path.join(__dirname, '..', 'ui', 'website-selection.html');

  // Check if file exists, create fallback if not
  if (fs.existsSync(htmlFilePath)) {
    websiteSelectionWindow.loadFile(htmlFilePath);
  } else {
    const websiteSelectionDataUrl = loadTemplateAsDataUrl('website-selection');
    websiteSelectionWindow.loadURL(websiteSelectionDataUrl);
  }
}

/**
 * Creates and displays the application settings window, or focuses it if already open.
 */
export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 300,
    title: 'Settings',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false, // Don't show immediately to prevent white flash
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  const settingsDataUrl = loadTemplateAsDataUrl('settings');

  settingsWindow.loadURL(settingsDataUrl);

  // Use ready-to-show event following Electron best practices
  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      // Apply current theme to the settings window before showing
      themeManager.applyThemeToWindow(settingsWindow);
      settingsWindow.show();
    }
  });
}

/**
 * Opens the About window with app information and GeoCities Cyber Punk styling.
 */
export function openAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = new BrowserWindow({
    width: 500,
    height: 600,
    title: 'About Anglesite',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false, // Don't show immediately to prevent white flash
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  const aboutDataUrl = loadTemplateAsDataUrl('about', {
    BUILD_NUMBER: getBuildNumber(),
  });
  aboutWindow.loadURL(aboutDataUrl);

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  aboutWindow.once('ready-to-show', () => {
    if (aboutWindow && !aboutWindow.isDestroyed()) {
      // Apply current theme to the about window before showing (though it has its own styling)
      themeManager.applyThemeToWindow(aboutWindow);
      aboutWindow.show();
    }
  });
}

/**
 * Creates and displays the website editor window (React by default).
 */
export function openWebsiteEditorWindow(websiteName?: string, websitePath?: string): void {
  // Use React editor as the default
  openReactWebsiteEditorWindow(websiteName, websitePath);
}

/**
 * Creates and displays the vanilla website editor window with three-panel layout (legacy).
 */
export function openVanillaWebsiteEditorWindow(websiteName?: string, websitePath?: string): void {
  if (websiteEditorWindow && !websiteEditorWindow.isDestroyed()) {
    websiteEditorWindow.focus();
    return;
  }

  const windowTitle = websiteName ? websiteName : 'Website Editor';

  // Track the current website project
  currentWebsiteEditorProject = websiteName || null;

  websiteEditorWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: windowTitle,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false, // Don't show immediately to prevent white flash
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  // Create WebContentsView for preview
  websiteEditorWebContentsView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Add the WebContentsView to the window
  websiteEditorWindow.contentView.addChildView(websiteEditorWebContentsView);

  // Use vanilla website editor (legacy - React is now default)
  const editorDataUrl = loadTemplateAsDataUrl('website-editor');

  websiteEditorWindow.loadURL(editorDataUrl);

  // Handle window resize to reposition the WebContentsView
  websiteEditorWindow.on('resize', () => {
    if (websiteEditorWebContentsView && websiteEditorWindow) {
      positionPreviewWebContentsView();
    }
  });

  // Use ready-to-show event following Electron best practices
  websiteEditorWindow.once('ready-to-show', () => {
    if (websiteEditorWindow && !websiteEditorWindow.isDestroyed()) {
      // Apply current theme to the website editor window before showing
      themeManager.applyThemeToWindow(websiteEditorWindow);
      websiteEditorWindow.show();

      // Position the WebContentsView
      positionPreviewWebContentsView();

      // Update menu to reflect the new window state
      setTimeout(() => {
        updateApplicationMenu();
      }, 100);

      // If we have website information, send it to the renderer and add to tracking
      if (websiteName && websitePath) {
        // Add to tracking system for window state persistence
        if (websiteEditorWebContentsView) {
          addWebsiteEditorWindow(websiteName, websiteEditorWindow, websiteEditorWebContentsView, websitePath);
        }

        // Add a small delay to ensure the renderer is fully ready
        setTimeout(() => {
          if (websiteEditorWindow && !websiteEditorWindow.isDestroyed()) {
            websiteEditorWindow.webContents.send('load-website', {
              name: websiteName,
              path: websitePath,
            });
          }
        }, 100);
      }
    }
  });

  // Update menu when focus changes
  websiteEditorWindow.on('focus', () => {
    // Small delay to ensure window state is fully updated
    setTimeout(() => {
      updateApplicationMenu();
    }, 50);
  });

  websiteEditorWindow.on('blur', () => {
    updateApplicationMenu();
  });

  // Handle window close - save state and clean up
  websiteEditorWindow.on('closed', () => {
    // Save window states before cleanup (in case this is the last window)
    if (currentWebsiteEditorProject) {
      try {
        // Save current state before removing window
        saveWindowStates();

        // Now remove from tracking and show start screen if needed
        removeWebsiteEditorWindow(currentWebsiteEditorProject);
      } catch (error) {
        console.error('Error saving window state on close:', error);
        // Clean up anyway
        if (currentWebsiteEditorProject) {
          removeWebsiteEditorWindow(currentWebsiteEditorProject);
        }
      }
    }

    // Clean up local references
    websiteEditorWindow = null;
    websiteEditorWebContentsView = null;
    currentWebsiteEditorProject = null;
    updateApplicationMenu();
  });
}

/**
 * Position the preview WebContentsView in the center panel.
 */
function positionPreviewWebContentsView(): void {
  if (!websiteEditorWebContentsView || !websiteEditorWindow) {
    return;
  }

  const bounds = websiteEditorWindow.getBounds();

  // Calculate position for center panel
  // Left panel: 200px, toolbar: ~48px height, right panel: 200px
  const leftPanelWidth = 200;
  const toolbarHeight = 48;
  const rightPanelWidth = 200;

  const x = leftPanelWidth;
  const y = toolbarHeight;
  const width = bounds.width - leftPanelWidth - rightPanelWidth;
  const height = bounds.height - toolbarHeight;

  websiteEditorWebContentsView.setBounds({
    x,
    y,
    width,
    height,
  });
}

/**
 * Creates and displays a React-based website editor window.
 * This is the modern React implementation with schema-driven forms.
 */
export function openReactWebsiteEditorWindow(websiteName?: string, websitePath?: string): void {
  if (websiteEditorWindow && !websiteEditorWindow.isDestroyed()) {
    websiteEditorWindow.focus();
    return;
  }

  const windowTitle = websiteName ? `${websiteName} - React Editor` : 'React Website Editor';

  // Track the current website project
  currentWebsiteEditorProject = websiteName || null;

  websiteEditorWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: windowTitle,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false, // Don't show immediately to prevent white flash
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  // Create WebContentsView for preview (same as vanilla version)
  websiteEditorWebContentsView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Add the WebContentsView to the window
  websiteEditorWindow.contentView.addChildView(websiteEditorWebContentsView);

  // Load React-based template (check for dev mode)
  const isDevelopment = process.argv.includes('--dev-react');
  if (isDevelopment) {
    // Use webpack dev server for HMR
    websiteEditorWindow.loadURL('http://localhost:3000');
  } else {
    // Use webpack-built production bundle
    const bundlePath = path.resolve(__dirname, '../../dist/src/renderer/ui/react/index.html');

    if (fs.existsSync(bundlePath)) {
      websiteEditorWindow.loadFile(bundlePath);
    } else {
      throw new Error(`React bundle not found at ${bundlePath}. Run npm run build:react to generate the bundle.`);
    }
  }

  // Handle window resize to reposition the WebContentsView
  websiteEditorWindow.on('resize', () => {
    if (websiteEditorWebContentsView && websiteEditorWindow) {
      positionPreviewWebContentsView();
    }
  });

  // Use ready-to-show event following Electron best practices
  websiteEditorWindow.once('ready-to-show', () => {
    if (websiteEditorWindow && !websiteEditorWindow.isDestroyed()) {
      // Apply current theme to the website editor window before showing
      themeManager.applyThemeToWindow(websiteEditorWindow);
      websiteEditorWindow.show();

      // Position the WebContentsView
      positionPreviewWebContentsView();

      // Update menu to reflect the new window state
      setTimeout(() => {
        updateApplicationMenu();
      }, 100);

      // If we have website information, send it to the React renderer and add to tracking
      if (websiteName && websitePath) {
        // Add to tracking system for window state persistence
        if (websiteEditorWebContentsView) {
          addWebsiteEditorWindow(websiteName, websiteEditorWindow, websiteEditorWebContentsView, websitePath);
        }

        setTimeout(() => {
          if (websiteEditorWindow && !websiteEditorWindow.isDestroyed()) {
            websiteEditorWindow.webContents.send('load-website', {
              name: websiteName,
              path: websitePath,
            });
          }
        }, 100);
      }
    }
  });

  // Update menu when focus changes (same as vanilla version)
  websiteEditorWindow.on('focus', () => {
    setTimeout(() => {
      updateApplicationMenu();
    }, 50);
  });

  websiteEditorWindow.on('blur', () => {
    updateApplicationMenu();
  });

  // Handle window close - save state and clean up
  websiteEditorWindow.on('closed', () => {
    // Save window states before cleanup (in case this is the last window)
    if (currentWebsiteEditorProject) {
      try {
        // Save current state before removing window
        saveWindowStates();

        // Now remove from tracking and show start screen if needed
        removeWebsiteEditorWindow(currentWebsiteEditorProject);
      } catch (error) {
        console.error('Error saving window state on close:', error);
        // Clean up anyway
        if (currentWebsiteEditorProject) {
          removeWebsiteEditorWindow(currentWebsiteEditorProject);
        }
      }
    }

    // Clean up local references
    websiteEditorWindow = null;
    websiteEditorWebContentsView = null;
    currentWebsiteEditorProject = null;
    updateApplicationMenu();
  });
}

/**
 * Check if the website editor window is currently focused.
 */
export function isWebsiteEditorFocused(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  return !!(websiteEditorWindow && !websiteEditorWindow.isDestroyed() && websiteEditorWindow === focusedWindow);
}

/**
 * Get the name of the currently loaded website project in the website editor.
 */
export function getCurrentWebsiteEditorProject(): string | null {
  return currentWebsiteEditorProject;
}

/**
 * Load website content into the preview WebContentsView with retry logic.
 */
export async function loadWebsiteIntoPreview(serverUrl: string): Promise<void> {
  if (!websiteEditorWebContentsView) {
    throw new Error('Website editor preview WebContentsView not available');
  }

  const maxRetries = 10;
  let retryCount = 0;

  const tryLoad = async (): Promise<void> => {
    try {
      await websiteEditorWebContentsView!.webContents.loadURL(serverUrl);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_CONNECTION_REFUSED' &&
        retryCount < maxRetries
      ) {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return tryLoad();
      }
      console.error(`Failed to load preview URL after ${retryCount} retries: ${serverUrl}`, error);
      throw error;
    }
  };

  return tryLoad();
}
