/**
 * @file Tests for menu creation and window management
 */
import type { MenuItemConstructorOptions, Menu, MenuItem, KeyboardEvent } from 'electron';

// Mock the service registry FIRST, before any other imports
jest.mock('../../app/core/service-registry', () => ({
  getGlobalContext: jest.fn().mockReturnValue({
    getService: jest.fn().mockReturnValue({
      getRecentWebsites: jest.fn().mockReturnValue([]),
    }),
  }),
  ServiceKeys: { STORE: 'store' },
}));

// Mock electron modules
const mockBrowserWindow = {
  getFocusedWindow: jest.fn(),
};

const mockMenu = {
  buildFromTemplate: jest.fn(),
  setApplicationMenu: jest.fn(),
};

const mockShell = {
  openExternal: jest.fn(),
};

const mockClipboard = {
  writeText: jest.fn(),
};

const mockApp = {
  getPath: jest.fn(() => '/mock/user/data'),
};

jest.mock('electron', () => ({
  Menu: mockMenu,
  BrowserWindow: mockBrowserWindow,
  shell: mockShell,
  clipboard: mockClipboard,
  app: mockApp,
}));

// Mock IPC handlers
const mockExportSiteHandler = jest.fn();
jest.mock('../../app/ipc/export', () => ({
  exportSiteHandler: mockExportSiteHandler,
}));

// Mock UI modules
const mockHelpWindow = {
  getTitle: jest.fn(),
  focus: jest.fn(),
  isDestroyed: jest.fn(() => false),
};

const mockWebsiteWindow1 = {
  window: {
    getTitle: jest.fn(),
    focus: jest.fn(),
    isDestroyed: jest.fn(() => false),
  },
  webContentsView: {},
  websiteName: 'Test Site 1',
};

const mockWebsiteWindow2 = {
  window: {
    getTitle: jest.fn(),
    focus: jest.fn(),
    isDestroyed: jest.fn(() => false),
  },
  webContentsView: {},
  websiteName: 'Test Site 2',
};

jest.mock('../../app/ui/multi-window-manager', () => ({
  getAllWebsiteWindows: jest.fn(),
  isWebsiteEditorFocused: jest.fn(),
  getHelpWindow: jest.fn(),
  createHelpWindow: jest.fn(),
}));

jest.mock('../../app/ui/window-manager', () => ({
  openSettingsWindow: jest.fn(),
  openWebsiteSelectionWindow: jest.fn(),
  getNativeInput: jest.fn(),
}));

jest.mock('../../app/server/eleventy', () => ({
  getCurrentLiveServerUrl: jest.fn(() => 'https://localhost:8080'),
}));

describe('Menu', () => {
  let menu: {
    buildWindowList: () => MenuItemConstructorOptions[];
    updateApplicationMenu: () => void;
    createApplicationMenu: () => Menu;
  };
  let mockMultiWindowManager: {
    getHelpWindow: jest.Mock;
    getAllWebsiteWindows: jest.Mock;
    createHelpWindow: jest.Mock;
  };
  let mockWindowManager: {
    openSettingsWindow: jest.Mock;
    openWebsiteSelectionWindow: jest.Mock;
    getNativeInput: jest.Mock;
  };

  beforeAll(() => {
    menu = require('../../app/ui/menu');
    mockMultiWindowManager = require('../../app/ui/multi-window-manager');
    mockWindowManager = require('../../app/ui/window-manager');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Set default mock return values
    mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());
    mockMultiWindowManager.getHelpWindow.mockReturnValue(null);
  });

  describe('buildWindowList', () => {
    it('should return empty list when no windows are open', () => {
      mockMultiWindowManager.getHelpWindow.mockReturnValue(null);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());
      mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

      const windowList = menu.buildWindowList();

      expect(windowList).toEqual([
        {
          label: 'No Windows Open',
          enabled: false,
        },
      ]);
    });

    it('should include website windows', () => {
      mockMultiWindowManager.getHelpWindow.mockReturnValue(null);

      mockWebsiteWindow1.window.getTitle.mockReturnValue('My Blog');
      mockWebsiteWindow2.window.getTitle.mockReturnValue('Portfolio');

      const websiteWindows = new Map([
        ['site1', mockWebsiteWindow1],
        ['site2', mockWebsiteWindow2],
      ]);

      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(websiteWindows);
      mockBrowserWindow.getFocusedWindow.mockReturnValue(mockWebsiteWindow1.window);

      const windowList = menu.buildWindowList();

      expect(windowList).toHaveLength(2);

      // First window should be checked (focused)
      expect(windowList[0]).toEqual({
        label: 'My Blog',
        type: 'checkbox',
        checked: true,
        click: expect.any(Function),
      });

      // Second window should not be checked
      expect(windowList[1]).toEqual({
        label: 'Portfolio',
        type: 'checkbox',
        checked: false,
        click: expect.any(Function),
      });

      // Test click handlers
      if (windowList[0].click) {
        windowList[0].click({} as MenuItem, undefined, {} as KeyboardEvent);
      }
      expect(mockWebsiteWindow1.window.focus).toHaveBeenCalled();

      if (windowList[1].click) {
        windowList[1].click({} as MenuItem, undefined, {} as KeyboardEvent);
      }
      expect(mockWebsiteWindow2.window.focus).toHaveBeenCalled();
    });

    it('should skip destroyed windows', () => {
      mockWebsiteWindow1.window.isDestroyed.mockReturnValue(true);
      const websiteWindows = new Map([['site1', mockWebsiteWindow1]]);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(websiteWindows);

      mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

      const windowList = menu.buildWindowList();

      expect(windowList).toEqual([
        {
          label: 'No Windows Open',
          enabled: false,
        },
      ]);
    });

    it('should handle no focused window', () => {
      mockHelpWindow.getTitle.mockReturnValue('Anglesite');
      mockHelpWindow.isDestroyed.mockReturnValue(false); // Make sure it's not destroyed
      mockMultiWindowManager.getHelpWindow.mockReturnValue(mockHelpWindow);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());
      mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

      const windowList = menu.buildWindowList();

      expect(windowList).toHaveLength(1);
      expect(windowList[0]).toEqual({
        label: 'Anglesite',
        type: 'checkbox',
        checked: false,
        click: expect.any(Function),
      });
    });
  });

  describe('updateApplicationMenu', () => {
    it('should build and set application menu', () => {
      const mockMenuInstance = { items: [] };
      mockMenu.buildFromTemplate.mockReturnValue(mockMenuInstance);

      menu.updateApplicationMenu();

      expect(mockMenu.buildFromTemplate).toHaveBeenCalledWith(expect.any(Array));
      expect(mockMenu.setApplicationMenu).toHaveBeenCalledWith(mockMenuInstance);
    });
  });

  describe('createApplicationMenu', () => {
    it('should create menu template with window list', () => {
      mockMultiWindowManager.getHelpWindow.mockReturnValue(null);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());

      menu.createApplicationMenu();

      expect(mockMenu.buildFromTemplate).toHaveBeenCalledWith(expect.any(Array));

      // Get the template that was passed to buildFromTemplate
      const template = mockMenu.buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[];

      // Find the Window menu
      const windowMenu = template.find((item) => item.label === 'Window');
      expect(windowMenu).toBeDefined();
      expect(windowMenu?.submenu).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Minimize' }),
          expect.objectContaining({ label: 'Merge All Windows' }),
          expect.objectContaining({ label: 'Move Tab to New Window' }),
          expect.objectContaining({ label: 'Bring All to Front' }),
          expect.objectContaining({ type: 'separator' }),
          expect.objectContaining({ label: 'No Windows Open', enabled: false }),
        ])
      );
    });

    it('should include window items in Window menu when windows exist', () => {
      mockHelpWindow.getTitle.mockReturnValue('Anglesite');
      mockHelpWindow.isDestroyed.mockReturnValue(false);
      mockMultiWindowManager.getHelpWindow.mockReturnValue(mockHelpWindow);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());
      mockBrowserWindow.getFocusedWindow.mockReturnValue(mockHelpWindow);

      menu.createApplicationMenu();

      const template = mockMenu.buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[];
      const windowMenu = template.find((item) => item.label === 'Window');

      // Check that the window list includes the help window
      const windowSubmenu = windowMenu?.submenu as MenuItemConstructorOptions[];
      const helpWindowItem = windowSubmenu.find((item) => item.label === 'Anglesite' && item.type === 'checkbox');

      expect(helpWindowItem).toBeDefined();
      expect(helpWindowItem?.checked).toBe(true);
    });
  });

  describe('isWebsiteWindowFocused', () => {
    it('should return false when no window is focused', () => {
      mockBrowserWindow.getFocusedWindow.mockReturnValue(null);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());

      // We need to access the internal function indirectly through menu creation
      // Create a menu template and check if the Export menu item is disabled
      mockMultiWindowManager.getHelpWindow.mockReturnValue(null);

      menu.createApplicationMenu();
      const template = mockMenu.buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[];
      const fileMenu = template.find((item) => item.label === 'File');
      const exportItem = (fileMenu?.submenu as MenuItemConstructorOptions[])?.find(
        (item) => item.label === 'Export To'
      );

      expect(exportItem?.enabled).toBe(false);
    });

    it('should return true when focused window is a website window', () => {
      const websiteWindows = new Map([['site1', mockWebsiteWindow1]]);
      mockBrowserWindow.getFocusedWindow.mockReturnValue(mockWebsiteWindow1.window);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(websiteWindows);
      mockMultiWindowManager.getHelpWindow.mockReturnValue(null);

      menu.createApplicationMenu();
      const template = mockMenu.buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[];
      const fileMenu = template.find((item) => item.label === 'File');
      const exportItem = (fileMenu?.submenu as MenuItemConstructorOptions[])?.find(
        (item) => item.label === 'Export To'
      );

      expect(exportItem?.enabled).toBe(true);
    });

    it('should return false when focused window is not a website window', () => {
      const websiteWindows = new Map([['site1', mockWebsiteWindow1]]);
      const otherWindow = { id: 'other-window' };
      mockBrowserWindow.getFocusedWindow.mockReturnValue(otherWindow);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(websiteWindows);
      mockMultiWindowManager.getHelpWindow.mockReturnValue(null);

      menu.createApplicationMenu();
      const template = mockMenu.buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[];
      const fileMenu = template.find((item) => item.label === 'File');
      const exportItem = (fileMenu?.submenu as MenuItemConstructorOptions[])?.find(
        (item) => item.label === 'Export To'
      );

      expect(exportItem?.enabled).toBe(false);
    });
  });

  describe('Menu Item Click Handlers', () => {
    let template: MenuItemConstructorOptions[];
    let mockBrowserWindowInstance: {
      webContents: {
        send: jest.Mock;
        reloadIgnoringCache: jest.Mock;
        isDevToolsOpened: jest.Mock;
        closeDevTools: jest.Mock;
        openDevTools: jest.Mock;
      };
    };
    let mockWebContents: {
      send: jest.Mock;
      reloadIgnoringCache: jest.Mock;
      isDevToolsOpened: jest.Mock;
      closeDevTools: jest.Mock;
      openDevTools: jest.Mock;
    };

    beforeEach(() => {
      mockBrowserWindowInstance = {
        webContents: {
          send: jest.fn(),
          reloadIgnoringCache: jest.fn(),
          isDevToolsOpened: jest.fn(() => false),
          closeDevTools: jest.fn(),
          openDevTools: jest.fn(),
        },
      };
      mockWebContents = mockBrowserWindowInstance.webContents;

      mockMultiWindowManager.getHelpWindow.mockReturnValue(null);
      mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map());

      menu.createApplicationMenu();
      template = mockMenu.buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[];
    });

    describe('File Menu', () => {
      it('should handle Settings click', () => {
        const anglesiteMenu = template.find((item) => item.label === 'Anglesite');
        const settingsItem = (anglesiteMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Settings...'
        );

        expect(settingsItem?.click).toBeDefined();
        if (settingsItem?.click) {
          (settingsItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => void)(
            {},
            undefined,
            {}
          );
        }

        expect(mockWindowManager.openSettingsWindow).toHaveBeenCalled();
      });

      it('should handle Open Website click', async () => {
        const fileMenu = template.find((item) => item.label === 'File');
        const openWebsiteItem = (fileMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Open Website…'
        );

        expect(openWebsiteItem?.click).toBeDefined();
        if (openWebsiteItem?.click) {
          await (openWebsiteItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => Promise<void>)(
            {},
            undefined,
            {}
          );
        }

        expect(mockWindowManager.openWebsiteSelectionWindow).toHaveBeenCalled();
      });

      it('should have New Website menu item with correct accelerator', () => {
        const fileMenu = template.find((item) => item.label === 'File');
        const newWebsiteItem = (fileMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'New Website…'
        );

        expect(newWebsiteItem?.click).toBeDefined();
        expect(newWebsiteItem?.accelerator).toBe('CmdOrCtrl+N');
        expect(typeof newWebsiteItem?.click).toBe('function');
      });

      it('should handle Export to Folder click', async () => {
        const fileMenu = template.find((item) => item.label === 'File');
        const exportToItem = (fileMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Export To'
        );
        const folderExportItem = (exportToItem?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Folder'
        );

        expect(folderExportItem?.click).toBeDefined();
        if (folderExportItem?.click) {
          await (
            folderExportItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => Promise<void>
          )({}, undefined, {});
        }

        expect(mockExportSiteHandler).toHaveBeenCalledWith(null, false);
      });

      it('should handle Export to Zip click', async () => {
        const fileMenu = template.find((item) => item.label === 'File');
        const exportToItem = (fileMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Export To'
        );
        const zipExportItem = (exportToItem?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Zip Archive'
        );

        expect(zipExportItem?.click).toBeDefined();
        if (zipExportItem?.click) {
          await (zipExportItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => Promise<void>)(
            {},
            undefined,
            {}
          );
        }

        expect(mockExportSiteHandler).toHaveBeenCalledWith(null, true);
      });
    });

    describe('View Menu', () => {
      it('should handle Reload click', () => {
        const viewMenu = template.find((item) => item.label === 'View');
        const reloadItem = (viewMenu?.submenu as MenuItemConstructorOptions[])?.find((item) => item.label === 'Reload');

        expect(reloadItem?.click).toBeDefined();
        if (reloadItem?.click) {
          (reloadItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => void)(
            {},
            mockBrowserWindowInstance,
            {}
          );
        }

        expect(mockWebContents.send).toHaveBeenCalledWith('reload-preview');
      });

      it('should handle Force Reload click', () => {
        const viewMenu = template.find((item) => item.label === 'View');
        const forceReloadItem = (viewMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Force Reload'
        );

        expect(forceReloadItem?.click).toBeDefined();
        if (forceReloadItem?.click) {
          (forceReloadItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => void)(
            {},
            mockBrowserWindowInstance,
            {}
          );
        }

        expect(mockWebContents.reloadIgnoringCache).toHaveBeenCalled();
      });

      it('should handle Toggle Developer Tools click', () => {
        const viewMenu = template.find((item) => item.label === 'View');
        const devToolsItem = (viewMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Toggle Developer Tools'
        );

        expect(devToolsItem?.click).toBeDefined();
        if (devToolsItem?.click) {
          (devToolsItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => void)(
            {},
            mockBrowserWindowInstance,
            {}
          );
        }

        expect(mockWebContents.openDevTools).toHaveBeenCalled();
      });

      it('should handle View menu clicks with no browser window', () => {
        const viewMenu = template.find((item) => item.label === 'View');
        const reloadItem = (viewMenu?.submenu as MenuItemConstructorOptions[])?.find((item) => item.label === 'Reload');

        // Should not throw when no browser window is provided
        expect(() => {
          if (reloadItem?.click) {
            (reloadItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => void)({}, null, {});
          }
        }).not.toThrow();
      });

      it('should handle View menu clicks with browser window without webContents', () => {
        const browserWindowWithoutWebContents = { someOtherProp: 'value' };
        const viewMenu = template.find((item) => item.label === 'View');
        const reloadItem = (viewMenu?.submenu as MenuItemConstructorOptions[])?.find((item) => item.label === 'Reload');

        // Should not throw when browser window doesn't have webContents
        expect(() => {
          if (reloadItem?.click) {
            (reloadItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => void)(
              {},
              browserWindowWithoutWebContents,
              {}
            );
          }
        }).not.toThrow();
      });
    });

    describe('Website Menu Server Actions', () => {
      it('should handle Server Restart click', () => {
        const websiteMenu = template.find((item) => item.label === 'Website');
        const serverSubmenu = (websiteMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Server'
        );
        const restartServerItem = (serverSubmenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Restart'
        );

        expect(restartServerItem?.click).toBeDefined();
        if (restartServerItem?.click) {
          (restartServerItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => void)(
            {},
            mockBrowserWindowInstance,
            {}
          );
        }

        expect(mockWebContents.send).toHaveBeenCalledWith('restart-server');
      });
    });

    describe('Help Menu', () => {
      it('should handle Anglesite Help click', async () => {
        const helpMenu = template.find((item) => item.label === 'Help');
        const anglesiteHelpItem = (helpMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Anglesite Help'
        );

        expect(anglesiteHelpItem?.click).toBeDefined();
        if (anglesiteHelpItem?.click) {
          await (
            anglesiteHelpItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => Promise<void>
          )({}, undefined, {});
        }

        expect(mockMultiWindowManager.createHelpWindow).toHaveBeenCalled();
      });

      it('should handle Report Issue click', async () => {
        mockShell.openExternal.mockResolvedValue(undefined);

        const helpMenu = template.find((item) => item.label === 'Help');
        const reportIssueItem = (helpMenu?.submenu as MenuItemConstructorOptions[])?.find(
          (item) => item.label === 'Report Issue'
        );

        expect(reportIssueItem?.click).toBeDefined();
        if (reportIssueItem?.click) {
          await (reportIssueItem.click as (menuItem: unknown, browserWindow: unknown, event: unknown) => Promise<void>)(
            {},
            undefined,
            {}
          );
        }

        expect(mockShell.openExternal).toHaveBeenCalledWith('https://github.com/anglesite/anglesite/issues');
      });
    });
  });
});
