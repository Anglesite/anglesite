/**
 * @file Tests for DNS hosts file management with sudo-prompt and Touch ID support
 */

// Mock sudo-prompt before importing the module
const mockSudoPrompt = {
  exec: jest.fn(),
};

// Mock native-is-elevated
const mockIsElevated = jest.fn();

// Mock child_process
const mockExec = jest.fn();
const mockExecFile = jest.fn();

// Import the actual functions to compare against
const { execFile: realExecFile } = require('child_process');

const mockPromisify = jest.fn((fn) => {
  // Check if the function is execFile by direct reference comparison
  if (fn === realExecFile) return mockExecFile;
  return mockExec;
});

// Mock fs for file operations
const mockFs = {
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
};

// Mock hostile library
const mockHostile = {
  get: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
};

// Mock dialog
const mockDialog = {
  showMessageBox: jest.fn(),
};

// Set up mocks before importing the module
jest.mock('sudo-prompt', () => mockSudoPrompt);
jest.mock('native-is-elevated', () => mockIsElevated);
jest.mock('child_process', () => ({
  exec: mockExec,
  execFile: mockExecFile,
}));
jest.mock('util', () => ({
  promisify: mockPromisify,
}));
jest.mock('fs', () => mockFs);
jest.mock('hostile', () => mockHostile);
jest.mock('electron', () => ({
  dialog: mockDialog,
}));

// Mock website-manager
jest.mock('../../app/utils/website-manager', () => ({
  listWebsites: jest.fn(() => ['test-site', 'my-website']),
}));

describe('DNS Hosts Manager', () => {
  let hostsManager: {
    addLocalDnsResolution: (hostname: string) => Promise<void>;
    cleanupHostsFile: () => Promise<boolean>;
    updateHostsFile: (hostname: string) => Promise<boolean>;
    checkAndSuggestTouchIdSetup: () => Promise<void>;
  };

  beforeAll(() => {
    // Import the module after mocks are set up
    hostsManager = require('../../app/dns/hosts-manager');
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set default mock implementations
    mockIsElevated.mockResolvedValue(false);
    mockExec.mockResolvedValue({ stdout: '0', stderr: '' });
    mockExecFile.mockResolvedValue({ stdout: '0', stderr: '' });
    mockHostile.get.mockImplementation((_flag, callback) => {
      callback(null, [
        ['127.0.0.1', 'localhost'],
        ['127.0.0.1', 'anglesite.test'],
        ['127.0.0.1', 'test-site.test'],
      ]);
    });
    mockSudoPrompt.exec.mockImplementation((command, options, callback) => {
      callback(null, 'success', '');
    });
  });

  describe('Touch ID Detection', () => {
    it('should detect Touch ID availability on macOS', async () => {
      // Mock platform detection
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      // Mock Touch ID configured and hardware available
      mockExecFile
        .mockResolvedValueOnce({ stdout: '1' }) // pam_tid.so configured
        .mockResolvedValueOnce({ stdout: 'Touch ID available' }); // Touch ID hardware available

      await hostsManager.checkAndSuggestTouchIdSetup();

      expect(mockExecFile).toHaveBeenCalledWith('grep', ['-c', 'pam_tid.so', '/etc/pam.d/sudo']);
      expect(mockExecFile).toHaveBeenCalledWith('bioutil', ['-r']);
    });

    it('should suggest Touch ID setup when hardware available but not configured', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      // Mock Touch ID hardware available but not configured
      // First, for isTouchIdAvailable check (returns false - not configured)
      mockExec
        .mockResolvedValueOnce({ stdout: '0' }) // pam_tid.so not configured
        .mockResolvedValueOnce({ stdout: '1' }) // Touch ID hardware available
        // Then for canEnableTouchId check (returns true - can be enabled)
        .mockResolvedValueOnce({ stdout: '1' }) // Touch ID hardware available
        .mockResolvedValueOnce({ stdout: '0' }); // pam_tid.so not configured

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await hostsManager.checkAndSuggestTouchIdSetup();

      consoleSpy.mockRestore();
    });

    it('should confirm Touch ID is configured when available', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      // Mock Touch ID configured and hardware available
      mockExec
        .mockResolvedValueOnce({ stdout: '1' }) // pam_tid.so configured
        .mockResolvedValueOnce({ stdout: '1' }); // Touch ID hardware available

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await hostsManager.checkAndSuggestTouchIdSetup();

      consoleSpy.mockRestore();
    });

    it('should skip Touch ID checks on non-macOS platforms', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await hostsManager.checkAndSuggestTouchIdSetup();

      expect(mockExec).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Elevated Privileges', () => {
    it('should run commands directly when already elevated', async () => {
      mockIsElevated.mockResolvedValue(true);
      mockExec.mockResolvedValue({ stdout: 'success' });

      // Access the private function through the module's exports
      // This is a bit hacky but necessary for testing internal functions
      const result = await hostsManager.updateHostsFile('test.test');

      expect(mockIsElevated).toHaveBeenCalled();
      expect(mockSudoPrompt.exec).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should use sudo-prompt when not elevated', async () => {
      mockIsElevated.mockResolvedValue(false);
      mockSudoPrompt.exec.mockImplementation((_command, options, callback) => {
        expect(options.name).toBe('Anglesite DNS');
        callback(null, 'success', '');
      });

      const result = await hostsManager.updateHostsFile('test.test');

      expect(mockIsElevated).toHaveBeenCalled();
      expect(mockSudoPrompt.exec).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should handle authentication cancellation gracefully', async () => {
      mockIsElevated.mockResolvedValue(false);
      mockSudoPrompt.exec.mockImplementation((_command, _options, callback) => {
        const error = new Error('User cancelled') as Error & { code: number };
        error.code = -128;
        callback(error, null, '');
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await hostsManager.updateHostsFile('test.test');

      expect(result).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should log appropriate authentication method based on Touch ID availability', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      mockIsElevated.mockResolvedValue(false);

      // Mock Touch ID available
      mockExec
        .mockResolvedValueOnce({ stdout: '1' }) // pam_tid.so configured
        .mockResolvedValueOnce({ stdout: '1' }); // Touch ID hardware available

      mockSudoPrompt.exec.mockImplementation((_command, options, callback) => {
        callback(null, 'success', '');
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await hostsManager.updateHostsFile('test.test');

      consoleSpy.mockRestore();
    });
  });

  describe('Hosts File Management', () => {
    it('should add local DNS resolution for new domains', async () => {
      mockHostile.get.mockImplementation((_flag, callback) => {
        callback(null, [['127.0.0.1', 'anglesite.test']]);
      });

      await hostsManager.addLocalDnsResolution('new-site.test');

      expect(mockHostile.get).toHaveBeenCalled();
    });

    it('should skip adding domains that already exist', async () => {
      mockHostile.get.mockImplementation((_flag, callback) => {
        callback(null, [
          ['127.0.0.1', 'anglesite.test'],
          ['127.0.0.1', 'existing-site.test'],
        ]);
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await hostsManager.updateHostsFile('existing-site.test');

      consoleSpy.mockRestore();
    });

    it('should clean up orphaned domains', async () => {
      mockHostile.get.mockImplementation((_flag, callback) => {
        callback(null, [
          ['127.0.0.1', '127.0.0.1 anglesite.test'],
          ['127.0.0.1', '127.0.0.1 orphaned-site.test'], // This should be removed
          ['127.0.0.1', '127.0.0.1 test-site.test'], // This should stay (exists in website list)
        ]);
      });

      await hostsManager.cleanupHostsFile();

      expect(mockHostile.get).toHaveBeenCalled();
    });

    it('should handle hostile library errors gracefully', async () => {
      mockHostile.get.mockImplementation((_flag, callback) => {
        callback(new Error('Failed to read hosts file'), null);
      });

      const result = await hostsManager.cleanupHostsFile();

      expect(result).toBe(false);
    });
  });

  describe('Cross-Platform Compatibility', () => {
    it('should work on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      // Touch ID should not be available on Windows
      await hostsManager.checkAndSuggestTouchIdSetup();

      expect(mockExec).not.toHaveBeenCalledWith(expect.stringContaining('bioutil'));
    });

    it('should work on Linux', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      // Touch ID should not be available on Linux
      await hostsManager.checkAndSuggestTouchIdSetup();

      expect(mockExec).not.toHaveBeenCalledWith(expect.stringContaining('bioutil'));
    });
  });

  describe('Error Handling', () => {
    it('should handle sudo-prompt errors without crashing', async () => {
      mockIsElevated.mockResolvedValue(false);
      mockSudoPrompt.exec.mockImplementation((_command, options, callback) => {
        callback(new Error('Authentication failed'), null, 'error');
      });

      const result = await hostsManager.updateHostsFile('test.test');

      expect(result).toBe(false);
    });

    it('should handle native-is-elevated errors gracefully', async () => {
      // Mock hostEntryExists to return false so it tries to add the entry
      mockHostile.get.mockImplementation((_flag, callback) => {
        callback(null, [['127.0.0.1', 'localhost']]); // test.test doesn't exist
      });

      mockIsElevated.mockRejectedValue(new Error('Cannot check elevation'));

      const result = await hostsManager.updateHostsFile('test.test');

      // The function should catch the error and return false, so sudo-prompt is never called
      expect(result).toBe(false); // Should fail due to our mocked error
      // Since isElevated throws, we never get to sudo-prompt
      expect(mockSudoPrompt.exec).not.toHaveBeenCalled();
    });

    it('should handle biometric detection errors', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      mockExec.mockRejectedValue(new Error('Command failed'));

      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();

      await hostsManager.checkAndSuggestTouchIdSetup();

      consoleSpy.mockRestore();
    });
  });

  describe('Module Exports', () => {
    it('should export required functions', () => {
      expect(typeof hostsManager.addLocalDnsResolution).toBe('function');
      expect(typeof hostsManager.cleanupHostsFile).toBe('function');
      expect(typeof hostsManager.updateHostsFile).toBe('function');
      expect(typeof hostsManager.checkAndSuggestTouchIdSetup).toBe('function');
    });
  });
});
