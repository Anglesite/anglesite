/**
 * @file Tests for Electron preload script
 */

// Mock electron modules
const mockContextBridge = {
  exposeInMainWorld: jest.fn(),
};

const mockIpcRenderer = {
  send: jest.fn(),
  invoke: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
};

// Mock electron before importing preload
jest.mock('electron', () => ({
  contextBridge: mockContextBridge,
  ipcRenderer: mockIpcRenderer,
}));

interface ElectronAPI {
  send: jest.Mock;
  invoke: jest.Mock;
  on: jest.Mock;
  removeAllListeners: jest.Mock;
  getCurrentTheme: jest.Mock;
  setTheme: jest.Mock;
  onThemeUpdated: jest.Mock;
}

describe('Preload Script', () => {
  let electronAPI: ElectronAPI;

  beforeAll(() => {
    // Clear any previous mock calls
    mockContextBridge.exposeInMainWorld.mockClear();

    // Delete from require cache if it exists
    delete require.cache[require.resolve('../../src/main/preload')];

    // Import preload script to trigger the contextBridge.exposeInMainWorld call
    require('../../src/main/preload');

    // Get the electronAPI that was exposed
    const exposeCall = mockContextBridge.exposeInMainWorld.mock.calls.find((call) => call[0] === 'electronAPI');
    electronAPI = exposeCall ? exposeCall[1] : null;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.resetModules();
  });

  describe('Context Bridge Setup', () => {
    it('should expose electronAPI in main world', () => {
      // The preload script should have been loaded and exposed the API
      expect(electronAPI).toBeDefined();
      expect(electronAPI).not.toBeNull();
    });

    it('should expose all expected API methods', () => {
      expect(electronAPI).toHaveProperty('send');
      expect(electronAPI).toHaveProperty('invoke');
      expect(electronAPI).toHaveProperty('on');
      expect(electronAPI).toHaveProperty('removeAllListeners');
      expect(electronAPI).toHaveProperty('getCurrentTheme');
      expect(electronAPI).toHaveProperty('setTheme');
      expect(electronAPI).toHaveProperty('onThemeUpdated');
    });
  });

  describe('send method', () => {
    const validSendChannels = [
      'new-website',
      'preview',
      'open-browser',
      'reload-preview',
      'toggle-devtools',
      'hide-preview',
      'export-site',
      'create-website-with-name',
      'renderer-loaded',
      'input-dialog-result',
      'show-website-context-menu',
      'delete-website',
    ];

    validSendChannels.forEach((channel) => {
      it(`should send valid channel: ${channel}`, () => {
        electronAPI.send(channel, 'test-arg');

        expect(mockIpcRenderer.send).toHaveBeenCalledWith(channel, 'test-arg');
      });
    });

    it('should send with multiple arguments', () => {
      electronAPI.send('new-website', 'arg1', 'arg2', 'arg3');

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('new-website', 'arg1', 'arg2', 'arg3');
    });

    it('should not send invalid channels', () => {
      electronAPI.send('invalid-channel', 'test-arg');

      expect(mockIpcRenderer.send).not.toHaveBeenCalled();
    });

    it('should handle empty arguments', () => {
      electronAPI.send('preview');

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('preview');
    });
  });

  describe('invoke method', () => {
    const validInvokeChannels = [
      'list-websites',
      'validate-website-name',
      'rename-website',
      'get-current-theme',
      'set-theme',
    ];

    validInvokeChannels.forEach((channel) => {
      it(`should invoke valid channel: ${channel}`, async () => {
        const mockResult = { success: true };
        mockIpcRenderer.invoke.mockResolvedValue(mockResult);

        const result = await electronAPI.invoke(channel, 'test-arg');

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(channel, 'test-arg');
        expect(result).toEqual(mockResult);
      });
    });

    it('should invoke with multiple arguments', async () => {
      const mockResult = { data: 'test' };
      mockIpcRenderer.invoke.mockResolvedValue(mockResult);

      const result = await electronAPI.invoke('rename-website', 'oldName', 'newName');

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('rename-website', 'oldName', 'newName');
      expect(result).toEqual(mockResult);
    });

    it('should reject invalid channels', async () => {
      await expect(electronAPI.invoke('invalid-channel', 'test-arg')).rejects.toThrow(
        'Invalid invoke channel: invalid-channel'
      );

      expect(mockIpcRenderer.invoke).not.toHaveBeenCalled();
    });

    it('should handle invoke errors', async () => {
      const error = new Error('IPC error');
      mockIpcRenderer.invoke.mockRejectedValue(error);

      await expect(electronAPI.invoke('list-websites')).rejects.toThrow('IPC error');
    });
  });

  describe('on method', () => {
    const validOnChannels = [
      'preview-loaded',
      'preview-error',
      'menu-new-website',
      'menu-reload',
      'menu-toggle-devtools',
      'menu-export-site',
      'show-website-name-input',
      'website-context-menu-action',
      'website-operation-completed',
      'theme-updated',
      'trigger-new-website',
    ];

    validOnChannels.forEach((channel) => {
      it(`should register listener for valid channel: ${channel}`, () => {
        const mockCallback = jest.fn();

        electronAPI.on(channel, mockCallback);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(channel, expect.any(Function));
      });
    });

    it('should call callback when event is received', () => {
      const mockCallback = jest.fn();
      let eventHandler: (...args: unknown[]) => void;

      // Capture the event handler
      mockIpcRenderer.on.mockImplementation((channel, handler) => {
        eventHandler = handler;
      });

      electronAPI.on('preview-loaded', mockCallback);

      // Simulate event reception
      const mockEvent = { preventDefault: jest.fn() };
      eventHandler!(mockEvent, 'arg1', 'arg2');

      expect(mockCallback).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should not register listener for invalid channels', () => {
      const mockCallback = jest.fn();

      electronAPI.on('invalid-channel', mockCallback);

      expect(mockIpcRenderer.on).not.toHaveBeenCalled();
    });

    it('should handle callback without arguments', () => {
      const mockCallback = jest.fn();
      let eventHandler: (...args: unknown[]) => void;

      mockIpcRenderer.on.mockImplementation((channel, handler) => {
        eventHandler = handler;
      });

      electronAPI.on('preview-loaded', mockCallback);

      const mockEvent = { preventDefault: jest.fn() };
      eventHandler!(mockEvent);

      expect(mockCallback).toHaveBeenCalledWith();
    });
  });

  describe('removeAllListeners method', () => {
    const validRemoveChannels = ['preview-loaded', 'preview-error'];

    validRemoveChannels.forEach((channel) => {
      it(`should remove listeners for valid channel: ${channel}`, () => {
        electronAPI.removeAllListeners(channel);

        expect(mockIpcRenderer.removeAllListeners).toHaveBeenCalledWith(channel);
      });
    });

    it('should not remove listeners for invalid channels', () => {
      electronAPI.removeAllListeners('invalid-channel');

      expect(mockIpcRenderer.removeAllListeners).not.toHaveBeenCalled();
    });
  });

  describe('Theme API methods', () => {
    describe('getCurrentTheme', () => {
      it('should invoke get-current-theme', async () => {
        const mockTheme = 'dark';
        mockIpcRenderer.invoke.mockResolvedValue(mockTheme);

        const result = await electronAPI.getCurrentTheme();

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('get-current-theme');
        expect(result).toBe(mockTheme);
      });

      it('should handle getCurrentTheme errors', async () => {
        const error = new Error('Theme error');
        mockIpcRenderer.invoke.mockRejectedValue(error);

        await expect(electronAPI.getCurrentTheme()).rejects.toThrow('Theme error');
      });
    });

    describe('setTheme', () => {
      it('should invoke set-theme with theme parameter', async () => {
        const mockResult = { success: true };
        mockIpcRenderer.invoke.mockResolvedValue(mockResult);

        const result = await electronAPI.setTheme('light');

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('set-theme', 'light');
        expect(result).toEqual(mockResult);
      });

      it('should handle setTheme errors', async () => {
        const error = new Error('Set theme error');
        mockIpcRenderer.invoke.mockRejectedValue(error);

        await expect(electronAPI.setTheme('dark')).rejects.toThrow('Set theme error');
      });
    });

    describe('onThemeUpdated', () => {
      it('should register listener for theme-updated events', () => {
        const mockCallback = jest.fn();

        electronAPI.onThemeUpdated(mockCallback);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith('theme-updated', expect.any(Function));
      });

      it('should call callback when theme-updated event is received', () => {
        const mockCallback = jest.fn();
        let eventHandler: (...args: unknown[]) => void;

        mockIpcRenderer.on.mockImplementation((channel, handler) => {
          if (channel === 'theme-updated') {
            eventHandler = handler;
          }
        });

        electronAPI.onThemeUpdated(mockCallback);

        // Simulate theme update event
        const mockEvent = { preventDefault: jest.fn() };
        eventHandler!(mockEvent, 'new-theme', { additional: 'data' });

        expect(mockCallback).toHaveBeenCalledWith('new-theme', { additional: 'data' });
      });
    });
  });

  describe('Security validation', () => {
    it('should only allow whitelisted send channels', () => {
      const invalidChannels = ['malicious-channel', 'arbitrary-command', 'system-access', 'file-access'];

      invalidChannels.forEach((channel) => {
        electronAPI.send(channel, 'malicious-payload');
        expect(mockIpcRenderer.send).not.toHaveBeenCalledWith(channel, 'malicious-payload');
      });
    });

    it('should only allow whitelisted invoke channels', async () => {
      const invalidChannels = ['malicious-invoke', 'system-command', 'file-read', 'process-spawn'];

      for (const channel of invalidChannels) {
        await expect(electronAPI.invoke(channel, 'payload')).rejects.toThrow(`Invalid invoke channel: ${channel}`);
        expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith(channel, 'payload');
      }
    });

    it('should only allow whitelisted on channels', () => {
      const invalidChannels = ['malicious-listener', 'system-event', 'arbitrary-event'];

      invalidChannels.forEach((channel) => {
        electronAPI.on(channel, jest.fn());
        expect(mockIpcRenderer.on).not.toHaveBeenCalledWith(channel, expect.any(Function));
      });
    });

    it('should only allow whitelisted removeAllListeners channels', () => {
      const invalidChannels = ['malicious-remove', 'system-cleanup', 'arbitrary-cleanup'];

      invalidChannels.forEach((channel) => {
        electronAPI.removeAllListeners(channel);
        expect(mockIpcRenderer.removeAllListeners).not.toHaveBeenCalledWith(channel);
      });
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle undefined callback in on method', () => {
      expect(() => {
        electronAPI.on('preview-loaded', undefined);
      }).not.toThrow();

      expect(mockIpcRenderer.on).toHaveBeenCalled();
    });

    it('should handle null arguments in send method', () => {
      electronAPI.send('preview', null, undefined);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('preview', null, undefined);
    });

    it('should handle empty string channels', () => {
      electronAPI.send('');
      electronAPI.on('', jest.fn());

      expect(mockIpcRenderer.send).not.toHaveBeenCalled();
      expect(mockIpcRenderer.on).not.toHaveBeenCalled();
    });

    it('should handle case-sensitive channel validation', () => {
      electronAPI.send('NEW-WEBSITE'); // Wrong case
      electronAPI.send('new-Website'); // Wrong case

      expect(mockIpcRenderer.send).not.toHaveBeenCalled();
    });
  });

  describe('Integration scenarios', () => {
    it('should support typical website creation workflow', async () => {
      // 1. Send new-website command
      electronAPI.send('new-website');
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('new-website');

      // 2. Register for website name input
      const mockCallback = jest.fn();
      electronAPI.on('show-website-name-input', mockCallback);
      expect(mockIpcRenderer.on).toHaveBeenCalledWith('show-website-name-input', expect.any(Function));

      // 3. Send website creation with name
      electronAPI.send('create-website-with-name', 'My New Site');
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('create-website-with-name', 'My New Site');
    });

    it('should support theme management workflow', async () => {
      // 1. Get current theme
      mockIpcRenderer.invoke.mockResolvedValue('light');
      const currentTheme = await electronAPI.getCurrentTheme();
      expect(currentTheme).toBe('light');

      // 2. Set new theme
      mockIpcRenderer.invoke.mockResolvedValue({ success: true });
      await electronAPI.setTheme('dark');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('set-theme', 'dark');

      // 3. Listen for theme updates
      const mockCallback = jest.fn();
      electronAPI.onThemeUpdated(mockCallback);
      expect(mockIpcRenderer.on).toHaveBeenCalledWith('theme-updated', expect.any(Function));
    });

    it('should support website management workflow', async () => {
      // 1. List websites
      mockIpcRenderer.invoke.mockResolvedValue(['site1', 'site2']);
      const websites = await electronAPI.invoke('list-websites');
      expect(websites).toEqual(['site1', 'site2']);

      // 2. Validate website name
      mockIpcRenderer.invoke.mockResolvedValue({ valid: true });
      const validation = await electronAPI.invoke('validate-website-name', 'new-site');
      expect(validation).toEqual({ valid: true });

      // 3. Show context menu
      electronAPI.send('show-website-context-menu', 'site1', { x: 100, y: 200 });
      expect(mockIpcRenderer.send).toHaveBeenCalledWith('show-website-context-menu', 'site1', { x: 100, y: 200 });
    });
  });
});
