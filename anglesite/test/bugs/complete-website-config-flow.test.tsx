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
  beforeEach(() => {
    jest.clearAllMocks();

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
    jest.restoreAllMocks();
  });

  test('INTEGRATION: Complete flow from globe click to WebsiteConfigEditor rendering', async () => {
    console.log('🧪 Starting complete integration test...');

    render(<TestApp />);

    // Wait for the website name to load
    await waitFor(
      () => {
        expect(screen.getByText('test-website')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    console.log('🧪 Website loaded, looking for globe icon...');

    // Find the website config card by locating the container with both globe and website name
    const globeIcon = screen.getByText('🌐');
    const websiteCard = globeIcon.parentElement;
    expect(websiteCard).toBeInTheDocument();
    expect(websiteCard).toContainElement(screen.getByText('test-website'));

    console.log('🧪 Found globe icon and website card, clicking...');

    // Click the website card
    fireEvent.click(websiteCard!);

    console.log('🧪 Clicked website card, waiting for WebsiteConfigEditor...');

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
    // Spy on console.log to capture state changes
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    render(<TestApp />);

    // Wait for the website name to load
    await waitFor(() => {
      expect(screen.getByText('test-website')).toBeInTheDocument();
    });

    // Click the website config card
    const globeIcon = screen.getByText('🌐');
    const websiteCard = globeIcon.parentElement;
    fireEvent.click(websiteCard!);

    // Check that the state management logs show the correct flow
    await waitFor(() => {
      const logs = consoleSpy.mock.calls
        .filter((call) => call[0] && typeof call[0] === 'string')
        .map((call) => call.join(' '));

      // Should see the FileExplorer click logs (with emoji prefixes)
      expect(logs.some((log) => log.includes('🌐 FileExplorer: handleWebsiteConfigClick called'))).toBe(true);
      expect(logs.some((log) => log.includes('🌐 FileExplorer: onWebsiteConfigSelect callback exists:'))).toBe(true);
      expect(logs.some((log) => log.includes('🌐 FileExplorer: Calling onWebsiteConfigSelect callback'))).toBe(true);

      // Should see the Sidebar handler logs (with emoji prefixes)
      expect(
        logs.some((log) =>
          log.includes('🔄 Sidebar: handleWebsiteConfigSelect called - setting view to website-config')
        )
      ).toBe(true);
    });

    consoleSpy.mockRestore();
  });
});
