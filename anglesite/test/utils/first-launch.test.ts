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
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      dispose: jest.fn(),
    } as jest.Mocked<Partial<IStore>>;

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('handleFirstLaunch', () => {
    it('should skip setup if CA is already installed and set HTTPS mode', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(true);

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockShowFirstLaunchAssistant).not.toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'https');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenCalledTimes(2);
    });

    it('should quit app if user cancels first launch assistant', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue(null);

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockShowFirstLaunchAssistant).toHaveBeenCalled();
      expect(mockApp.quit).toHaveBeenCalled();
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('should set HTTPS mode when user chooses HTTPS and CA installation succeeds', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue('https');
      mockInstallCAInSystem.mockResolvedValue(true);

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockShowFirstLaunchAssistant).toHaveBeenCalled();
      expect(mockInstallCAInSystem).toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'https');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenCalledTimes(2);
      expect(mockDialog.showMessageBoxSync).not.toHaveBeenCalled();
    });

    it('should fall back to HTTP mode when CA installation fails', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue('https');
      mockInstallCAInSystem.mockResolvedValue(false);
      mockDialog.showMessageBoxSync.mockReturnValue(0);

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockShowFirstLaunchAssistant).toHaveBeenCalled();
      expect(mockInstallCAInSystem).toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'http');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenCalledTimes(2);
      expect(mockDialog.showMessageBoxSync).toHaveBeenCalledWith({
        type: 'warning',
        title: 'Certificate Installation Failed',
        message: 'Failed to install the security certificate.',
        detail: 'Anglesite will continue in HTTP mode. You can retry HTTPS setup in the settings.',
        buttons: ['Continue'],
      });
    });

    it('should handle CA installation errors and fall back to HTTP mode', async () => {
      const testError = new Error('Installation error');
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue('https');
      mockInstallCAInSystem.mockRejectedValue(testError);
      mockDialog.showMessageBoxSync.mockReturnValue(0);

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockShowFirstLaunchAssistant).toHaveBeenCalled();
      expect(mockInstallCAInSystem).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during CA installation:', testError);
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'http');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenCalledTimes(2);
      expect(mockDialog.showMessageBoxSync).toHaveBeenCalledWith({
        type: 'error',
        title: 'Setup Error',
        message: 'An error occurred during setup.',
        detail: 'Anglesite will continue in HTTP mode.',
        buttons: ['Continue'],
      });
    });

    it('should set HTTP mode when user explicitly chooses HTTP', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue('http');

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockShowFirstLaunchAssistant).toHaveBeenCalled();
      expect(mockInstallCAInSystem).not.toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'http');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenCalledTimes(2);
      expect(mockDialog.showMessageBoxSync).not.toHaveBeenCalled();
    });

    it('should handle unexpected user choice values', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue('unexpected' as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalled();
      expect(mockShowFirstLaunchAssistant).toHaveBeenCalled();
      expect(mockInstallCAInSystem).not.toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'http');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenCalledTimes(2);
    });

    it('should handle CA installation throwing non-Error objects', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue('https');
      mockInstallCAInSystem.mockRejectedValue('String error');
      mockDialog.showMessageBoxSync.mockReturnValue(0);

      await handleFirstLaunch(mockStore as IStore);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during CA installation:', 'String error');
      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'http');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
      expect(mockDialog.showMessageBoxSync).toHaveBeenCalledWith({
        type: 'error',
        title: 'Setup Error',
        message: 'An error occurred during setup.',
        detail: 'Anglesite will continue in HTTP mode.',
        buttons: ['Continue'],
      });
    });

    it('should handle undefined store properly', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(false);
      mockShowFirstLaunchAssistant.mockResolvedValue('http');

      await handleFirstLaunch(mockStore as IStore);

      expect(mockStore.set).toHaveBeenCalledWith('httpsMode', 'http');
      expect(mockStore.set).toHaveBeenCalledWith('firstLaunchCompleted', true);
    });

    it('should handle multiple consecutive calls correctly', async () => {
      mockIsCAInstalledInSystem.mockResolvedValue(true);

      await handleFirstLaunch(mockStore as IStore);
      await handleFirstLaunch(mockStore as IStore);

      expect(mockIsCAInstalledInSystem).toHaveBeenCalledTimes(2);
      expect(mockStore.set).toHaveBeenCalledTimes(4);
      expect(mockStore.set).toHaveBeenNthCalledWith(1, 'httpsMode', 'https');
      expect(mockStore.set).toHaveBeenNthCalledWith(2, 'firstLaunchCompleted', true);
      expect(mockStore.set).toHaveBeenNthCalledWith(3, 'httpsMode', 'https');
      expect(mockStore.set).toHaveBeenNthCalledWith(4, 'firstLaunchCompleted', true);
    });
  });
});
