/**
 * @file Renderer-side theme management for Anglesite
 * Handles theme application in the renderer process
 */

/* eslint-env browser */

export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeInfo {
  userPreference: Theme;
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
}

/**
 * Renderer-side theme manager
 */
class ThemeRenderer {
  private currentTheme: ResolvedTheme = 'light';

  /**
   * Sets up theme management by loading current theme from main process and setting up listeners.
   */
  async initialize(): Promise<void> {
    // Get initial theme from main process
    try {
      const theme = await window.electronAPI?.getCurrentTheme();
      this.applyTheme(theme as ResolvedTheme);

      // Listen for theme updates from main process
      window.electronAPI?.onThemeUpdated((...args: unknown[]) => {
        const theme = args[0] as string;
        this.applyTheme(theme as ResolvedTheme);
      });
    } catch (error) {
      console.error('Failed to initialize theme:', error);
      // Fallback to light theme
      this.applyTheme('light');
    }
  }

  /**
   * Apply theme to the document.
   */
  private applyTheme(theme: ResolvedTheme): void {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }

    this.currentTheme = theme;
  }

  /**
   * Get the currently applied theme.
   */
  getCurrentTheme(): ResolvedTheme {
    return this.currentTheme;
  }

  /**
   * Set theme preference (for settings UI).
   */
  async setTheme(theme: Theme): Promise<string> {
    try {
      await window.electronAPI?.setTheme(theme);
      return theme;
    } catch (error) {
      console.error('Failed to set theme:', error);
      throw error;
    }
  }

  /**
   * Get current theme info (for settings UI).
   */
  async getThemeInfo(): Promise<string> {
    try {
      return (await window.electronAPI?.getCurrentTheme()) || 'light';
    } catch (error) {
      console.error('Failed to get theme info:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const themeRenderer = new ThemeRenderer();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    themeRenderer.initialize();
  });
} else {
  themeRenderer.initialize();
}
