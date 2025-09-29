/**
 * @file Test suite for DiagnosticsWindowManager
 */
import { DiagnosticsWindowManager } from '../../src/main/ui/diagnostics-window-manager';
import { BrowserWindow } from 'electron';
import { jest } from '@jest/globals';

// Mock Electron
jest.mock('electron', () => ({
  BrowserWindow: jest.fn(),
  app: {
    getAppPath: jest.fn().mockReturnValue('/app/path'),
  },
}));

// Mock path
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
}));

describe('DiagnosticsWindowManager', () => {
  let diagnosticsWindowManager: DiagnosticsWindowManager;
  let mockWindow: any;
  let mockStoreService: any;

  beforeEach(() => {
    // Mock BrowserWindow
    mockWindow = {
      loadFile: jest.fn().mockImplementation(() => Promise.resolve()),
      show: jest.fn(),
      hide: jest.fn(),
      close: jest.fn(),
      destroy: jest.fn(),
      isDestroyed: jest.fn().mockReturnValue(false),
      isVisible: jest.fn().mockReturnValue(false),
      focus: jest.fn(),
      getBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 800, height: 600 }),
      setBounds: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      webContents: {
        on: jest.fn(),
        send: jest.fn(),
      },
    };

    (BrowserWindow as any).mockImplementation(() => mockWindow);

    // Mock StoreService
    mockStoreService = {
      getAll: jest.fn().mockReturnValue({}),
      setAll: jest.fn(),
    };

    diagnosticsWindowManager = new DiagnosticsWindowManager(mockStoreService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Window Creation', () => {
    test('should create diagnostics window with proper configuration', async () => {
      const window = await diagnosticsWindowManager.createOrShowWindow();

      expect(BrowserWindow).toHaveBeenCalledWith({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Website Diagnostics',
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: expect.any(String),
        },
      });

      expect(mockWindow.loadFile).toHaveBeenCalledWith(expect.stringContaining('diagnostics.html'));
      expect(window).toBe(mockWindow);
    });

    test('[REGRESSION] should load webpack-processed diagnostics HTML from ui/react folder', async () => {
      // This test verifies the fix for the "Loading diagnostics..." bug
      // The HTML must be in the same directory as the bundled scripts for relative paths to work
      await diagnosticsWindowManager.createOrShowWindow();

      // Should load the webpack-processed HTML from the ui/react folder where scripts are located
      expect(mockWindow.loadFile).toHaveBeenCalledWith(
        expect.stringMatching(/renderer\/ui\/react\/diagnostics\.html$/)
      );

      // Should NOT load from other locations
      expect(mockWindow.loadFile).not.toHaveBeenCalledWith(expect.stringMatching(/renderer\/diagnostics\.html$/));
    });

    test('should return existing window if already created', async () => {
      // Create window first time
      const window1 = await diagnosticsWindowManager.createOrShowWindow();

      // Create window second time should return same instance
      const window2 = await diagnosticsWindowManager.createOrShowWindow();

      expect(window1).toBe(window2);
      expect(BrowserWindow).toHaveBeenCalledTimes(1);
    });

    test('should recreate window if previous one was destroyed', async () => {
      // Create and destroy window
      await diagnosticsWindowManager.createOrShowWindow();
      mockWindow.isDestroyed.mockReturnValue(true);

      // Create window again should create new instance
      const newWindow = await diagnosticsWindowManager.createOrShowWindow();

      expect(BrowserWindow).toHaveBeenCalledTimes(2);
      expect(newWindow).toBe(mockWindow);
    });
  });

  describe('Window State Management', () => {
    test('should restore window bounds from store', async () => {
      const savedBounds = { x: 200, y: 200, width: 1000, height: 700 };
      mockStoreService.getAll.mockReturnValue({
        diagnostics: { windowBounds: savedBounds },
      });

      await diagnosticsWindowManager.createOrShowWindow();

      expect(mockWindow.setBounds).toHaveBeenCalledWith(savedBounds);
    });

    test('should save window bounds on close', async () => {
      const window = await diagnosticsWindowManager.createOrShowWindow();

      // Find the 'close' event handler
      const closeHandler = mockWindow.on.mock.calls.find((call) => call[0] === 'close')?.[1];
      expect(closeHandler).toBeDefined();

      // Simulate close event
      closeHandler();

      expect(mockWindow.getBounds).toHaveBeenCalled();
      expect(mockStoreService.setAll).toHaveBeenCalledWith(
        expect.objectContaining({
          diagnostics: expect.objectContaining({
            windowBounds: { x: 100, y: 100, width: 800, height: 600 },
          }),
        })
      );
    });

    test('should handle window closed event', async () => {
      const window = await diagnosticsWindowManager.createOrShowWindow();

      // Find the 'closed' event handler
      const closedHandler = mockWindow.on.mock.calls.find((call) => call[0] === 'closed')?.[1];
      expect(closedHandler).toBeDefined();

      // Simulate closed event
      closedHandler();

      // Verify window reference is cleared
      expect(diagnosticsWindowManager.isWindowOpen()).toBe(false);
    });
  });

  describe('Window Visibility', () => {
    test('should show window when created', async () => {
      await diagnosticsWindowManager.createOrShowWindow();

      expect(mockWindow.show).toHaveBeenCalled();
    });

    test('should focus existing visible window', async () => {
      mockWindow.isVisible.mockReturnValue(true);

      await diagnosticsWindowManager.createOrShowWindow();
      await diagnosticsWindowManager.createOrShowWindow(); // Second call

      expect(mockWindow.focus).toHaveBeenCalledTimes(1);
    });

    test('should show hidden window', async () => {
      mockWindow.isVisible.mockReturnValue(false);

      await diagnosticsWindowManager.createOrShowWindow();
      await diagnosticsWindowManager.createOrShowWindow(); // Second call

      expect(mockWindow.show).toHaveBeenCalledTimes(2);
    });
  });

  describe('Window Queries', () => {
    test('should return correct window open status', async () => {
      expect(diagnosticsWindowManager.isWindowOpen()).toBe(false);

      await diagnosticsWindowManager.createOrShowWindow();
      expect(diagnosticsWindowManager.isWindowOpen()).toBe(true);

      // Simulate window closed
      mockWindow.isDestroyed.mockReturnValue(true);
      expect(diagnosticsWindowManager.isWindowOpen()).toBe(false);
    });

    test('should return window instance', async () => {
      expect(diagnosticsWindowManager.getWindow()).toBe(null);

      const window = await diagnosticsWindowManager.createOrShowWindow();
      expect(diagnosticsWindowManager.getWindow()).toBe(window);
    });
  });

  describe('Window Disposal', () => {
    test('should close window on dispose', async () => {
      await diagnosticsWindowManager.createOrShowWindow();

      diagnosticsWindowManager.dispose();

      expect(mockWindow.close).toHaveBeenCalled();
    });

    test('should handle dispose when no window exists', () => {
      expect(() => diagnosticsWindowManager.dispose()).not.toThrow();
    });

    test('should handle dispose when window is already destroyed', async () => {
      await diagnosticsWindowManager.createOrShowWindow();
      mockWindow.isDestroyed.mockReturnValue(true);

      expect(() => diagnosticsWindowManager.dispose()).not.toThrow();
    });
  });

  describe('Integration with Store', () => {
    test('should save window preferences', async () => {
      await diagnosticsWindowManager.createOrShowWindow();

      diagnosticsWindowManager.updateWindowPreferences({
        autoShow: false,
        stayOnTop: true,
      });

      expect(mockStoreService.setAll).toHaveBeenCalledWith(
        expect.objectContaining({
          diagnostics: expect.objectContaining({
            windowPreferences: expect.objectContaining({
              autoShow: false,
              stayOnTop: true,
            }),
          }),
        })
      );
    });

    test('should load window preferences', () => {
      mockStoreService.getAll.mockReturnValue({
        diagnostics: {
          windowPreferences: {
            autoShow: true,
            stayOnTop: false,
          },
        },
      });

      const preferences = diagnosticsWindowManager.getWindowPreferences();

      expect(preferences).toMatchObject({
        autoShow: true,
        stayOnTop: false,
      });
    });
  });
});
