/**
 * @file Application menu creation
 */
import { Menu, MenuItemConstructorOptions, shell, WebContents, BrowserWindow, dialog } from 'electron';
import { openSettingsWindow, openAboutWindow, getNativeInput, openWebsiteSelectionWindow } from './window-manager';
import { getAllWebsiteWindows, isWebsiteEditorFocused, getHelpWindow, createHelpWindow } from './multi-window-manager';
import { createWebsiteWithName, validateWebsiteName } from '../utils/website-manager';
import { openWebsiteInNewWindow } from '../ipc/website';
import { exportSiteHandler } from '../ipc/export';
import { cleanupHostsFile } from '../dns/hosts-manager';
import { installCAInSystem, isCAInstalledInSystem } from '../certificates';
import { IStore } from '../core/interfaces';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';

/**
 * Check if the current focused window is a website window or website editor.
 */
function isWebsiteWindowFocused(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return false;

  // Check if the website editor window is focused
  if (isWebsiteEditorFocused()) {
    return true;
  }

  // Check if this window is in our website windows map
  const websiteWindows = getAllWebsiteWindows();
  for (const [, websiteWindow] of Array.from(websiteWindows)) {
    if (websiteWindow.window === focusedWindow) {
      return true;
    }
  }
  return false;
}

/**
 * Build a list of recent websites for the Open Recent submenu.
 */
export function buildRecentWebsitesList(): MenuItemConstructorOptions[] {
  let recentWebsites: string[] = [];

  try {
    const store = getGlobalContext().getService<IStore>(ServiceKeys.STORE);
    recentWebsites = store.getRecentWebsites();
  } catch {
    // Global context not available (e.g., during tests)
    recentWebsites = [];
  }

  const menuItems: MenuItemConstructorOptions[] = [];

  if (recentWebsites.length === 0) {
    menuItems.push({
      label: 'No Recent Websites',
      enabled: false,
    });
  } else {
    // Add recent websites
    recentWebsites.forEach((websiteName, index) => {
      menuItems.push({
        label: websiteName,
        accelerator: index < 9 ? `CmdOrCtrl+${index + 1}` : undefined,
        click: async () => {
          try {
            await openWebsiteInNewWindow(websiteName);
          } catch (error) {
            console.error(`Failed to open recent website ${websiteName}:`, error);
            dialog.showErrorBox(
              'Failed to Open Website',
              `Could not open website "${websiteName}": ${error instanceof Error ? error.message : String(error)}`
            );
            // Remove invalid website from recent list
            try {
              const store = getGlobalContext().getService<IStore>(ServiceKeys.STORE);
              store.removeRecentWebsite(websiteName);
            } catch {
              // Can't remove from store if context not available
            }
            // Update menu to reflect the change
            updateApplicationMenu();
          }
        },
      });
    });
  }

  // Add separator and clear menu option
  if (recentWebsites.length > 0) {
    menuItems.push(
      { type: 'separator' },
      {
        label: 'Clear Menu',
        click: () => {
          try {
            const store = getGlobalContext().getService<IStore>(ServiceKeys.STORE);
            store.clearRecentWebsites();
            updateApplicationMenu();
          } catch {
            // Can't clear recent websites if context not available
          }
        },
      }
    );
  }

  return menuItems;
}

/**
 * Build a list of open windows for the Window menu.
 */
export function buildWindowList(): MenuItemConstructorOptions[] {
  const windowMenuItems: MenuItemConstructorOptions[] = [];
  const focusedWindow = BrowserWindow.getFocusedWindow();

  // Add help window if it exists
  const helpWindow = getHelpWindow();
  if (helpWindow && !helpWindow.isDestroyed()) {
    const isChecked = helpWindow === focusedWindow;
    windowMenuItems.push({
      label: helpWindow.getTitle(),
      type: 'checkbox',
      checked: isChecked,
      click: () => {
        helpWindow.focus();
      },
    });
  }

  // Add website windows
  const websiteWindows = getAllWebsiteWindows();
  const websiteWindowsArray = websiteWindows ? Array.from(websiteWindows.values()) : [];
  websiteWindowsArray.forEach((websiteWindow) => {
    if (!websiteWindow.window.isDestroyed()) {
      const isChecked = websiteWindow.window === focusedWindow;
      windowMenuItems.push({
        label: websiteWindow.window.getTitle(),
        type: 'checkbox',
        checked: isChecked,
        click: () => {
          websiteWindow.window.focus();
        },
      });
    }
  });

  // If no windows are open, show a disabled item
  if (windowMenuItems.length === 0) {
    windowMenuItems.push({
      label: 'No Windows Open',
      enabled: false,
    });
  }

  return windowMenuItems;
}

/**
 * Update the application menu when window focus changes.
 */
export function updateApplicationMenu(): void {
  const menu = createApplicationMenu();
  Menu.setApplicationMenu(menu);
}

/**
 * Constructs the complete application menu structure with all submenus and menu items.
 */
export function createApplicationMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Anglesite',
      submenu: [
        {
          label: 'About Anglesite',
          click: () => {
            openAboutWindow();
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            openSettingsWindow();
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Services',
          role: 'services',
          submenu: [],
        },
        {
          type: 'separator',
        },
        {
          label: 'Hide Anglesite',
          accelerator: 'Command+H',
          role: 'hide',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          role: 'hideOthers',
        },
        {
          label: 'Show All',
          role: 'unhide',
        },
        {
          type: 'separator',
        },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          role: 'quit',
        },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Website…',
          accelerator: 'CmdOrCtrl+N',
          click: async () => {
            // Create new website directly using imported functions

            try {
              let websiteName: string | null = null;
              let validationError = '';

              // Keep asking until user provides valid name or cancels
              do {
                let prompt = 'Enter a name for your new website:';
                if (validationError) {
                  prompt = `${validationError}\n\nPlease enter a valid website name:`;
                }

                websiteName = await getNativeInput('New Website', prompt);

                if (!websiteName) {
                  return; // User cancelled
                }

                // Validate website name
                const validation = validateWebsiteName(websiteName);
                if (!validation.valid) {
                  validationError = validation.error || 'Invalid website name';
                  websiteName = null; // Reset to continue the loop
                } else {
                  validationError = ''; // Clear any previous error
                }
              } while (!websiteName);

              // Create the website and open it
              const newWebsitePath = await createWebsiteWithName(websiteName);

              // Open the new website in a new window (with isNewWebsite = true)
              await openWebsiteInNewWindow(websiteName, newWebsitePath, true);

              // Add to recent websites and update menu
              const store = getGlobalContext().getService<IStore>(ServiceKeys.STORE);
              store.addRecentWebsite(websiteName);
              updateApplicationMenu();
            } catch (error) {
              console.error('Failed to create new website:', error);
              dialog.showErrorBox('Creation Failed', error instanceof Error ? error.message : String(error));
            }
          },
        },
        {
          label: 'Open Website…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            openWebsiteSelectionWindow();
          },
        },
        {
          label: 'Open Recent',
          submenu: buildRecentWebsitesList(),
        },
        {
          type: 'separator',
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          role: 'close',
          enabled: isWebsiteWindowFocused(),
        },
        {
          label: 'Duplicate',
          accelerator: 'CmdOrCtrl+D',
          enabled: isWebsiteWindowFocused(),
          click: async () => {
            // TODO: Implement website duplication functionality
            dialog.showMessageBox({
              type: 'info',
              title: 'Feature Coming Soon',
              message: 'Website duplication is not yet implemented.',
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Rename',
          enabled: isWebsiteWindowFocused(),
          click: async () => {
            // TODO: Implement website rename functionality
            dialog.showMessageBox({
              type: 'info',
              title: 'Feature Coming Soon',
              message: 'Website renaming is not yet implemented.',
              buttons: ['OK'],
            });
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Share…',
          enabled: isWebsiteWindowFocused(),
          click: async () => {
            // TODO: Implement website sharing functionality
            dialog.showMessageBox({
              type: 'info',
              title: 'Feature Coming Soon',
              message: 'Website sharing is not yet implemented.',
              buttons: ['OK'],
            });
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Export To',
          enabled: isWebsiteWindowFocused(),
          submenu: [
            {
              label: 'Folder',
              accelerator: 'CmdOrCtrl+E',
              click: async () => {
                await exportSiteHandler(null, false);
              },
            },
            {
              label: 'Zip Archive',
              accelerator: 'CmdOrCtrl+Shift+E',
              click: async () => {
                await exportSiteHandler(null, true);
              },
            },
            {
              label: 'BagIt Archive',
              accelerator: 'CmdOrCtrl+Alt+E',
              click: async () => {
                await exportSiteHandler(null, 'bagit');
              },
            },
          ],
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          role: 'undo',
        },
        {
          label: 'Redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          role: 'redo',
        },
        {
          type: 'separator',
        },
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          role: 'cut',
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          role: 'copy',
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          role: 'paste',
        },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          role: 'selectAll',
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: (_, browserWindow) => {
            if (browserWindow && 'webContents' in browserWindow) {
              (browserWindow.webContents as WebContents).send('reload-preview');
            }
          },
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_, browserWindow) => {
            if (browserWindow && 'webContents' in browserWindow) {
              (browserWindow.webContents as WebContents).reloadIgnoringCache();
            }
          },
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: (_, browserWindow) => {
            if (browserWindow && 'webContents' in browserWindow) {
              // Check if this is a website editor window
              const websiteWindows = getAllWebsiteWindows();
              let websiteWindow = null;

              for (const [, wsWindow] of Array.from(websiteWindows)) {
                if (wsWindow.window === browserWindow) {
                  websiteWindow = wsWindow;
                  break;
                }
              }

              if (websiteWindow && websiteWindow.webContentsView) {
                // For website editor windows, toggle DevTools for the preview WebContentsView
                const webContents = websiteWindow.webContentsView.webContents;
                if (webContents.isDevToolsOpened()) {
                  webContents.closeDevTools();
                } else {
                  webContents.openDevTools();
                }
              } else {
                // For other windows (settings, etc.), toggle DevTools for the main window
                const webContents = browserWindow.webContents as WebContents;
                if (webContents.isDevToolsOpened()) {
                  webContents.closeDevTools();
                } else {
                  webContents.openDevTools();
                }
              }
            }
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          role: 'resetZoom',
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          role: 'zoomIn',
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          role: 'zoomOut',
        },
        {
          type: 'separator',
        },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'Ctrl+Command+F',
          role: 'togglefullscreen',
        },
      ],
    },
    {
      label: 'Website',
      submenu: [
        {
          label: 'Publish…',
          enabled: isWebsiteWindowFocused(),
          click: async () => {
            // TODO: Implement website publishing functionality
            dialog.showMessageBox({
              type: 'info',
              title: 'Feature Coming Soon',
              message: 'Website publishing is not yet implemented.',
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Website Metadata…',
          enabled: isWebsiteWindowFocused(),
          click: async () => {
            // TODO: Implement website metadata editing
            dialog.showMessageBox({
              type: 'info',
              title: 'Feature Coming Soon',
              message: 'Website metadata editing is not yet implemented.',
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Theme',
          enabled: isWebsiteWindowFocused(),
          submenu: [
            {
              label: 'Change Theme…',
              click: async () => {
                // TODO: Implement theme changing functionality
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Feature Coming Soon',
                  message: 'Theme changing is not yet implemented.',
                  buttons: ['OK'],
                });
              },
            },
            {
              label: 'Save Theme…',
              click: async () => {
                // TODO: Implement theme saving functionality
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Feature Coming Soon',
                  message: 'Theme saving is not yet implemented.',
                  buttons: ['OK'],
                });
              },
            },
          ],
        },
        {
          label: 'Server',
          enabled: isWebsiteWindowFocused(),
          submenu: [
            {
              label: 'Bonjour',
              type: 'checkbox',
              checked: false,
              click: async () => {
                // TODO: Implement Bonjour service discovery
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Feature Coming Soon',
                  message: 'Bonjour service discovery is not yet implemented.',
                  buttons: ['OK'],
                });
              },
            },
            {
              label: 'Restart',
              click: (_, browserWindow) => {
                if (browserWindow && 'webContents' in browserWindow) {
                  (browserWindow.webContents as WebContents).send('restart-server');
                }
              },
            },
            {
              label: 'Server Settings…',
              click: async () => {
                // TODO: Implement server settings dialog
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Feature Coming Soon',
                  message: 'Server settings configuration is not yet implemented.',
                  buttons: ['OK'],
                });
              },
            },
          ],
        },
        {
          label: 'Advanced',
          submenu: [
            {
              label: 'Install HTTPS Certificate',
              click: async () => {
                try {
                  // Check if already installed
                  const alreadyInstalled = await isCAInstalledInSystem();
                  if (alreadyInstalled) {
                    dialog.showMessageBox({
                      type: 'info',
                      title: 'Certificate Already Installed',
                      message: 'The HTTPS certificate is already installed in your system keychain.',
                      buttons: ['OK'],
                    });
                    return;
                  }

                  const installed = await installCAInSystem();
                  if (installed) {
                    dialog.showMessageBox({
                      type: 'info',
                      title: 'Certificate Installed',
                      message: 'HTTPS certificate has been installed successfully. Your sites will now load with trusted SSL.',
                      buttons: ['OK'],
                    });
                  } else {
                    dialog.showMessageBox({
                      type: 'warning',
                      title: 'Installation Failed',
                      message: 'Could not install the HTTPS certificate. Sites will still work but may show security warnings.',
                      buttons: ['OK'],
                    });
                  }
                } catch (error) {
                  dialog.showErrorBox(
                    'Certificate Installation Error',
                    `Failed to install certificate: ${error instanceof Error ? error.message : String(error)}`
                  );
                }
              },
            },
            {
              label: 'Clean Up DNS Entries',
              click: async () => {
                try {
                  const success = await cleanupHostsFile();
                  if (success) {
                    dialog.showMessageBox({
                      type: 'info',
                      title: 'DNS Cleanup Complete',
                      message: 'Orphaned .test domain entries have been cleaned up from your hosts file.',
                      buttons: ['OK'],
                    });
                  } else {
                    dialog.showMessageBox({
                      type: 'warning',
                      title: 'DNS Cleanup Failed',
                      message: 'Could not clean up hosts file. Administrator privileges may be required.',
                      buttons: ['OK'],
                    });
                  }
                } catch (error) {
                  dialog.showErrorBox(
                    'DNS Cleanup Error',
                    `Failed to clean up hosts file: ${error instanceof Error ? error.message : String(error)}`
                  );
                }
              },
            },
            {
              type: 'separator',
            },
            {
              label: 'Language & Region',
              enabled: isWebsiteWindowFocused(),
              click: async () => {
                // TODO: Implement language and region settings
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Feature Coming Soon',
                  message: 'Language & Region settings are not yet implemented.',
                  buttons: ['OK'],
                });
              },
            },
          ],
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+M',
          role: 'minimize',
        },
        {
          type: 'separator',
        },
        {
          label: 'Merge All Windows',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.mergeAllWindows();
            }
          },
        },
        {
          label: 'Move Tab to New Window',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.moveTabToNewWindow();
            }
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Bring All to Front',
          role: 'front',
        },
        {
          type: 'separator',
        },
        ...buildWindowList(),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Anglesite Help',
          click: async () => {
            createHelpWindow();
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/anglesite/anglesite/issues');
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
