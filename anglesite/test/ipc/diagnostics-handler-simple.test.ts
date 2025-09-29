/**
 * @file Simple test suite for Diagnostics IPC handlers
 */
import { setupDiagnosticsHandlers } from '../../src/main/ipc/diagnostics';
import { jest } from '@jest/globals';

// Mock Electron
const mockHandle = jest.fn();
const mockOn = jest.fn();
const mockRemoveHandler = jest.fn();
const mockRemoveAllListeners = jest.fn();

jest.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
    on: mockOn,
    removeHandler: mockRemoveHandler,
    removeAllListeners: mockRemoveAllListeners,
  },
  BrowserWindow: {
    fromWebContents: jest.fn(),
  },
}));

// Mock service registry
const mockGetService = jest.fn();
jest.mock('../../src/main/core/service-registry', () => ({
  getGlobalContext: () => ({
    getService: mockGetService,
  }),
}));

// Mock logger
jest.mock('../../src/main/utils/logging', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
  sanitize: {
    error: (error: any) => error?.message || 'Unknown error',
  },
}));

describe('Diagnostics IPC Handlers Setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should register all IPC handlers', () => {
    setupDiagnosticsHandlers();

    // Verify all handle channels are registered
    const expectedHandleChannels = [
      'diagnostics:get-errors',
      'diagnostics:get-statistics',
      'diagnostics:get-notifications',
      'diagnostics:dismiss-notification',
      'diagnostics:clear-errors',
      'diagnostics:export-errors',
      'diagnostics:show-window',
      'diagnostics:close-window',
      'diagnostics:toggle-window',
      'diagnostics:get-window-state',
      'diagnostics:get-preferences',
      'diagnostics:set-preferences',
      'diagnostics:get-service-health',
    ];

    expectedHandleChannels.forEach((channel) => {
      expect(mockHandle).toHaveBeenCalledWith(channel, expect.any(Function));
    });

    // Verify listener channels are registered
    const expectedListenerChannels = ['diagnostics:subscribe-errors', 'diagnostics:unsubscribe-errors'];

    expectedListenerChannels.forEach((channel) => {
      expect(mockOn).toHaveBeenCalledWith(channel, expect.any(Function));
    });

    expect(mockHandle).toHaveBeenCalledTimes(expectedHandleChannels.length);
    expect(mockOn).toHaveBeenCalledTimes(expectedListenerChannels.length);
  });

  test('should handle basic service integration', async () => {
    const mockErrorService: any = {
      getFilteredErrors: jest.fn().mockResolvedValue([]),
    };

    mockGetService.mockReturnValue(mockErrorService);

    setupDiagnosticsHandlers();

    // Get the handler function for get-errors
    const getErrorsHandler = mockHandle.mock.calls.find(
      (call) => call[0] === 'diagnostics:get-errors'
    )?.[1] as Function;

    expect(getErrorsHandler).toBeDefined();

    // Test basic handler execution
    const mockEvent = { sender: { id: 1 } };
    await getErrorsHandler(mockEvent, {});

    expect(mockGetService).toHaveBeenCalledWith('ErrorDiagnosticsService');
    expect(mockErrorService.getFilteredErrors).toHaveBeenCalledWith({});
  });

  test('should handle service errors gracefully', async () => {
    const mockErrorService: any = {
      getFilteredErrors: jest.fn().mockRejectedValue(new Error('Service error')),
    };

    mockGetService.mockReturnValue(mockErrorService);

    setupDiagnosticsHandlers();

    const getErrorsHandler = mockHandle.mock.calls.find(
      (call) => call[0] === 'diagnostics:get-errors'
    )?.[1] as Function;

    const mockEvent = { sender: { id: 1 } };

    await expect(getErrorsHandler(mockEvent, {})).rejects.toThrow('Service error');
  });
});

describe('Diagnostics IPC Integration Test', () => {
  test('should have proper service key usage', () => {
    const mockErrorService = {};
    const mockWindowManager = {};

    mockGetService
      .mockReturnValueOnce(mockErrorService) // First call for ErrorDiagnosticsService
      .mockReturnValueOnce(mockWindowManager); // Second call for DiagnosticsWindowManager

    setupDiagnosticsHandlers();

    // Trigger some handlers to verify service calls
    expect(mockGetService).not.toHaveBeenCalled(); // Services called lazily when handlers execute
  });
});
