// test/mocks/app-modules.ts

// Mock UI modules
const mockWindowManager = {
  showPreview: jest.fn(),
  hidePreview: jest.fn(),
  reloadPreview: jest.fn(),
  togglePreviewDevTools: jest.fn(),
  getNativeInput: jest.fn(),
  getBagItMetadata: jest.fn(),
};

jest.mock('../../src/main/ui/window-manager', () => mockWindowManager);

const mockMultiWindowManager = {
  closeAllWindows: jest.fn(),
  restoreWindowStates: jest.fn(),
  getAllWebsiteWindows: jest.fn(() => new Map()),
  createWebsiteWindow: jest.fn((_websiteName: string, _websitePath?: string) => ({})), // Return mock object
  loadWebsiteContent: jest.fn((_websiteName: string) => {}),
  getWebsiteWindow: jest.fn((_websiteName: string) => null),
  saveWindowStates: jest.fn(),
  setupServerManagerEventListeners: jest.fn(),
};

jest.mock('../../src/main/ui/multi-window-manager', () => mockMultiWindowManager);

const mockAppMenu = {
  createApplicationMenu: jest.fn(),
  updateApplicationMenu: jest.fn(),
};

jest.mock('../../src/main/ui/menu', () => mockAppMenu);

// Mock individual IPC modules
jest.mock('../../src/main/ipc/website', () => ({
  setupWebsiteHandlers: jest.fn(),
}));

jest.mock('../../src/main/ipc/file', () => ({
  setupFileHandlers: jest.fn(),
}));

jest.mock('../../src/main/ipc/preview', () => ({
  setupPreviewHandlers: jest.fn(),
}));

jest.mock('../../src/main/ipc/export', () => ({
  setupExportHandlers: jest.fn(),
}));

// Mock IPC handlers module
const mockIpcHandlers = {
  setupIpcMainListeners: jest.fn(),
};

jest.mock('../../src/main/ipc/handlers', () => mockIpcHandlers);

const mockStoreInstance = {
  get: jest.fn(),
  set: jest.fn(),
  saveWindowStates: jest.fn(),
  getWindowStates: jest.fn(() => [] as unknown[]), // Default for multi-window-manager
  clearWindowStates: jest.fn(),
  getAll: jest.fn(() => ({})),
  setAll: jest.fn(),
  forceSave: jest.fn(() => Promise.resolve()),
};

// Store class removed - now using DI with StoreService

// Mock the service registry to provide mocked services
jest.mock('../../src/main/core/service-registry', () => ({
  initializeGlobalContext: jest.fn(() => Promise.resolve()),
  getGlobalContext: () => ({
    getService: (key: string) => {
      if (key === 'store') {
        return mockStoreInstance;
      }
      throw new Error(`Unknown service: ${key}`);
    },
  }),
  shutdownGlobalContext: jest.fn(() => Promise.resolve()),
}));

const mockFirstLaunch = {
  handleFirstLaunch: jest.fn(),
};

jest.mock('../../src/main/utils/first-launch', () => mockFirstLaunch);

const mockEleventy = {
  getCurrentLiveServerUrl: jest.fn(() => 'https://anglesite.test:8080'), // Default for multi-window-manager
  isLiveServerReady: jest.fn(() => true),
  setLiveServerUrl: jest.fn(),
  setCurrentWebsiteName: jest.fn(),
};

jest.mock('../../src/main/server/eleventy', () => mockEleventy);

const mockHttpsProxy = {
  createHttpsProxy: jest.fn(),
  restartHttpsProxy: jest.fn(),
};

jest.mock('../../src/main/server/https-proxy', () => mockHttpsProxy);

const mockHostsManager = {
  addLocalDnsResolution: jest.fn(),
  cleanupHostsFile: jest.fn(),
  checkAndSuggestTouchIdSetup: jest.fn(),
};

jest.mock('../../src/main/dns/hosts-manager', () => mockHostsManager);

const mockThemeManager = {
  initialize: jest.fn(),
  applyThemeToWindow: jest.fn(),
};

jest.mock('../../src/main/ui/theme-manager', () => ({ themeManager: mockThemeManager }));

const mockWebsiteManager = {
  createWebsiteWithName: jest.fn(),
  validateWebsiteName: jest.fn(),
  listWebsites: jest.fn(() => ['test-site', 'my-website']),
  getWebsitePath: jest.fn(),
  renameWebsite: jest.fn(),
  deleteWebsite: jest.fn(),
};

jest.mock('../../src/main/utils/website-manager', () => mockWebsiteManager);

const mockTemplateLoader = {
  loadTemplateAsDataUrl: jest.fn((templateName: string) => {
    return `data:text/html;charset=utf-8,<h1>Mock ${templateName}</h1>`;
  }),
};

jest.mock('../../src/main/ui/template-loader', () => mockTemplateLoader);

const mockEnhancedFileWatcher = {
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  getMetrics: jest.fn(() => ({
    totalChanges: 0,
    totalRebuilds: 0,
    averageRebuildTime: 0,
    batchedChanges: 0,
    ignoredChanges: 0,
    peakMemoryUsage: 0,
    startTime: Date.now(),
  })),
};

jest.mock('../../src/main/server/enhanced-file-watcher', () => ({
  createEnhancedFileWatcher: jest.fn(() => mockEnhancedFileWatcher),
  EnhancedFileWatcher: jest.fn().mockImplementation(() => mockEnhancedFileWatcher),
}));

// Path is already mocked by node-modules.ts

export const resetAppModulesMocks = () => {
  mockWindowManager.showPreview.mockClear();
  mockWindowManager.hidePreview.mockClear();
  mockWindowManager.reloadPreview.mockClear();
  mockWindowManager.togglePreviewDevTools.mockClear();
  mockWindowManager.getNativeInput.mockClear();
  mockWindowManager.getBagItMetadata.mockClear();

  mockMultiWindowManager.closeAllWindows.mockClear();
  mockMultiWindowManager.restoreWindowStates.mockClear();
  mockMultiWindowManager.getAllWebsiteWindows.mockClear();
  mockMultiWindowManager.getAllWebsiteWindows.mockReturnValue(new Map()); // Restore implementation
  mockMultiWindowManager.createWebsiteWindow.mockClear();
  mockMultiWindowManager.createWebsiteWindow.mockImplementation((_websiteName: string, _websitePath?: string) => ({})); // Restore implementation
  mockMultiWindowManager.loadWebsiteContent.mockClear();
  mockMultiWindowManager.loadWebsiteContent.mockImplementation((_websiteName: string) => {}); // Restore implementation
  mockMultiWindowManager.getWebsiteWindow.mockClear();
  mockMultiWindowManager.getWebsiteWindow.mockImplementation((_websiteName: string) => null); // Restore implementation
  mockMultiWindowManager.saveWindowStates.mockClear();

  mockAppMenu.createApplicationMenu.mockClear();
  mockAppMenu.updateApplicationMenu.mockClear();

  mockIpcHandlers.setupIpcMainListeners.mockClear();

  // Store mock instance needs special handling to preserve implementation
  const getImpl = mockStoreInstance.get.getMockImplementation();
  const setImpl = mockStoreInstance.set.getMockImplementation();
  const saveWindowStatesImpl = mockStoreInstance.saveWindowStates.getMockImplementation();
  const getWindowStatesImpl = mockStoreInstance.getWindowStates.getMockImplementation();
  const clearWindowStatesImpl = mockStoreInstance.clearWindowStates.getMockImplementation();
  const getAllImpl = mockStoreInstance.getAll.getMockImplementation();
  const setAllImpl = mockStoreInstance.setAll.getMockImplementation();
  const forceSaveImpl = mockStoreInstance.forceSave.getMockImplementation();

  mockStoreInstance.get.mockClear();
  mockStoreInstance.set.mockClear();
  mockStoreInstance.saveWindowStates.mockClear();
  mockStoreInstance.getWindowStates.mockClear();
  mockStoreInstance.clearWindowStates.mockClear();
  mockStoreInstance.getAll.mockClear();
  mockStoreInstance.setAll.mockClear();
  mockStoreInstance.forceSave.mockClear();

  if (getImpl) mockStoreInstance.get.mockImplementation(getImpl);
  if (setImpl) mockStoreInstance.set.mockImplementation(setImpl);
  if (saveWindowStatesImpl) mockStoreInstance.saveWindowStates.mockImplementation(saveWindowStatesImpl);
  if (getWindowStatesImpl) mockStoreInstance.getWindowStates.mockImplementation(getWindowStatesImpl);
  if (clearWindowStatesImpl) mockStoreInstance.clearWindowStates.mockImplementation(clearWindowStatesImpl);
  if (getAllImpl) mockStoreInstance.getAll.mockImplementation(getAllImpl);
  if (setAllImpl) mockStoreInstance.setAll.mockImplementation(setAllImpl);
  if (forceSaveImpl) mockStoreInstance.forceSave.mockImplementation(forceSaveImpl);

  mockFirstLaunch.handleFirstLaunch.mockClear();

  mockEleventy.getCurrentLiveServerUrl.mockClear();
  mockEleventy.isLiveServerReady.mockClear();
  mockEleventy.setLiveServerUrl.mockClear();
  mockEleventy.setCurrentWebsiteName.mockClear();

  mockHttpsProxy.createHttpsProxy.mockClear();
  mockHttpsProxy.restartHttpsProxy.mockClear();

  mockHostsManager.addLocalDnsResolution.mockClear();
  mockHostsManager.cleanupHostsFile.mockClear();
  mockHostsManager.checkAndSuggestTouchIdSetup.mockClear();

  mockThemeManager.initialize.mockClear();
  mockThemeManager.applyThemeToWindow.mockClear();

  mockWebsiteManager.createWebsiteWithName.mockClear();
  mockWebsiteManager.validateWebsiteName.mockClear();
  mockWebsiteManager.listWebsites.mockClear();
  mockWebsiteManager.getWebsitePath.mockClear();
  mockWebsiteManager.renameWebsite.mockClear();
  mockWebsiteManager.deleteWebsite.mockClear();

  mockTemplateLoader.loadTemplateAsDataUrl.mockClear();

  mockEnhancedFileWatcher.start.mockClear();
  mockEnhancedFileWatcher.stop.mockClear();
  mockEnhancedFileWatcher.getMetrics.mockClear();
};

export {
  mockWindowManager,
  mockMultiWindowManager,
  mockAppMenu,
  mockIpcHandlers,
  mockStoreInstance,
  mockFirstLaunch,
  mockEleventy,
  mockHttpsProxy,
  mockHostsManager,
  mockThemeManager,
  mockWebsiteManager,
  mockTemplateLoader,
  mockEnhancedFileWatcher,
};
