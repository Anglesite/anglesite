/**
 * @file Complete integration test for website configuration editor flow
 * @description Tests the complete flow: FileExplorer globe click → Sidebar → AppContext → Main → WebsiteConfigEditor
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppProvider } from '../../src/renderer/ui/react/context/AppContext';
import { Sidebar } from '../../src/renderer/ui/react/components/Sidebar';
import { Main } from '../../src/renderer/ui/react/components/Main';

// Mock the electronAPI
const mockElectronAPI = {
  invoke: jest.fn(),
  send: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

// Mock WebsiteConfigEditor component for testing
jest.mock('../../src/renderer/ui/react/components/WebsiteConfigEditor', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="website-config-editor">Website Configuration Editor Loaded</div>,
    WebsiteConfigEditor: () => <div data-testid="website-config-editor">Website Configuration Editor Loaded</div>,
  };
});

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// Complete app component for testing
const TestApp: React.FC = () => {
  return (
    <AppProvider>
      <div style={{ display: 'flex', height: '100vh' }}>
        <Sidebar />
        <Main />
      </div>
    </AppProvider>
  );
};

describe('Complete Website Configuration Flow Integration Tests', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods to suppress logging during tests
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Mock the IPC calls that the components make
    mockElectronAPI.invoke.mockImplementation((channel: string, ..._args: unknown[]) => {
      switch (channel) {
        case 'get-current-website-name':
          return Promise.resolve('test-website');
        case 'get-website-files':
          return Promise.resolve([
            { name: '404.md', filePath: '/path/404.md', isDirectory: false, relativePath: '404.md' },
            { name: 'index.md', filePath: '/path/index.md', isDirectory: false, relativePath: 'index.md' },
          ]);
        case 'get-website-schema':
          return Promise.resolve({
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', title: 'Website Title' },
                language: { type: 'string', title: 'Language' },
              },
            },
          });
        case 'get-file-content':
          return Promise.resolve('{"title": "Test Website", "language": "en"}');
        default:
          return Promise.resolve(null);
      }
    });
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    jest.restoreAllMocks();
  });

  test('INTEGRATION: Complete flow from globe click to WebsiteConfigEditor rendering', async () => {
    render(<TestApp />);

    // Wait for the website name to load
    await waitFor(
      () => {
        expect(screen.getByText('test-website')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    // Find the website config card by locating the container with both globe and website name
    const globeIcon = screen.getByText('🌐');
    const websiteCard = globeIcon.parentElement;
    expect(websiteCard).toBeInTheDocument();
    expect(websiteCard).toContainElement(screen.getByText('test-website'));

    // Click the website card
    fireEvent.click(websiteCard!);

    // Wait for the WebsiteConfigEditor to appear
    await waitFor(
      () => {
        const configEditor = screen.queryByTestId('website-config-editor');
        if (!configEditor) {
          // WebsiteConfigEditor not found - test will fail with assertion
        }
        expect(configEditor).toBeInTheDocument();
      },
      { timeout: 10000 }
    );

    // Verify the correct tab is showing
    expect(screen.getByText('🌐 Website Configuration')).toBeInTheDocument();
  });

  test('INTEGRATION: Verify state management flow during globe click', async () => {
    render(<TestApp />);

    // Wait for the website name to load
    await waitFor(() => {
      expect(screen.getByText('test-website')).toBeInTheDocument();
    });

    // Verify initial state - should not show WebsiteConfigEditor yet
    expect(screen.queryByTestId('website-config-editor')).not.toBeInTheDocument();

    // Click the website config card
    const globeIcon = screen.getByText('🌐');
    const websiteCard = globeIcon.parentElement;
    fireEvent.click(websiteCard!);

    // Verify the state change occurred by checking that WebsiteConfigEditor appears
    await waitFor(() => {
      expect(screen.getByTestId('website-config-editor')).toBeInTheDocument();
    });

    // Verify the correct view is showing
    expect(screen.getByText('🌐 Website Configuration')).toBeInTheDocument();
    expect(screen.getByText('Website Configuration Editor Loaded')).toBeInTheDocument();

    // Verify IPC calls were made correctly
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith('set-edit-mode', 'test-website');

    // Verify that the expected IPC calls for file loading occurred
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-current-website-name');
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-files', 'test-website');
  });
});
