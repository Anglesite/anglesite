/**
 * @file Tests for first launch setup flow utilities
 */

import { app, dialog } from 'electron';
import { handleFirstLaunch } from '../../src/main/utils/first-launch';
import { IStore } from '../../src/main/core/interfaces';
import { isCAInstalledInSystem, installCAInSystem } from '../../src/main/certificates';
import { showFirstLaunchAssistant } from '../../src/main/ui/window-manager';

// Mock dependencies
jest.mock('electron', () => ({
  app: {
    quit: jest.fn(),
  },
  dialog: {
    showMessageBoxSync: jest.fn(),
  },
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
  nativeTheme: {
    themeSource: 'system',
    on: jest.fn(),
    shouldUseDarkColors: false,
  },
}));

// Store class removed - now using DI with StoreService
jest.mock('../../src/main/certificates');
jest.mock('../../src/main/ui/window-manager');

const mockApp = app as jest.Mocked<typeof app>;
const mockDialog = dialog as jest.Mocked<typeof dialog>;
const mockIsCAInstalledInSystem = isCAInstalledInSystem as jest.MockedFunction<typeof isCAInstalledInSystem>;
const mockInstallCAInSystem = installCAInSystem as jest.MockedFunction<typeof installCAInSystem>;
const mockShowFirstLaunchAssistant = showFirstLaunchAssistant as jest.MockedFunction<typeof showFirstLaunchAssistant>;

describe('First Launch', () => {
  let mockStore: jest.Mocked<Partial<IStore>>;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      dispose: jest.fn(),
    } as jest.Mocked<Partial<IStore>>;

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('handleFirstLaunch', () => {
    it('should set HTTPS mode if CA is already installed', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(true);

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'https');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenCalledTimes(2);
    });

    it('should set HTTPS mode if CA is not installed (default behavior)', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'https');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Defaulting to HTTPS mode. Install certificate in settings for full trust.'
      );
    });

    it('should handle CA check errors gracefully', async () => {
      mockIsCAInstalledInSystem.mockRejectedValue(new Error('CA check failed'));

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'https');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
    });

    it('should handle multiple consecutive calls correctly', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(true);

      // Call multiple times
      await handleFirstLaunch(mockStore as IStore);
      await handleFirstLaunch(mockStore as IStore);

      // Should be called twice
      expect(mockIsCAInstalledInSystem).toHaveBeenCalledTimes(2);
      expect(mockStore.set).toHaveBeenCalledTimes(4); // 2 calls × 2 settings each
    });
  });
});
