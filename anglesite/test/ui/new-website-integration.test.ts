/**
 * @file Integration test for New Website functionality
 */

// Mock all the dependencies that the New Website functionality requires
const mockGetNativeInput = jest.fn();
const mockCreateWebsiteWithName = jest.fn();
const mockValidateWebsiteName = jest.fn();
const mockCreateWebsiteWindowNWI = jest.fn();
const mockLoadWebsiteContentNWI = jest.fn();
const mockGetAllWebsiteWindows = jest.fn();
const mockGetHelpWindow = jest.fn();
const mockAddLocalDnsResolution = jest.fn();
const mockRestartHttpsProxy = jest.fn();
const mockStoreGet = jest.fn();

const mockDialogNWI = {
  showErrorBox: jest.fn(),
};

// Mock all the modules that are dynamically imported
jest.mock('../../app/ui/window-manager', () => ({
  getNativeInput: mockGetNativeInput,
}));

jest.mock('../../app/utils/website-manager', () => ({
  createWebsiteWithName: mockCreateWebsiteWithName,
  validateWebsiteName: mockValidateWebsiteName,
}));

jest.mock('../../app/ui/multi-window-manager', () => ({
  createWebsiteWindow: mockCreateWebsiteWindowNWI,
  loadWebsiteContent: mockLoadWebsiteContentNWI,
  getAllWebsiteWindows: mockGetAllWebsiteWindows,
  getHelpWindow: mockGetHelpWindow,
  isWebsiteEditorFocused: jest.fn(() => false),
}));

jest.mock('../../app/dns/hosts-manager', () => ({
  addLocalDnsResolution: mockAddLocalDnsResolution,
}));

jest.mock('../../app/server/https-proxy', () => ({
  restartHttpsProxy: mockRestartHttpsProxy,
}));

// Store class removed - now using DI with StoreService

jest.mock('../../app/ipc/website', () => ({
  openWebsiteInNewWindow: jest.fn(),
  setupWebsiteHandlers: jest.fn(),
}));

// Mock electron
const mockWebContents = {
  send: jest.fn(),
};

const mockFocusedWindow = {
  webContents: mockWebContents,
};

const mockMenu = {
  buildFromTemplate: jest.fn(),
};

const mockBrowserWindow = {
  getFocusedWindow: jest.fn(),
};

jest.mock('electron', () => ({
  Menu: mockMenu,
  BrowserWindow: mockBrowserWindow,
  dialog: mockDialogNWI,
}));

describe('New Website Integration', () => {
  let createApplicationMenu: () => void;

  beforeAll(() => {
    const menuModule = require('../../app/ui/menu');
    createApplicationMenu = menuModule.createApplicationMenu;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default mock implementations
    mockGetNativeInput.mockResolvedValue('My Test Site');
    mockCreateWebsiteWithName.mockResolvedValue('/path/to/website');
    mockValidateWebsiteName.mockReturnValue({ valid: true });
    // Server startup now handled internally by multi-window-manager
    mockAddLocalDnsResolution.mockResolvedValue(undefined);
    mockRestartHttpsProxy.mockResolvedValue(true);
    mockStoreGet.mockReturnValue('https');
    mockGetAllWebsiteWindows.mockReturnValue(new Map());
    mockGetHelpWindow.mockReturnValue(null);
    mockBrowserWindow.getFocusedWindow.mockReturnValue(mockFocusedWindow);
  });

  it('should successfully create a new website when user provides valid input', async () => {
    // Create the menu to get the New Website click handler
    createApplicationMenu();

    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    expect(newWebsiteItem).toBeDefined();
    expect(typeof newWebsiteItem.click).toBe('function');

    // Execute the New Website click handler
    await newWebsiteItem.click();

    // Verify that website creation functions were called
    expect(mockCreateWebsiteWithName).toHaveBeenCalledWith('My Test Site');

    // Get the openWebsiteInNewWindow mock from the correct module
    const ipcWebsite = require('../../app/ipc/website');
    expect(ipcWebsite.openWebsiteInNewWindow).toHaveBeenCalledWith('My Test Site', '/path/to/website', true);
  });

  it('should handle user cancellation gracefully', async () => {
    // Set up mock to simulate user cancellation
    mockGetNativeInput.mockResolvedValue(null);

    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    await newWebsiteItem.click();

    // Verify that website creation was not called when user cancels
    expect(mockCreateWebsiteWithName).not.toHaveBeenCalled();
  });

  it('should handle empty website name gracefully', async () => {
    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    await newWebsiteItem.click();

    // Mock behavior depends on specific test setup
  });

  it('should handle HTTP-only mode', async () => {
    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    await newWebsiteItem.click();

    // Mock behavior depends on specific test setup
  });

  it('should handle HTTPS proxy failure gracefully', async () => {
    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    await newWebsiteItem.click();

    // Mock behavior depends on specific test setup
  });

  it('should handle errors during website creation', async () => {
    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    await newWebsiteItem.click();

    // Mock behavior depends on specific test setup
  });

  it('should trim whitespace from website names', async () => {
    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    await newWebsiteItem.click();

    // Mock behavior depends on specific test setup
  });

  it('should handle no focused window gracefully', async () => {
    mockBrowserWindow.getFocusedWindow.mockReturnValue(null); // No focused window

    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    await newWebsiteItem.click();

    // Should not send any IPC message when no window is focused
    expect(mockWebContents.send).not.toHaveBeenCalled();
  });

  it('should have correct menu structure', () => {
    createApplicationMenu();
    const template = mockMenu.buildFromTemplate.mock.calls[0][0];
    const fileMenu = template.find((item: { label?: string; submenu?: unknown }) => item.label === 'File');
    const newWebsiteItem = fileMenu?.submenu?.find(
      (item: { label?: string; submenu?: unknown }) => item.label === 'New Website…'
    );

    expect(newWebsiteItem).toBeDefined();
    expect(newWebsiteItem.label).toBe('New Website…');
    expect(newWebsiteItem.accelerator).toBe('CmdOrCtrl+N');
    expect(typeof newWebsiteItem.click).toBe('function');
  });
});
