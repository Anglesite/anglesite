/**
 * @file DiagnosticsWindowManager - Manages the diagnostics window lifecycle
 * @description Handles creation, state management, and lifecycle of the error diagnostics window
 */
import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import { IStore } from '../core/interfaces';

/**
 * Window preferences for diagnostics window
 */
export interface DiagnosticsWindowPreferences {
  autoShow?: boolean;
  stayOnTop?: boolean;
  defaultWidth?: number;
  defaultHeight?: number;
}

/**
 * Window bounds for state persistence
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Diagnostics window manager for handling error diagnostics UI window
 */
export class DiagnosticsWindowManager {
  private window: BrowserWindow | null = null;

  constructor(private storeService: IStore) {}

  /**
   * Create or show the diagnostics window
   */
  async createOrShowWindow(): Promise<BrowserWindow> {
    // Return existing window if it exists and isn't destroyed
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isVisible()) {
        this.window.focus();
      } else {
        this.window.show();
      }
      return this.window;
    }

    // Create new window
    this.window = await this.createWindow();
    this.setupWindowEventHandlers();
    this.restoreWindowState();

    // Show window
    this.window.show();

    return this.window;
  }

  /**
   * Create the diagnostics BrowserWindow
   */
  private async createWindow(): Promise<BrowserWindow> {
    const preferences = this.getWindowPreferences();

    const window = new BrowserWindow({
      width: preferences.defaultWidth || 1200,
      height: preferences.defaultHeight || 800,
      minWidth: 800,
      minHeight: 600,
      title: 'Website Diagnostics',
      show: false, // Don't show immediately
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    });

    // Load the webpack-processed diagnostics HTML file from react folder
    // The HTML must be in the same directory as the bundled scripts for relative paths to work
    const htmlPath = path.join(__dirname, '../../renderer/ui/react/diagnostics.html');
    await window.loadFile(htmlPath);

    return window;
  }

  /**
   * Setup window event handlers
   */
  private setupWindowEventHandlers(): void {
    if (!this.window) return;

    // Save window bounds before closing
    this.window.on('close', () => {
      this.saveWindowState();
    });

    // Clear window reference when closed
    this.window.on('closed', () => {
      this.window = null;
    });

    // Handle window ready
    this.window.once('ready-to-show', () => {
      if (this.window) {
        this.window.show();
      }
    });

    // Setup web contents event handlers
    this.window.webContents.on('did-finish-load', () => {
      // Send initial configuration to renderer
      this.sendInitialConfiguration();
    });
  }

  /**
   * Send initial configuration to the renderer process
   */
  private sendInitialConfiguration(): void {
    if (!this.window) return;

    const preferences = this.getWindowPreferences();

    this.window.webContents.send('diagnostics-config', {
      preferences,
      windowId: this.window.id,
    });
  }

  /**
   * Restore window state from store
   */
  private restoreWindowState(): void {
    if (!this.window) return;

    const settings = this.storeService.getAll();
    const diagnosticsSettings = (settings as any)?.diagnostics;

    if (diagnosticsSettings?.windowBounds) {
      const bounds = diagnosticsSettings.windowBounds as WindowBounds;
      this.window.setBounds(bounds);
    }
  }

  /**
   * Save window state to store
   */
  private saveWindowState(): void {
    if (!this.window || this.window.isDestroyed()) return;

    const bounds = this.window.getBounds();
    const settings = this.storeService.getAll();

    const updatedSettings = {
      ...settings,
      diagnostics: {
        ...(settings as any)?.diagnostics,
        windowBounds: bounds,
      },
    };

    this.storeService.setAll(updatedSettings as any);
  }

  /**
   * Get window preferences from store
   */
  getWindowPreferences(): DiagnosticsWindowPreferences {
    const settings = this.storeService.getAll();
    const diagnosticsSettings = (settings as any)?.diagnostics?.windowPreferences || {};

    return {
      autoShow: diagnosticsSettings.autoShow ?? false,
      stayOnTop: diagnosticsSettings.stayOnTop ?? false,
      defaultWidth: diagnosticsSettings.defaultWidth ?? 1200,
      defaultHeight: diagnosticsSettings.defaultHeight ?? 800,
    };
  }

  /**
   * Update window preferences in store
   */
  updateWindowPreferences(preferences: Partial<DiagnosticsWindowPreferences>): void {
    const current = this.getWindowPreferences();
    const settings = this.storeService.getAll();

    const updatedSettings = {
      ...settings,
      diagnostics: {
        ...(settings as any)?.diagnostics,
        windowPreferences: {
          ...current,
          ...preferences,
        },
      },
    };

    this.storeService.setAll(updatedSettings as any);
  }

  /**
   * Check if diagnostics window is currently open
   */
  isWindowOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /**
   * Get the diagnostics window instance
   */
  getWindow(): BrowserWindow | null {
    return this.isWindowOpen() ? this.window : null;
  }

  /**
   * Close the diagnostics window
   */
  closeWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
  }

  /**
   * Hide the diagnostics window
   */
  hideWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /**
   * Focus the diagnostics window
   */
  focusWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isVisible()) {
        this.window.focus();
      } else {
        this.window.show();
      }
    }
  }

  /**
   * Send data to the diagnostics renderer process
   */
  sendToRenderer(channel: string, data: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }

  /**
   * Toggle window visibility
   */
  toggleWindow(): void {
    if (this.isWindowOpen()) {
      if (this.window!.isVisible()) {
        this.hideWindow();
      } else {
        this.window!.show();
      }
    }
  }

  /**
   * Dispose of the window manager
   */
  dispose(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  /**
   * Get window statistics for debugging
   */
  getWindowStats(): {
    isOpen: boolean;
    isVisible: boolean;
    bounds: WindowBounds | null;
    preferences: DiagnosticsWindowPreferences;
  } {
    return {
      isOpen: this.isWindowOpen(),
      isVisible: this.window?.isVisible() ?? false,
      bounds: this.window && !this.window.isDestroyed() ? this.window.getBounds() : null,
      preferences: this.getWindowPreferences(),
    };
  }
}
