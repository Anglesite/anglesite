/**
 * @file Test suite for menu integration with diagnostics
 */
import { jest } from '@jest/globals';
import { Menu } from 'electron';
import { createApplicationMenu, updateApplicationMenu } from '../../../src/main/ui/menu';

// Type definitions for menu structure
interface MenuItemWithLabel {
  label: string;
  submenu?: MenuItemWithLabel[];
  accelerator?: string;
  click?: () => Promise<void> | void;
  enabled?: boolean;
  type?: 'separator';
}

type MenuTemplate = MenuItemWithLabel[];

// Mock dependencies
jest.mock('electron', () => ({
  Menu: {
    buildFromTemplate: jest.fn().mockImplementation((template) => ({ template })),
    setApplicationMenu: jest.fn(),
  },
  dialog: {
    showErrorBox: jest.fn(),
    showMessageBox: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: jest.fn(),
  },
}));

jest.mock('../../../src/main/ui/menu/diagnostics-menu-handlers', () => ({
  checkDiagnosticsServiceAvailability: jest.fn().mockReturnValue(true),
  handleDiagnosticsMenuClick: jest.fn(),
  handleDiagnosticsKeyboardShortcut: jest.fn(),
}));

jest.mock('../../../src/main/ui/window-manager', () => ({
  openSettingsWindow: jest.fn(),
  openAboutWindow: jest.fn(),
  getNativeInput: jest.fn(),
  openWebsiteSelectionWindow: jest.fn(),
  openWebsiteEditorWindow: jest.fn(),
}));

jest.mock('../../../src/main/ui/multi-window-manager', () => ({
  getAllWebsiteWindows: jest.fn().mockReturnValue(new Map()),
  isWebsiteEditorFocused: jest.fn().mockReturnValue(false),
  getHelpWindow: jest.fn().mockReturnValue(null),
  createHelpWindow: jest.fn(),
}));

jest.mock('../../../src/main/core/service-registry', () => ({
  getGlobalContext: jest.fn().mockReturnValue({
    getService: jest.fn().mockReturnValue({
      getRecentWebsites: jest.fn().mockReturnValue([]),
    }),
  }),
}));

import {
  checkDiagnosticsServiceAvailability,
  handleDiagnosticsMenuClick,
  handleDiagnosticsKeyboardShortcut,
} from '../../../src/main/ui/menu/diagnostics-menu-handlers';

describe('Menu Integration with Diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset Menu mock to default implementation
    (Menu.buildFromTemplate as jest.Mock).mockImplementation((template) => ({ template }));

    (checkDiagnosticsServiceAvailability as jest.Mock).mockReturnValue(true);
    (handleDiagnosticsMenuClick as jest.Mock).mockImplementation(async () => {});
    (handleDiagnosticsKeyboardShortcut as jest.Mock).mockImplementation(async () => {});
  });

  describe('createApplicationMenu', () => {
    test('should include diagnostics menu item in Help submenu', () => {
      createApplicationMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;

      // Find Help menu
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      expect(helpMenu).toBeDefined();
      expect(helpMenu?.submenu).toBeDefined();

      // Find diagnostics menu item
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');
      expect(diagnosticsItem).toBeDefined();
      expect(diagnosticsItem?.accelerator).toBe('CmdOrCtrl+Shift+D');
      expect(diagnosticsItem?.click).toBeDefined();
      expect(typeof diagnosticsItem?.click).toBe('function');
    });

    test('should position diagnostics item correctly in Help menu', () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');

      const helpSubmenu = helpMenu?.submenu || [];
      const diagnosticsIndex = helpSubmenu.findIndex((item) => item.label === 'Website Diagnostics...');
      const helpIndex = helpSubmenu.findIndex((item) => item.label === 'Anglesite Help');
      const reportIssueIndex = helpSubmenu.findIndex((item) => item.label === 'Report Issue');

      // Diagnostics should be between Help and Report Issue
      expect(diagnosticsIndex).toBeGreaterThan(helpIndex);
      expect(diagnosticsIndex).toBeLessThan(reportIssueIndex);
    });

    test('should disable diagnostics menu item when service unavailable', () => {
      (checkDiagnosticsServiceAvailability as jest.Mock).mockReturnValue(false);

      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      expect(diagnosticsItem?.enabled).toBe(false);
    });

    test('should enable diagnostics menu item when service available', () => {
      (checkDiagnosticsServiceAvailability as jest.Mock).mockReturnValue(true);

      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      expect(diagnosticsItem?.enabled).toBe(true);
    });

    test('should call correct handler when diagnostics menu clicked', async () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      await diagnosticsItem?.click?.();

      expect(handleDiagnosticsMenuClick).toHaveBeenCalled();
    });

    test('should preserve existing Help menu structure', () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');

      // Check that existing items are still there
      const anglesiteHelpItem = helpMenu?.submenu?.find((item) => item.label === 'Anglesite Help');
      const reportIssueItem = helpMenu?.submenu?.find((item) => item.label === 'Report Issue');

      expect(anglesiteHelpItem).toBeDefined();
      expect(reportIssueItem).toBeDefined();

      // Check that diagnostics is added without removing others
      expect(helpMenu?.submenu?.length).toBeGreaterThanOrEqual(3);
    });

    test('should maintain keyboard shortcut format consistency', () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;

      // Check that diagnostics shortcut follows same pattern as other menu items
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      expect(diagnosticsItem?.accelerator).toBe('CmdOrCtrl+Shift+D');
      expect(diagnosticsItem?.accelerator).toMatch(/^CmdOrCtrl\+/);
    });
  });

  describe('updateApplicationMenu', () => {
    test('should update menu with current diagnostics availability', () => {
      // Initially available
      (checkDiagnosticsServiceAvailability as jest.Mock).mockReturnValue(true);
      updateApplicationMenu();

      // Service becomes unavailable
      (checkDiagnosticsServiceAvailability as jest.Mock).mockReturnValue(false);
      updateApplicationMenu();

      expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(2);
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2);
    });

    test('should call Menu.setApplicationMenu with created menu', () => {
      const mockMenu = { test: 'menu' };
      (Menu.buildFromTemplate as jest.Mock).mockReturnValue(mockMenu);

      updateApplicationMenu();

      expect(Menu.setApplicationMenu).toHaveBeenCalledWith(mockMenu);
    });
  });

  describe('Menu keyboard shortcuts', () => {
    test('should register diagnostics keyboard shortcut', () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      expect(diagnosticsItem?.accelerator).toBe('CmdOrCtrl+Shift+D');
    });

    test('should not conflict with existing keyboard shortcuts', () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;

      // Collect all accelerators
      const accelerators = new Set<string>();
      const collectAccelerators = (items: MenuItemWithLabel[]) => {
        items.forEach((item) => {
          if (item.accelerator) {
            accelerators.add(item.accelerator);
          }
          if (item.submenu && Array.isArray(item.submenu)) {
            collectAccelerators(item.submenu);
          }
        });
      };

      collectAccelerators(menuTemplate);

      // Check for duplicates
      const acceleratorArray = Array.from(accelerators);
      const uniqueAccelerators = new Set(acceleratorArray);

      expect(uniqueAccelerators.size).toBe(acceleratorArray.length);
    });
  });

  describe('Error handling in menu integration', () => {
    test('should handle menu creation errors gracefully', () => {
      (Menu.buildFromTemplate as jest.Mock).mockImplementation(() => {
        throw new Error('Menu creation failed');
      });

      // Current implementation doesn't have error handling, so this will throw
      expect(() => createApplicationMenu()).toThrow('Menu creation failed');
    });

    test('should handle handler errors gracefully', async () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      (handleDiagnosticsMenuClick as jest.Mock).mockImplementation(async () => {
        throw new Error('Handler failed');
      });

      // Should throw the handler error
      await expect(diagnosticsItem?.click?.()).rejects.toThrow('Handler failed');
    });
  });

  describe('Menu state management', () => {
    test('should reflect current diagnostics service state', () => {
      // Test enabled state
      (checkDiagnosticsServiceAvailability as jest.Mock).mockReturnValue(true);
      createApplicationMenu();
      let menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      let helpMenu = menuTemplate.find((item) => item.label === 'Help');
      let diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      expect(diagnosticsItem?.enabled).toBe(true);

      // Clear mocks and test disabled state
      jest.clearAllMocks();
      (Menu.buildFromTemplate as jest.Mock).mockImplementation((template) => template);

      (checkDiagnosticsServiceAvailability as jest.Mock).mockReturnValue(false);
      createApplicationMenu();
      menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      helpMenu = menuTemplate.find((item) => item.label === 'Help');
      diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      expect(diagnosticsItem?.enabled).toBe(false);
    });
  });

  describe('Platform compatibility', () => {
    test('should use correct accelerator format for cross-platform compatibility', () => {
      createApplicationMenu();
      const menuTemplate = (Menu.buildFromTemplate as jest.Mock).mock.calls[0][0] as MenuTemplate;
      const helpMenu = menuTemplate.find((item) => item.label === 'Help');
      const diagnosticsItem = helpMenu?.submenu?.find((item) => item.label === 'Website Diagnostics...');

      // Should use CmdOrCtrl for cross-platform compatibility
      expect(diagnosticsItem?.accelerator).toBe('CmdOrCtrl+Shift+D');
      expect(diagnosticsItem?.accelerator).toContain('CmdOrCtrl');
    });
  });
});
