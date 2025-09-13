/**
 * @file Regression test for WebsiteConfigEditor lazy loading failure
 * @description Bug: React.lazy() import fails silently, preventing WebsiteConfigEditor from loading
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

describe('WebsiteConfigEditor Lazy Loading Regression Tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('REGRESSION: WebsiteConfigEditor should be importable via React.lazy()', async () => {
    // Mock the AppProvider context to avoid context errors
    const { AppProvider } = require('../../src/renderer/ui/react/context/AppContext');

    // Mock electronAPI for the component
    const mockElectronAPI = {
      invoke: jest.fn().mockResolvedValue({ schema: { type: 'object', properties: {} } }),
      send: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true,
    });

    // Test the exact lazy import pattern used in Main.tsx
    const LazyWebsiteConfigEditor = React.lazy(
      () => import('../../src/renderer/ui/react/components/WebsiteConfigEditor')
    );

    const TestComponent = () => (
      <AppProvider>
        <React.Suspense fallback={<div data-testid="loading-fallback">Loading...</div>}>
          <LazyWebsiteConfigEditor />
        </React.Suspense>
      </AppProvider>
    );

    render(<TestComponent />);

    // Should initially show the loading fallback
    expect(screen.getByTestId('loading-fallback')).toBeInTheDocument();

    // Should eventually load the component (this will fail if lazy loading is broken)
    await waitFor(
      () => {
        // The component should render and not be stuck in loading state
        expect(screen.queryByTestId('loading-fallback')).not.toBeInTheDocument();

        // Should show the actual component (it renders "Website Configuration" heading)
        expect(screen.getByText('Website Configuration')).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
  });

  test('REGRESSION: WebsiteConfigEditor should have correct exports', () => {
    // Test that the module can be imported synchronously
    const WebsiteConfigEditor = require('../../src/renderer/ui/react/components/WebsiteConfigEditor');

    // Should have both named and default exports
    expect(WebsiteConfigEditor).toBeDefined();
    expect(WebsiteConfigEditor.WebsiteConfigEditor).toBeDefined();
    expect(WebsiteConfigEditor.default).toBeDefined();

    // Both exports should be the same function
    expect(WebsiteConfigEditor.WebsiteConfigEditor).toBe(WebsiteConfigEditor.default);
    expect(typeof WebsiteConfigEditor.default).toBe('function');
  });

  test('REGRESSION: Main component lazy import should use correct syntax', async () => {
    // Read the Main.tsx file to verify the import syntax
    const fs = require('fs');
    const path = require('path');

    const mainFilePath = path.join(__dirname, '../../src/renderer/ui/react/components/Main.tsx');
    const mainFileContent = fs.readFileSync(mainFilePath, 'utf8');

    // Verify the lazy import syntax is correct
    expect(mainFileContent).toContain('lazy(');
    expect(mainFileContent).toContain('import');
    expect(mainFileContent).toContain('WebsiteConfigEditor');

    // Check for the specific import pattern that should work
    const hasCorrectImport =
      mainFileContent.includes(`import('./WebsiteConfigEditor')`) ||
      mainFileContent.includes(`import(/* webpackChunkName: "website-config-editor" */ './WebsiteConfigEditor')`);

    expect(hasCorrectImport).toBe(true);
  });
});
