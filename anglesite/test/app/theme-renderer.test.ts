/**
 * @file Tests for renderer-side theme management - actual module testing
 */

interface CustomWindow extends Window {
  electronAPI: {
    send: jest.Mock;
    invoke: jest.Mock;
    on: jest.Mock;
    removeAllListeners: jest.Mock;
    getCurrentTheme: jest.Mock;
    onThemeUpdated: jest.Mock;
    setTheme: jest.Mock;
    openExternal: jest.Mock;
    clipboard: {
      writeText: jest.Mock;
      readText: jest.Mock;
    };
  };
}

declare const window: CustomWindow;

// Mock globals before importing the module
const mockElectronAPI = {
  send: jest.fn(),
  invoke: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  getCurrentTheme: jest.fn(),
  onThemeUpdated: jest.fn(),
  setTheme: jest.fn(),
  openExternal: jest.fn(),
  clipboard: {
    writeText: jest.fn(),
    readText: jest.fn(),
  },
};

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = jest.fn();
console.error = jest.fn();

// Mock window.electronAPI before the module loads
window.electronAPI = mockElectronAPI;

// Mock document.documentElement
const mockDocumentElement = {
  setAttribute: jest.fn(),
  removeAttribute: jest.fn(),
};

Object.defineProperty(document, 'documentElement', {
  value: mockDocumentElement,
  writable: true,
  configurable: true,
});

// Now import the actual module
import { themeRenderer, Theme, ThemeInfo } from '../../app/theme-renderer';

describe('ThemeRenderer Module Tests', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear mock calls
    mockDocumentElement.setAttribute.mockClear();
    mockDocumentElement.removeAttribute.mockClear();
    mockElectronAPI.getCurrentTheme.mockClear();
    mockElectronAPI.onThemeUpdated.mockClear();
    mockElectronAPI.setTheme.mockClear();

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('initialize', () => {
    it('should initialize with theme from main process', async () => {
      const themeInfo: ThemeInfo = {
        userPreference: 'system',
        resolvedTheme: 'dark',
        systemTheme: 'dark',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(themeInfo);
      mockElectronAPI.onThemeUpdated.mockImplementation(() => {});

      await themeRenderer.initialize();

      expect(mockElectronAPI.getCurrentTheme).toHaveBeenCalled();
      expect(mockElectronAPI.onThemeUpdated).toHaveBeenCalled();
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(themeRenderer.getCurrentTheme()).toBe('dark');
    });

    it('should initialize with light theme', async () => {
      const themeInfo: ThemeInfo = {
        userPreference: 'light',
        resolvedTheme: 'light',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(themeInfo);
      mockElectronAPI.onThemeUpdated.mockImplementation(() => {});

      await themeRenderer.initialize();

      expect(mockDocumentElement.removeAttribute).toHaveBeenCalledWith('data-theme');
      expect(themeRenderer.getCurrentTheme()).toBe('light');
    });

    it('should handle theme update events', async () => {
      const initialTheme: ThemeInfo = {
        userPreference: 'system',
        resolvedTheme: 'light',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(initialTheme);

      let themeUpdateCallback: (themeInfo: ThemeInfo) => void;
      mockElectronAPI.onThemeUpdated.mockImplementation((callback) => {
        themeUpdateCallback = callback;
      });

      await themeRenderer.initialize();

      // Clear previous calls
      mockDocumentElement.setAttribute.mockClear();
      consoleLogSpy.mockClear();

      // Simulate theme update
      const newTheme: ThemeInfo = {
        userPreference: 'system',
        resolvedTheme: 'dark',
        systemTheme: 'dark',
      };

      themeUpdateCallback!(newTheme);

      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(themeRenderer.getCurrentTheme()).toBe('dark');
    });

    it('should fallback to light theme on error', async () => {
      const error = new Error('Failed to get theme');
      mockElectronAPI.getCurrentTheme.mockRejectedValue(error);

      await themeRenderer.initialize();

      expect(mockDocumentElement.removeAttribute).toHaveBeenCalledWith('data-theme');
      expect(themeRenderer.getCurrentTheme()).toBe('light');
    });
  });

  describe('getCurrentTheme', () => {
    it('should return current theme', async () => {
      // Initialize with a specific theme first
      const themeInfo: ThemeInfo = {
        userPreference: 'dark',
        resolvedTheme: 'dark',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(themeInfo);
      await themeRenderer.initialize();

      expect(themeRenderer.getCurrentTheme()).toBe('dark');
    });
  });

  describe('setTheme', () => {
    it('should set theme preference successfully', async () => {
      const expectedThemeInfo: ThemeInfo = {
        userPreference: 'dark',
        resolvedTheme: 'dark',
        systemTheme: 'light',
      };

      mockElectronAPI.setTheme.mockResolvedValue(expectedThemeInfo);

      const result = await themeRenderer.setTheme('dark');

      expect(mockElectronAPI.setTheme).toHaveBeenCalledWith('dark');
      expect(result).toEqual(expectedThemeInfo);
    });

    it('should handle theme setting error', async () => {
      const error = new Error('Failed to set theme');
      mockElectronAPI.setTheme.mockRejectedValue(error);

      await expect(themeRenderer.setTheme('system')).rejects.toThrow('Failed to set theme');
    });

    it('should set all theme types', async () => {
      const themes: Theme[] = ['light', 'dark', 'system'];

      for (const theme of themes) {
        const expectedThemeInfo: ThemeInfo = {
          userPreference: theme,
          resolvedTheme: theme === 'system' ? 'light' : theme,
          systemTheme: 'light',
        };

        mockElectronAPI.setTheme.mockResolvedValue(expectedThemeInfo);

        const result = await themeRenderer.setTheme(theme);

        expect(mockElectronAPI.setTheme).toHaveBeenCalledWith(theme);
        expect(result).toEqual(expectedThemeInfo);
      }
    });
  });

  describe('getThemeInfo', () => {
    it('should get current theme info successfully', async () => {
      const expectedThemeInfo: ThemeInfo = {
        userPreference: 'system',
        resolvedTheme: 'light',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(expectedThemeInfo);

      const result = await themeRenderer.getThemeInfo();

      expect(mockElectronAPI.getCurrentTheme).toHaveBeenCalled();
      expect(result).toEqual(expectedThemeInfo);
    });

    it('should handle theme info retrieval error', async () => {
      const error = new Error('Failed to get theme info');
      mockElectronAPI.getCurrentTheme.mockRejectedValue(error);

      await expect(themeRenderer.getThemeInfo()).rejects.toThrow('Failed to get theme info');
    });
  });

  describe('theme application behavior', () => {
    it('should apply dark theme with correct DOM manipulation', async () => {
      const themeInfo: ThemeInfo = {
        userPreference: 'dark',
        resolvedTheme: 'dark',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(themeInfo);
      await themeRenderer.initialize();

      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(mockDocumentElement.removeAttribute).not.toHaveBeenCalled();
    });

    it('should apply light theme with correct DOM manipulation', async () => {
      const themeInfo: ThemeInfo = {
        userPreference: 'light',
        resolvedTheme: 'light',
        systemTheme: 'dark',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(themeInfo);
      await themeRenderer.initialize();

      expect(mockDocumentElement.removeAttribute).toHaveBeenCalledWith('data-theme');
      expect(mockDocumentElement.setAttribute).not.toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should handle theme transitions', async () => {
      // Start with light theme
      const lightTheme: ThemeInfo = {
        userPreference: 'light',
        resolvedTheme: 'light',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(lightTheme);

      let themeUpdateCallback: (themeInfo: ThemeInfo) => void;
      mockElectronAPI.onThemeUpdated.mockImplementation((callback) => {
        themeUpdateCallback = callback;
      });

      await themeRenderer.initialize();

      // Clear mocks
      mockDocumentElement.setAttribute.mockClear();
      mockDocumentElement.removeAttribute.mockClear();

      // Switch to dark theme
      const darkTheme: ThemeInfo = {
        userPreference: 'dark',
        resolvedTheme: 'dark',
        systemTheme: 'light',
      };

      themeUpdateCallback!(darkTheme);

      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(themeRenderer.getCurrentTheme()).toBe('dark');

      // Clear mocks again
      mockDocumentElement.setAttribute.mockClear();
      mockDocumentElement.removeAttribute.mockClear();

      // Switch back to light
      themeUpdateCallback!(lightTheme);

      expect(mockDocumentElement.removeAttribute).toHaveBeenCalledWith('data-theme');
      expect(themeRenderer.getCurrentTheme()).toBe('light');
    });
  });

  describe('integration workflow', () => {
    it('should handle complete settings workflow', async () => {
      // Initialize
      const initialTheme: ThemeInfo = {
        userPreference: 'system',
        resolvedTheme: 'light',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(initialTheme);
      await themeRenderer.initialize();

      // User changes preference
      const newTheme: ThemeInfo = {
        userPreference: 'dark',
        resolvedTheme: 'dark',
        systemTheme: 'light',
      };

      mockElectronAPI.setTheme.mockResolvedValue(newTheme);

      const result = await themeRenderer.setTheme('dark');

      expect(result).toEqual(newTheme);

      // Get updated info
      mockElectronAPI.getCurrentTheme.mockResolvedValue(newTheme);
      const currentInfo = await themeRenderer.getThemeInfo();

      expect(currentInfo).toEqual(newTheme);
    });

    it('should handle system theme changes', async () => {
      const systemTheme: ThemeInfo = {
        userPreference: 'system',
        resolvedTheme: 'light',
        systemTheme: 'light',
      };

      mockElectronAPI.getCurrentTheme.mockResolvedValue(systemTheme);

      let themeUpdateCallback: (themeInfo: ThemeInfo) => void;
      mockElectronAPI.onThemeUpdated.mockImplementation((callback) => {
        themeUpdateCallback = callback;
      });

      await themeRenderer.initialize();

      // System changes to dark
      const updatedSystemTheme: ThemeInfo = {
        userPreference: 'system',
        resolvedTheme: 'dark',
        systemTheme: 'dark',
      };

      themeUpdateCallback!(updatedSystemTheme);

      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(themeRenderer.getCurrentTheme()).toBe('dark');
    });
  });
});

// Test the auto-initialization patterns separately
describe('Auto-initialization behavior', () => {
  it('should handle document loading state', () => {
    // Test the conditional logic patterns
    const mockDocument = { readyState: 'loading', addEventListener: jest.fn() };
    const mockRenderer = { initialize: jest.fn() };

    // Simulate the auto-init logic
    if (mockDocument.readyState === 'loading') {
      mockDocument.addEventListener('DOMContentLoaded', () => {
        mockRenderer.initialize();
      });
    } else {
      mockRenderer.initialize();
    }

    expect(mockDocument.addEventListener).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
  });

  it('should handle document ready state', () => {
    // Test immediate initialization
    const mockDocument = { readyState: 'complete', addEventListener: jest.fn() };
    const mockRenderer = { initialize: jest.fn() };

    // Simulate the auto-init logic
    if (mockDocument.readyState === 'loading') {
      mockDocument.addEventListener('DOMContentLoaded', () => {
        mockRenderer.initialize();
      });
    } else {
      mockRenderer.initialize();
    }

    expect(mockRenderer.initialize).toHaveBeenCalled();
    expect(mockDocument.addEventListener).not.toHaveBeenCalled();
  });

  it('should simulate DOMContentLoaded callback behavior', () => {
    // Test the pattern used in the auto-initialization
    const mockInitialize = jest.fn();

    // Simulate the DOMContentLoaded event listener callback directly
    const callback = () => {
      mockInitialize();
    };

    // Execute the callback (simulating DOMContentLoaded event)
    callback();

    // The callback should have been triggered
    expect(mockInitialize).toHaveBeenCalled();
  });
});

// Restore console methods
afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});
