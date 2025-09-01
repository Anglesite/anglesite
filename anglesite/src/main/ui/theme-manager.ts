/**
 * @file Theme management for Anglesite application.
 * Handles system theme detection, user preferences, and theme application across windows.
 */
import { BrowserWindow, nativeTheme, ipcMain } from 'electron';
import { IStore } from '../core/interfaces';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';

export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/**
 * Theme manager singleton for handling application theming.
 */
class ThemeManager {
  private store: IStore | null = null;
  private currentResolvedTheme: ResolvedTheme = 'light';
  private initialized = false;

  constructor() {
    // Don't initialize anything in constructor - wait for initialize() call
  }

  /**
   * Initialize theme manager and set up IPC handlers.
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Initialize store from DI container
    this.store = getGlobalContext().getService<IStore>(ServiceKeys.STORE);

    // Initialize theme system
    this.initializeNativeTheme();
    this.setupSystemThemeListener();
    this.updateResolvedTheme();
    this.setupIpcHandlers();
    this.initialized = true;
  }

  /**
   * Initialize nativeTheme.themeSource based on stored preference.
   */
  private initializeNativeTheme(): void {
    const userTheme = this.getUserThemePreference();
    if (userTheme === 'light') {
      nativeTheme.themeSource = 'light';
    } else if (userTheme === 'dark') {
      nativeTheme.themeSource = 'dark';
    } else {
      nativeTheme.themeSource = 'system';
    }
  }

  /**
   * Set up system theme change listener.
   */
  private setupSystemThemeListener(): void {
    nativeTheme.on('updated', () => {
      this.updateResolvedTheme();
    });
  }

  /**
   * Set up IPC handlers for theme management.
   */
  private setupIpcHandlers(): void {
    ipcMain.handle('get-current-theme', () => {
      return {
        userPreference: this.getUserThemePreference(),
        resolvedTheme: this.currentResolvedTheme,
        systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      };
    });

    ipcMain.handle('set-theme', (_event, theme: Theme) => {
      this.setTheme(theme);
      return {
        userPreference: theme,
        resolvedTheme: this.currentResolvedTheme,
        systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      };
    });
  }

  /**
   * Get the current user theme preference.
   */
  getUserThemePreference(): Theme {
    if (!this.store) {
      return 'system'; // Default theme before initialization
    }
    return this.store.get('theme');
  }

  /**
   * Get the currently resolved theme (light or dark).
   */
  getResolvedTheme(): ResolvedTheme {
    return this.currentResolvedTheme;
  }

  /**
   * Set the theme preference.
   */
  setTheme(theme: Theme): void {
    if (!this.store) {
      console.warn('ThemeManager not initialized, cannot set theme');
      return;
    }
    this.store.set('theme', theme);

    // Set nativeTheme.themeSource according to Electron best practices
    if (theme === 'light') {
      nativeTheme.themeSource = 'light';
    } else if (theme === 'dark') {
      nativeTheme.themeSource = 'dark';
    } else {
      nativeTheme.themeSource = 'system';
    }

    this.updateResolvedTheme();
  }

  /**
   * Update the resolved theme based on user preference and system theme.
   */
  private updateResolvedTheme(): void {
    const userPreference = this.getUserThemePreference();
    const systemIsDark = nativeTheme.shouldUseDarkColors;

    let newResolvedTheme: ResolvedTheme;

    switch (userPreference) {
      case 'light':
        newResolvedTheme = 'light';
        break;
      case 'dark':
        newResolvedTheme = 'dark';
        break;
      case 'system':
      default:
        newResolvedTheme = systemIsDark ? 'dark' : 'light';
        break;
    }

    if (newResolvedTheme !== this.currentResolvedTheme) {
      this.currentResolvedTheme = newResolvedTheme;
      this.applyThemeToAllWindows();
    }
  }

  /**
   * Apply the current theme to all open windows.
   */
  private applyThemeToAllWindows(): void {
    const allWindows = BrowserWindow.getAllWindows();

    for (const window of allWindows) {
      if (!window.isDestroyed()) {
        this.applyThemeToWindow(window);
      }
    }
  }

  /**
   * Apply theme to a specific window.
   */
  applyThemeToWindow(window: BrowserWindow): void {
    if (window.isDestroyed()) return;

    // Apply theme immediately with executeJavaScript to prevent flash
    const themeScript = `
      (function() {
        const theme = '${this.currentResolvedTheme}';
        if (theme === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
          
          // FORCE DARK THEME BY SETTING INLINE STYLES DIRECTLY
          const topBar = document.querySelector('.top-bar');
          if (topBar) {
            topBar.style.backgroundColor = '#2d2d2d';
            topBar.style.borderBottomColor = '#404040';
            topBar.style.color = '#ffffff';
          }
          
          const browserBar = document.querySelector('.browser-bar');
          if (browserBar) {
            browserBar.style.backgroundColor = '#252525';
            browserBar.style.borderBottomColor = '#353535';
            browserBar.style.color = '#ffffff';
          }
          
          const buttons = document.querySelectorAll('button');
          buttons.forEach(button => {
            button.style.backgroundColor = '#2d2d2d';
            button.style.borderColor = '#404040';
            button.style.color = '#ffffff';
          });
          
          const siteTitle = document.querySelector('.site-title');
          if (siteTitle) {
            siteTitle.style.color = '#ffffff';
          }
          
          const urlDisplay = document.querySelector('.url-display');
          if (urlDisplay) {
            urlDisplay.style.backgroundColor = '#1e1e1e';
            urlDisplay.style.borderColor = '#404040';
            urlDisplay.style.color = '#b3b3b3';
          }
        } else {
          document.documentElement.removeAttribute('data-theme');
          
          // Remove inline styles for light theme
          const elements = document.querySelectorAll('.top-bar, .browser-bar, button, .site-title, .url-display');
          elements.forEach(element => {
            element.style.backgroundColor = '';
            element.style.borderBottomColor = '';
            element.style.borderColor = '';
            element.style.color = '';
          });
        }
      })();
    `;

    // Execute the theme script immediately when webContents is ready
    try {
      if (typeof window.webContents.isLoading === 'function' && window.webContents.isLoading()) {
        window.webContents.once('dom-ready', () => {
          window.webContents.executeJavaScript(themeScript).catch(console.error);
        });
      } else {
        window.webContents.executeJavaScript(themeScript).catch(console.error);
      }
    } catch (error) {
      // Fallback for environments where executeJavaScript might not be available (like tests)
      console.log('Could not execute immediate theme script:', error);
    }

    // Also send theme update to renderer process for proper theme management
    window.webContents.send('theme-updated', {
      userPreference: this.getUserThemePreference(),
      resolvedTheme: this.currentResolvedTheme,
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    });
  }

  /**
   * Get system theme information.
   */
  getSystemThemeInfo() {
    return {
      userPreference: this.getUserThemePreference(),
      resolvedTheme: this.currentResolvedTheme,
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    };
  }
}

// Export singleton instance
export const themeManager = new ThemeManager();
