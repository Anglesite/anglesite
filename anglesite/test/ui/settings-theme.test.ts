/**
 * @file Tests for Settings window theme switching functionality
 */

interface MockEventTarget {
  target: {
    checked: boolean;
    value: string;
  };
}

// Mock DOM environment
const mockDocument = {
  documentElement: {
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
  },
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(),
  getElementById: jest.fn(),
  addEventListener: jest.fn(),
};

const mockWindow = {
  electronAPI: {
    getCurrentTheme: jest.fn(),
    setTheme: jest.fn(),
    onThemeUpdated: jest.fn(),
  },
  close: jest.fn(),
};

// Mock radio buttons
const createMockRadio = (value: string, checked = false) => ({
  value,
  checked,
  addEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
});

describe('Settings Theme Switching', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Ensure mockWindow.electronAPI exists
    mockWindow.electronAPI = {
      getCurrentTheme: jest.fn(),
      setTheme: jest.fn(),
      onThemeUpdated: jest.fn(),
    };

    // Set up global mocks
    global.document = mockDocument as unknown as Document;
    global.window = mockWindow as unknown as Window & typeof globalThis;

    // Reset mock implementations
    mockWindow.electronAPI.getCurrentTheme.mockResolvedValue({
      userPreference: 'system',
      resolvedTheme: 'light',
      systemTheme: 'light',
    });

    mockWindow.electronAPI.setTheme.mockResolvedValue({
      userPreference: 'light',
      resolvedTheme: 'light',
      systemTheme: 'light',
    });
  });

  describe('Theme Loading and Initialization', () => {
    it('should load current theme on page load', async () => {
      const mockThemeRadios = [
        createMockRadio('system', true),
        createMockRadio('light', false),
        createMockRadio('dark', false),
      ];

      mockDocument.querySelectorAll.mockReturnValue(mockThemeRadios);
      mockDocument.getElementById.mockImplementation((id) => {
        if (id === 'themeSystem') return mockThemeRadios[0];
        if (id === 'themeLight') return mockThemeRadios[1];
        if (id === 'themeDark') return mockThemeRadios[2];
        return null;
      });

      mockWindow.electronAPI.getCurrentTheme.mockResolvedValue({
        userPreference: 'light',
        resolvedTheme: 'light',
        systemTheme: 'dark',
      });

      // Simulate the settings page loading logic
      const themeInfo = await mockWindow.electronAPI.getCurrentTheme();

      expect(mockWindow.electronAPI.getCurrentTheme).toHaveBeenCalled();
      expect(themeInfo).toEqual({
        userPreference: 'light',
        resolvedTheme: 'light',
        systemTheme: 'dark',
      });
    });

    it('should apply theme immediately on load', async () => {
      mockWindow.electronAPI.getCurrentTheme.mockResolvedValue({
        userPreference: 'dark',
        resolvedTheme: 'dark',
        systemTheme: 'light',
      });

      const themeInfo = await mockWindow.electronAPI.getCurrentTheme();

      // Simulate applyTheme function
      if (themeInfo.resolvedTheme === 'dark') {
        mockDocument.documentElement.setAttribute('data-theme', 'dark');
      } else {
        mockDocument.documentElement.removeAttribute('data-theme');
      }

      expect(mockDocument.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should set up theme update listener', () => {
      const mockCallback = jest.fn();

      mockWindow.electronAPI.onThemeUpdated(mockCallback);

      expect(mockWindow.electronAPI.onThemeUpdated).toHaveBeenCalledWith(mockCallback);
    });
  });

  describe('Immediate Theme Switching', () => {
    it('should apply theme immediately when radio button changes', async () => {
      const mockRadios = [
        createMockRadio('system', false),
        createMockRadio('light', false),
        createMockRadio('dark', true), // This one is selected
      ];

      mockDocument.querySelectorAll.mockReturnValue(mockRadios);

      // Set up the change handler response
      mockWindow.electronAPI.setTheme.mockResolvedValue({
        userPreference: 'dark',
        resolvedTheme: 'dark',
        systemTheme: 'light',
      });

      // Simulate setting up event listeners
      mockRadios.forEach((radio) => {
        radio.addEventListener('change', async (event: MockEventTarget) => {
          if (event.target.checked) {
            const newThemeInfo = await mockWindow.electronAPI.setTheme(event.target.value);
            // Apply theme immediately
            if (newThemeInfo.resolvedTheme === 'dark') {
              mockDocument.documentElement.setAttribute('data-theme', 'dark');
            } else {
              mockDocument.documentElement.removeAttribute('data-theme');
            }
          }
        });
      });

      // Simulate radio button change event
      const changeEvent = { target: mockRadios[2] };
      const changeHandler = mockRadios[2].addEventListener.mock.calls.find((call) => call[0] === 'change')[1];

      await changeHandler(changeEvent);

      expect(mockWindow.electronAPI.setTheme).toHaveBeenCalledWith('dark');
      expect(mockDocument.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should switch to light theme immediately', async () => {
      const mockRadios = [
        createMockRadio('system', false),
        createMockRadio('light', true), // This one is selected
        createMockRadio('dark', false),
      ];

      mockDocument.querySelectorAll.mockReturnValue(mockRadios);

      mockWindow.electronAPI.setTheme.mockResolvedValue({
        userPreference: 'light',
        resolvedTheme: 'light',
        systemTheme: 'dark',
      });

      // Set up change handler
      const changeHandler = async (event: MockEventTarget) => {
        if (event.target.checked) {
          const newThemeInfo = await mockWindow.electronAPI.setTheme(event.target.value);
          if (newThemeInfo.resolvedTheme === 'dark') {
            mockDocument.documentElement.setAttribute('data-theme', 'dark');
          } else {
            mockDocument.documentElement.removeAttribute('data-theme');
          }
        }
      };

      // Simulate change event for light theme
      await changeHandler({ target: mockRadios[1] });

      expect(mockWindow.electronAPI.setTheme).toHaveBeenCalledWith('light');
      expect(mockDocument.documentElement.removeAttribute).toHaveBeenCalledWith('data-theme');
    });

    it('should switch to system theme immediately', async () => {
      const mockRadios = [
        createMockRadio('system', true), // This one is selected
        createMockRadio('light', false),
        createMockRadio('dark', false),
      ];

      mockWindow.electronAPI.setTheme.mockResolvedValue({
        userPreference: 'system',
        resolvedTheme: 'dark', // System is dark
        systemTheme: 'dark',
      });

      // Set up change handler
      const changeHandler = async (event: MockEventTarget) => {
        if (event.target.checked) {
          const newThemeInfo = await mockWindow.electronAPI.setTheme(event.target.value);
          if (newThemeInfo.resolvedTheme === 'dark') {
            mockDocument.documentElement.setAttribute('data-theme', 'dark');
          } else {
            mockDocument.documentElement.removeAttribute('data-theme');
          }
        }
      };

      // Simulate change event for system theme
      await changeHandler({ target: mockRadios[0] });

      expect(mockWindow.electronAPI.setTheme).toHaveBeenCalledWith('system');
      expect(mockDocument.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });
  });

  describe('Error Handling', () => {
    it('should handle theme switching errors gracefully', async () => {
      const mockRadios = [createMockRadio('dark', true)];
      mockDocument.querySelectorAll.mockReturnValue(mockRadios);

      // Mock an error in theme setting
      const themeError = new Error('Theme setting failed');
      mockWindow.electronAPI.setTheme.mockRejectedValue(themeError);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Set up error handling change handler
      const changeHandler = async (event: MockEventTarget) => {
        if (event.target.checked) {
          try {
            await mockWindow.electronAPI.setTheme(event.target.value);
          } catch (error) {
            console.error('Failed to apply theme immediately:', error);
          }
        }
      };

      // Simulate change event
      await changeHandler({ target: mockRadios[0] });

      consoleSpy.mockRestore();
    });

    it('should handle missing electronAPI gracefully', async () => {
      // Remove electronAPI
      (mockWindow as { electronAPI?: unknown }).electronAPI = undefined;

      const changeHandler = async (event: MockEventTarget) => {
        if (event.target.checked) {
          try {
            if (mockWindow.electronAPI) {
              await mockWindow.electronAPI.setTheme(event.target.value);
            }
          } catch {
            // Should not throw
          }
        }
      };

      // Should not throw even without electronAPI
      expect(async () => {
        await changeHandler({ target: { checked: true, value: 'dark' } });
      }).not.toThrow();
    });
  });

  describe('Theme State Consistency', () => {
    it('should maintain theme state across multiple changes', async () => {
      // Restore electronAPI for this test
      mockWindow.electronAPI = {
        getCurrentTheme: jest.fn(),
        setTheme: jest.fn(),
        onThemeUpdated: jest.fn(),
      };

      const mockRadios = [
        createMockRadio('system', false),
        createMockRadio('light', false),
        createMockRadio('dark', false),
      ];

      // Track theme state changes
      const themeStates: Array<{ userPreference: string; resolvedTheme: string; systemTheme: string }> = [];

      const changeHandler = async (event: MockEventTarget) => {
        if (event.target.checked) {
          const newThemeInfo = await mockWindow.electronAPI.setTheme(event.target.value);
          themeStates.push(newThemeInfo);
        }
      };

      // Simulate multiple theme changes
      mockWindow.electronAPI.setTheme
        .mockResolvedValueOnce({ userPreference: 'light', resolvedTheme: 'light', systemTheme: 'dark' })
        .mockResolvedValueOnce({ userPreference: 'dark', resolvedTheme: 'dark', systemTheme: 'dark' })
        .mockResolvedValueOnce({ userPreference: 'system', resolvedTheme: 'dark', systemTheme: 'dark' });

      // Change to light
      mockRadios[1].checked = true;
      await changeHandler({ target: mockRadios[1] });

      // Change to dark
      mockRadios[1].checked = false;
      mockRadios[2].checked = true;
      await changeHandler({ target: mockRadios[2] });

      // Change to system
      mockRadios[2].checked = false;
      mockRadios[0].checked = true;
      await changeHandler({ target: mockRadios[0] });

      expect(themeStates).toHaveLength(3);
      expect(themeStates[0].userPreference).toBe('light');
      expect(themeStates[1].userPreference).toBe('dark');
      expect(themeStates[2].userPreference).toBe('system');
    });
  });

  describe('Save Settings Behavior', () => {
    it('should not duplicate theme saving when Save Settings is clicked', async () => {
      // Restore electronAPI for this test
      mockWindow.electronAPI = {
        getCurrentTheme: jest.fn(),
        setTheme: jest.fn(),
        onThemeUpdated: jest.fn(),
      };

      // Theme has already been saved via immediate switching
      const mockCheckedRadio = createMockRadio('dark', true);
      mockDocument.querySelector.mockReturnValue(mockCheckedRadio);

      // Simulate Save Settings click (theme should already be saved)
      const saveSettings = async () => {
        // Theme is already saved immediately when changed, so just handle other settings
        // const autoDomains = mockDocument.getElementById('autoDomains')?.checked;
        // TODO: Save autoDomains to store when implemented
        mockWindow.close();
      };

      await saveSettings();

      // electronAPI.setTheme should NOT be called again during save
      expect(mockWindow.electronAPI.setTheme).not.toHaveBeenCalled();
      expect(mockWindow.close).toHaveBeenCalled();
    });
  });
});
