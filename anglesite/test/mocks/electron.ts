// test/mocks/electron.ts

const mockApp = {
  setName: jest.fn(),
  whenReady: jest.fn(() => Promise.resolve()),
  on: jest.fn(),
  quit: jest.fn(),
  commandLine: {
    appendSwitch: jest.fn(),
  },
  getPath: jest.fn(() => '/mock/path'),
};

const mockMenu = Object.assign(
  jest.fn(() => ({
    append: jest.fn(),
    popup: jest.fn(),
  })),
  {
    setApplicationMenu: jest.fn(),
    buildFromTemplate: jest.fn(),
  }
);

const mockMenuItem = jest.fn();

const mockBrowserWindow = {
  isDestroyed: jest.fn(() => false),
  isMaximized: jest.fn(() => false),
  focus: jest.fn(),
  show: jest.fn(),
  close: jest.fn(() => {
    // Mark window as destroyed when close is called
    mockBrowserWindow.isDestroyed.mockReturnValue(true);
    // Emit closed event when close is called synchronously
    const closedHandler = mockBrowserWindow.on.mock.calls.find((call) => call[0] === 'closed');
    if (closedHandler && closedHandler[1]) {
      closedHandler[1]();
    }
  }),
  getBounds: jest.fn(() => ({ width: 1200, height: 800, x: 0, y: 0 })),
  setBounds: jest.fn(),
  maximize: jest.fn(),
  getTitle: jest.fn(() => 'Test Window'),
  on: jest.fn(),
  once: jest.fn(),
  loadFile: jest.fn(),
  webContents: {
    send: jest.fn(),
    isLoading: jest.fn(() => false),
    executeJavaScript: jest.fn(() => Promise.resolve()),
    once: jest.fn(),
  },
  contentView: {
    addChildView: jest.fn(),
    children: [],
  },
};

const mockWebContents = {
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  loadURL: jest.fn(() => Promise.resolve()),
  reload: jest.fn(),
};

const mockWebContentsView = {
  webContents: mockWebContents,
  setBounds: jest.fn(),
};

const mockIpcMain = {
  on: jest.fn(),
  handle: jest.fn(),
  removeListener: jest.fn(),
};

const mockDialog = {
  showMessageBox: jest.fn(),
  showMessageBoxSync: jest.fn(),
  showSaveDialog: jest.fn(),
  showSaveDialogSync: jest.fn(),
  showOpenDialog: jest.fn(),
  showOpenDialogSync: jest.fn(),
  showErrorBox: jest.fn(),
};

const mockShell = {
  openExternal: jest.fn(),
  showItemInFolder: jest.fn(),
};

const mockNativeTheme = {
  shouldUseDarkColors: false,
  on: jest.fn(),
};

// Create the BrowserWindow constructor with static methods
const BrowserWindowConstructor = Object.assign(
  jest.fn(() => {
    return mockBrowserWindow;
  }),
  {
    fromWebContents: jest.fn(),
    getAllWindows: jest.fn(() => []),
    getFocusedWindow: jest.fn(),
  }
);

jest.mock('electron', () => ({
  app: mockApp,
  Menu: mockMenu,
  MenuItem: mockMenuItem,
  BrowserWindow: BrowserWindowConstructor,
  WebContentsView: jest.fn(() => mockWebContentsView), // Use a factory for WebContentsView
  ipcMain: mockIpcMain,
  dialog: mockDialog,
  shell: mockShell,
  nativeTheme: mockNativeTheme,
}));

// Child process is already mocked by node-modules.ts
// No need to mock it again here

// Function to reset all Electron mocks
export const resetElectronMocks = () => {
  mockApp.setName.mockClear();
  mockApp.whenReady.mockClear();
  mockApp.whenReady.mockReturnValue(Promise.resolve()); // Ensure whenReady returns Promise
  mockApp.on.mockClear();
  mockApp.quit.mockClear();
  mockApp.commandLine.appendSwitch.mockClear();
  mockApp.getPath.mockClear();

  mockMenu.mockClear();
  mockMenu.setApplicationMenu.mockClear();
  mockMenu.buildFromTemplate.mockClear();
  mockMenuItem.mockClear();

  // Reset BrowserWindow static methods
  BrowserWindowConstructor.mockClear();
  BrowserWindowConstructor.mockImplementation(() => {
    return mockBrowserWindow;
  });
  BrowserWindowConstructor.fromWebContents.mockClear();
  BrowserWindowConstructor.getAllWindows.mockClear();
  BrowserWindowConstructor.getAllWindows.mockReturnValue([]);
  BrowserWindowConstructor.getFocusedWindow.mockClear();

  // Reset BrowserWindow mock instance methods
  mockBrowserWindow.isDestroyed.mockClear();
  mockBrowserWindow.isDestroyed.mockReturnValue(false);
  mockBrowserWindow.isMaximized.mockClear();
  mockBrowserWindow.isMaximized.mockReturnValue(false);
  mockBrowserWindow.focus.mockClear();
  mockBrowserWindow.show.mockClear();
  mockBrowserWindow.close.mockClear();
  mockBrowserWindow.close.mockImplementation(() => {
    // Mark window as destroyed when close is called
    mockBrowserWindow.isDestroyed.mockReturnValue(true);
    // Emit closed event when close is called synchronously
    const closedHandler = mockBrowserWindow.on.mock.calls.find((call) => call[0] === 'closed');
    if (closedHandler && closedHandler[1]) {
      closedHandler[1]();
    }
  });
  mockBrowserWindow.getBounds.mockClear();
  mockBrowserWindow.getBounds.mockReturnValue({ width: 1200, height: 800, x: 0, y: 0 });
  mockBrowserWindow.setBounds.mockClear();
  mockBrowserWindow.maximize.mockClear();
  mockBrowserWindow.getTitle.mockClear();
  mockBrowserWindow.getTitle.mockReturnValue('Test Window');
  mockBrowserWindow.on.mockClear();
  mockBrowserWindow.once.mockClear();
  mockBrowserWindow.loadFile.mockClear();
  mockBrowserWindow.webContents.send.mockClear();
  mockBrowserWindow.webContents.isLoading.mockClear();
  mockBrowserWindow.webContents.isLoading.mockReturnValue(false);
  mockBrowserWindow.webContents.executeJavaScript.mockClear();
  mockBrowserWindow.webContents.executeJavaScript.mockResolvedValue(undefined);
  mockBrowserWindow.webContents.once.mockClear();
  mockBrowserWindow.contentView.addChildView.mockClear();
  mockBrowserWindow.contentView.children = []; // Reset children array

  // Reset WebContents mock instance methods
  mockWebContents.on.mockClear();
  mockWebContents.removeAllListeners.mockClear();
  mockWebContents.loadURL.mockClear();
  mockWebContents.loadURL.mockResolvedValue(undefined);
  mockWebContents.reload.mockClear();

  // Reset WebContentsView mock instance methods
  mockWebContentsView.webContents = mockWebContents; // Ensure webContents is reset
  mockWebContentsView.setBounds.mockClear();

  mockIpcMain.on.mockClear();
  mockIpcMain.handle.mockClear();
  mockIpcMain.removeListener.mockClear();

  mockDialog.showMessageBox.mockClear();
  mockDialog.showMessageBoxSync.mockClear();
  mockDialog.showSaveDialog.mockClear();
  mockDialog.showSaveDialogSync.mockClear();
  mockDialog.showOpenDialog.mockClear();
  mockDialog.showOpenDialogSync.mockClear();
  mockDialog.showErrorBox.mockClear();

  mockShell.openExternal.mockClear();
  mockShell.showItemInFolder.mockClear();

  mockNativeTheme.shouldUseDarkColors = false; // Reset to default
  mockNativeTheme.on.mockClear();
};

// Export individual mocks for direct access in tests if needed
export {
  mockApp,
  mockMenu,
  mockMenuItem,
  mockBrowserWindow,
  BrowserWindowConstructor,
  mockWebContents,
  mockWebContentsView,
  mockIpcMain,
  mockDialog,
  mockShell,
  mockNativeTheme,
};
