/**
 * @file Simplified tests for menu functionality
 */

// Mock electron modules
const mockBrowserWindow = {
  getFocusedWindow: jest.fn(),
};

const mockMenu = {
  buildFromTemplate: jest.fn(),
  setApplicationMenu: jest.fn(),
};

const mockApp = {
  getPath: jest.fn(() => '/mock/user/data'),
};

jest.mock('electron', () => ({
  Menu: mockMenu,
  BrowserWindow: mockBrowserWindow,
  app: mockApp,
  shell: { openExternal: jest.fn() },
  clipboard: { writeText: jest.fn() },
}));

// Mock dependencies
jest.mock('../../src/main/ui/multi-window-manager', () => ({
  getHelpWindow: jest.fn(),
  getAllWebsiteWindows: jest.fn(() => new Map()),
  createHelpWindow: jest.fn(),
  isWebsiteEditorFocused: jest.fn(),
}));

jest.mock('../../src/main/ui/window-manager', () => ({
  openSettingsWindow: jest.fn(),
  openWebsiteSelectionWindow: jest.fn(),
  getNativeInput: jest.fn(),
}));

jest.mock('../../src/main/ipc/handlers', () => ({
  exportSiteHandler: jest.fn(),
  openWebsiteInNewWindow: jest.fn(),
}));

jest.mock('../../src/main/utils/website-manager', () => ({
  createWebsiteWithName: jest.fn(),
  validateWebsiteName: jest.fn(),
}));

import * as menu from '../../src/main/ui/menu';

describe('Menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    it('should create a menu template', () => {
      const mockMenuInstance = { items: [] };
      mockMenu.buildFromTemplate.mockReturnValue(mockMenuInstance);

      const result = menu.createApplicationMenu();

      expect(mockMenu.buildFromTemplate).toHaveBeenCalledWith(expect.any(Array));
      expect(result).toBe(mockMenuInstance);
    });
  });

  describe('isWebsiteWindowFocused', () => {
    it('should return false when no window is focused', () => {
      mockBrowserWindow.getFocusedWindow.mockReturnValue(null);
      const { isWebsiteEditorFocused } = require('../../src/main/ui/multi-window-manager');
      isWebsiteEditorFocused.mockReturnValue(false);

      // Since isWebsiteWindowFocused is not exported, we test it indirectly via createApplicationMenu
      menu.createApplicationMenu();
      expect(mockBrowserWindow.getFocusedWindow).toHaveBeenCalled();
    });
  });
});
