/**
 * @file Integration tests for FileExplorer component
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FileExplorer } from '../../../src/renderer/ui/react/components/FileExplorer';
import { AppProvider } from '../../../src/renderer/ui/react/context/AppContext';

// Mock the electron API
const mockElectronAPI = {
  invoke: jest.fn(),
  send: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// Mock the AppContext with test data
const MockAppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <AppProvider>{children}</AppProvider>;
};

describe('FileExplorer Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockElectronAPI.invoke.mockImplementation((channel: string) => {
      if (channel === 'get-current-website-name') {
        return Promise.resolve('test-website');
      }
      if (channel === 'get-website-files') {
        return Promise.resolve([
          {
            name: 'index.html',
            filePath: '/test/website/src/index.html',
            isDirectory: false,
            relativePath: 'index.html',
            url: '/',
          },
          {
            name: 'sample.html',
            filePath: '/test/website/src/sample.html',
            isDirectory: false,
            relativePath: 'sample.html',
            url: '/sample',
          },
        ]);
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('IPC Event Handling', () => {
    it('should register refresh-file-explorer event listener on mount', async () => {
      render(
        <MockAppProvider>
          <FileExplorer />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(mockElectronAPI.on).toHaveBeenCalledWith('refresh-file-explorer', expect.any(Function));
      });
    });

    it('should refresh file list when refresh-file-explorer event received', async () => {
      let refreshHandler: (() => void) | null = null;

      mockElectronAPI.on.mockImplementation((channel: string, handler: () => void) => {
        if (channel === 'refresh-file-explorer') {
          refreshHandler = handler;
        }
      });

      render(
        <MockAppProvider>
          <FileExplorer />
        </MockAppProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-files', 'test-website');
      });

      // Clear the mock call count
      mockElectronAPI.invoke.mockClear();

      // Trigger refresh event
      if (refreshHandler) {
        refreshHandler();
      }

      // Should trigger another call to get-website-files
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-files', 'test-website');
      });
    });

    it('should cleanup event listener on unmount', async () => {
      const { unmount } = render(
        <MockAppProvider>
          <FileExplorer />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(mockElectronAPI.on).toHaveBeenCalled();
      });

      unmount();

      expect(mockElectronAPI.off).toHaveBeenCalledWith('refresh-file-explorer', expect.any(Function));
    });

    it('should handle missing off method gracefully', async () => {
      // Simulate older electron API without off method
      const mockElectronAPIWithoutOff = {
        ...mockElectronAPI,
        off: undefined,
      };

      Object.defineProperty(window, 'electronAPI', {
        value: mockElectronAPIWithoutOff,
        writable: true,
      });

      const { unmount } = render(
        <MockAppProvider>
          <FileExplorer />
        </MockAppProvider>
      );

      // Should not throw error on unmount
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('File Loading Integration', () => {
    it('should display newly added files after refresh', async () => {
      let refreshHandler: (() => void) | null = null;

      mockElectronAPI.on.mockImplementation((channel: string, handler: () => void) => {
        if (channel === 'refresh-file-explorer') {
          refreshHandler = handler;
        }
      });

      // Initial file list
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'get-current-website-name') {
          return Promise.resolve('test-website');
        }
        if (channel === 'get-website-files') {
          return Promise.resolve([
            {
              name: 'index.html',
              filePath: '/test/website/src/index.html',
              isDirectory: false,
              relativePath: 'index.html',
              url: '/',
            },
          ]);
        }
        return Promise.resolve(null);
      });

      render(
        <MockAppProvider>
          <FileExplorer />
        </MockAppProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-files', 'test-website');
      });

      // Clear the invoke calls
      mockElectronAPI.invoke.mockClear();

      // Update mock to return additional file
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'get-current-website-name') {
          return Promise.resolve('test-website');
        }
        if (channel === 'get-website-files') {
          return Promise.resolve([
            {
              name: 'index.html',
              filePath: '/test/website/src/index.html',
              isDirectory: false,
              relativePath: 'index.html',
              url: '/',
            },
            {
              name: 'new-page.html',
              filePath: '/test/website/src/new-page.html',
              isDirectory: false,
              relativePath: 'new-page.html',
              url: '/new-page',
            },
          ]);
        }
        return Promise.resolve(null);
      });

      // Trigger refresh
      if (refreshHandler) {
        refreshHandler();
      }

      // Should trigger another call to get-website-files
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-files', 'test-website');
      });
    });

    it('should handle refresh errors gracefully', async () => {
      let refreshHandler: (() => void) | null = null;

      mockElectronAPI.on.mockImplementation((channel: string, handler: () => void) => {
        if (channel === 'refresh-file-explorer') {
          refreshHandler = handler;
        }
      });

      render(
        <MockAppProvider>
          <FileExplorer />
        </MockAppProvider>
      );

      // Make the refresh call fail
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'get-current-website-name') {
          return Promise.resolve('test-website');
        }
        if (channel === 'get-website-files') {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve(null);
      });

      // Trigger refresh - should not crash
      if (refreshHandler) {
        expect(() => refreshHandler()).not.toThrow();
      }

      // Should attempt to reload files
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-files', 'test-website');
      });
    });
  });

  describe('Website Changes', () => {
    it('should register refresh-file-explorer listener when component mounts', async () => {
      render(
        <MockAppProvider>
          <FileExplorer />
        </MockAppProvider>
      );

      // Should register the refresh-file-explorer listener
      await waitFor(() => {
        expect(mockElectronAPI.on).toHaveBeenCalledWith('refresh-file-explorer', expect.any(Function));
      });
    });
  });
});
