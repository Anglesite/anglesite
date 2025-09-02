/**
 * @file Test website editor IPC handlers
 */

import { ipcMain, BrowserWindow, IpcMainEvent } from 'electron';
import { setupWebsiteHandlers } from '../../src/main/ipc/website';
import { setupFileHandlers } from '../../src/main/ipc/file';
import { setupPreviewHandlers } from '../../src/main/ipc/preview';
import { setupExportHandlers } from '../../src/main/ipc/export';

// Mock electron app
jest.mock('electron', () => ({
  ipcMain: {
    emit: jest.fn(),
    removeAllListeners: jest.fn(),
    on: jest.fn(),
    handle: jest.fn(),
  },
  BrowserWindow: {
    fromWebContents: jest.fn(),
  },
  app: {
    getPath: jest.fn(() => '/mock/user/data'),
  },
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: jest.fn(),
  },
  dialog: {
    showMessageBox: jest.fn(),
    showSaveDialog: jest.fn(),
  },
}));

// Mock the multi-window-manager module
jest.mock('../../src/main/ui/multi-window-manager', () => ({
  showWebsitePreview: jest.fn(),
  hideWebsitePreview: jest.fn(),
  getAllWebsiteWindows: jest.fn(() => new Map()),
  getWebsiteServer: jest.fn(),
}));

// Type definitions for IPC handlers
type HandleHandler = (event: IpcMainEvent, ...args: unknown[]) => unknown;
type OnHandler = (event: IpcMainEvent, ...args: unknown[]) => void;

describe('Website Editor IPC Handlers', () => {
  let mockWindow: Partial<BrowserWindow>;
  let mockEvent: Partial<IpcMainEvent>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWindow = {
      isDestroyed: jest.fn(() => false),
    };

    mockEvent = {
      sender: {
        send: jest.fn(),
      } as Partial<import('electron').WebContents>,
    } as Partial<IpcMainEvent>;

    // Reset ipcMain mocks
    (ipcMain.on as jest.Mock).mockClear();
    (ipcMain.handle as jest.Mock).mockClear();

    // Set up ipcMain.on to actually register listeners for testing
    const listeners = new Map<string, (event: IpcMainEvent) => void>();
    (ipcMain.on as jest.Mock).mockImplementation((channel: string, handler: (event: IpcMainEvent) => void) => {
      listeners.set(channel, handler);
    });

    // Mock ipcMain.emit to call the registered handler
    (ipcMain.emit as jest.Mock).mockImplementation((channel: string, event: IpcMainEvent) => {
      const handler = listeners.get(channel);
      if (handler) {
        return handler(event);
      }
    });

    // Mock BrowserWindow.fromWebContents
    (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(mockWindow);

    setupWebsiteHandlers();
    setupFileHandlers();
    setupPreviewHandlers();
    setupExportHandlers();
  });

  afterEach(() => {
    ipcMain.removeAllListeners('website-editor-show-preview');
    ipcMain.removeAllListeners('website-editor-show-edit');
  });

  describe('website-editor-show-preview', () => {
    it('should call showWebsitePreview when window and website name are found', async () => {
      const { showWebsitePreview, getAllWebsiteWindows } = require('../../src/main/ui/multi-window-manager');

      // Set up the mock so that the window appears in the website windows map
      const mockWebsiteWindows = new Map([['test-website', { window: mockWindow }]]);
      getAllWebsiteWindows.mockReturnValue(mockWebsiteWindows);

      // Make sure BrowserWindow.fromWebContents returns our mock window
      (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(mockWindow);

      // Emit the event
      ipcMain.emit('website-editor-show-preview', mockEvent);

      // Wait for async import to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(showWebsitePreview).toHaveBeenCalledWith('test-website');
    });

    it('should not call showWebsitePreview when window not found', async () => {
      const { showWebsitePreview } = require('../../src/main/ui/multi-window-manager');
      (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(null);

      ipcMain.emit('website-editor-show-preview', mockEvent);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(showWebsitePreview).not.toHaveBeenCalled();
    });
  });

  describe('website-editor-show-edit', () => {
    it('should call hideWebsitePreview when window and website name are found', async () => {
      const { hideWebsitePreview, getAllWebsiteWindows } = require('../../src/main/ui/multi-window-manager');

      // Set up the mock so that the window appears in the website windows map
      const mockWebsiteWindows = new Map([['test-website', { window: mockWindow }]]);
      getAllWebsiteWindows.mockReturnValue(mockWebsiteWindows);

      // Make sure BrowserWindow.fromWebContents returns our mock window
      (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(mockWindow);

      ipcMain.emit('website-editor-show-edit', mockEvent);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(hideWebsitePreview).toHaveBeenCalledWith('test-website');
    });

    it('should not call hideWebsitePreview when window not found', async () => {
      const { hideWebsitePreview } = require('../../src/main/ui/multi-window-manager');
      (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(null);

      ipcMain.emit('website-editor-show-edit', mockEvent);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(hideWebsitePreview).not.toHaveBeenCalled();
    });
  });

  describe('get-file-url', () => {
    it('should return file URL when website server and URL resolver exist', async () => {
      const { getWebsiteServer } = require('../../src/main/ui/multi-window-manager');
      const mockUrlResolver = {
        getUrlForFile: jest.fn(() => '/test-file.html'),
      };
      const mockWebsiteServer = {
        urlResolver: mockUrlResolver,
      };

      getWebsiteServer.mockReturnValue(mockWebsiteServer);

      // Set up ipcMain.handle to actually register handlers
      const handleHandlers = new Map<string, HandleHandler>();
      (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: HandleHandler) => {
        handleHandlers.set(channel, handler);
      });

      setupWebsiteHandlers();
      setupFileHandlers();
      setupPreviewHandlers();
      setupExportHandlers();

      const handler = handleHandlers.get('get-file-url');
      expect(handler).toBeDefined();

      if (handler) {
        const result = await handler(mockEvent as IpcMainEvent, 'test-website', '/path/to/file.md');
        expect(result).toBe('/test-file.html');
        expect(getWebsiteServer).toHaveBeenCalledWith('test-website');
        expect(mockUrlResolver.getUrlForFile).toHaveBeenCalledWith('/path/to/file.md');
      }
    });

    it('should return null when website server does not exist', async () => {
      const { getWebsiteServer } = require('../../src/main/ui/multi-window-manager');
      getWebsiteServer.mockReturnValue(null);

      const handleHandlers = new Map<string, HandleHandler>();
      (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: HandleHandler) => {
        handleHandlers.set(channel, handler);
      });

      setupWebsiteHandlers();
      setupFileHandlers();
      setupPreviewHandlers();
      setupExportHandlers();

      const handler = handleHandlers.get('get-file-url');
      if (handler) {
        const result = await handler(mockEvent as IpcMainEvent, 'nonexistent-website', '/path/to/file.md');
        expect(result).toBeNull();
      }
    });
  });

  describe('get-website-server-url', () => {
    it('should return server URL when website window exists', async () => {
      const { getAllWebsiteWindows } = require('../../src/main/ui/multi-window-manager');
      const mockWebsiteWindows = new Map([
        [
          'test-website',
          {
            window: mockWindow,
            serverUrl: 'http://localhost:8080',
          },
        ],
      ]);
      getAllWebsiteWindows.mockReturnValue(mockWebsiteWindows);

      const handleHandlers = new Map<string, HandleHandler>();
      (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: HandleHandler) => {
        handleHandlers.set(channel, handler);
      });

      setupWebsiteHandlers();
      setupFileHandlers();
      setupPreviewHandlers();
      setupExportHandlers();

      const handler = handleHandlers.get('get-website-server-url');
      if (handler) {
        const result = await handler(mockEvent as IpcMainEvent, 'test-website');
        expect(result).toBe('http://localhost:8080');
      }
    });

    it('should return null when website window does not exist', async () => {
      const { getAllWebsiteWindows } = require('../../src/main/ui/multi-window-manager');
      getAllWebsiteWindows.mockReturnValue(new Map());

      const handleHandlers = new Map<string, HandleHandler>();
      (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: HandleHandler) => {
        handleHandlers.set(channel, handler);
      });

      setupWebsiteHandlers();
      setupFileHandlers();
      setupPreviewHandlers();
      setupExportHandlers();

      const handler = handleHandlers.get('get-website-server-url');
      if (handler) {
        const result = await handler(mockEvent as IpcMainEvent, 'nonexistent-website');
        expect(result).toBeNull();
      }
    });
  });

  describe('load-file-preview', () => {
    it('should load URL in WebContentsView when website window exists', async () => {
      const { getAllWebsiteWindows } = require('../../src/main/ui/multi-window-manager');
      const mockWebContents = {
        loadURL: jest.fn(),
        isDestroyed: jest.fn(() => false),
      };
      const mockWebContentsView = {
        webContents: mockWebContents,
      };
      const mockWebsiteWindows = new Map([
        [
          'test-website',
          {
            window: mockWindow,
            webContentsView: mockWebContentsView,
          },
        ],
      ]);
      getAllWebsiteWindows.mockReturnValue(mockWebsiteWindows);

      const onHandlers = new Map<string, OnHandler>();
      (ipcMain.on as jest.Mock).mockImplementation((channel: string, handler: OnHandler) => {
        onHandlers.set(channel, handler);
      });

      setupWebsiteHandlers();
      setupFileHandlers();
      setupPreviewHandlers();
      setupExportHandlers();

      const handler = onHandlers.get('load-file-preview');
      if (handler) {
        await handler(mockEvent as IpcMainEvent, 'test-website', 'http://localhost:8080/test.html');
        expect(mockWebContents.loadURL).toHaveBeenCalledWith('http://localhost:8080/test.html');
      }
    });

    it('should handle missing website window gracefully', async () => {
      const { getAllWebsiteWindows } = require('../../src/main/ui/multi-window-manager');
      getAllWebsiteWindows.mockReturnValue(new Map());

      const onHandlers = new Map<string, OnHandler>();
      (ipcMain.on as jest.Mock).mockImplementation((channel: string, handler: OnHandler) => {
        onHandlers.set(channel, handler);
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      setupWebsiteHandlers();
      setupFileHandlers();
      setupPreviewHandlers();
      setupExportHandlers();

      const handler = onHandlers.get('load-file-preview');
      if (handler) {
        await handler(mockEvent as IpcMainEvent, 'nonexistent-website', 'http://localhost:8080/test.html');
      }

      consoleSpy.mockRestore();
    });
  });
});
