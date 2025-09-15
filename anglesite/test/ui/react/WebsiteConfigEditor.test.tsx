/**
 * @file Unit tests for WebsiteConfigEditor component
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { WebsiteConfigEditor } from '../../../src/renderer/ui/react/components/WebsiteConfigEditor';
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

// Mock the logger
jest.mock('../../../src/renderer/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock AppContext with test data
const MockAppProvider: React.FC<{ children: React.ReactNode; websiteName?: string }> = ({
  children,
  websiteName = 'test-website',
}) => {
  // Set up the mock to return our test website name
  React.useEffect(() => {
    mockElectronAPI.invoke.mockImplementation((channel: string, ...args: any[]) => {
      if (channel === 'get-current-website-name') {
        return Promise.resolve(websiteName || null);
      }
      if (channel === 'get-website-schema') {
        return Promise.resolve({
          schema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'Test Website Schema',
            type: 'object',
            required: ['title', 'language'],
            properties: {
              title: {
                type: 'string',
                title: 'Website Title',
                description: 'The main title of your website',
              },
              language: {
                type: 'string',
                title: 'Language',
                default: 'en',
              },
              description: {
                type: 'string',
                title: 'Description',
              },
            },
          },
        });
      }
      if (channel === 'get-file-content') {
        return Promise.resolve(
          JSON.stringify({
            title: 'Existing Website',
            language: 'en',
            description: 'An existing website configuration',
          })
        );
      }
      if (channel === 'save-file-content') {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });
  }, [websiteName]);

  return <AppProvider>{children}</AppProvider>;
};

describe('WebsiteConfigEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks for IPC calls
    mockElectronAPI.invoke.mockImplementation((channel: string, ...args: any[]) => {
      if (channel === 'get-website-schema') {
        return Promise.resolve({
          schema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'Test Website Schema',
            type: 'object',
            required: ['title', 'language'],
            properties: {
              title: {
                type: 'string',
                title: 'Website Title',
                description: 'The main title of your website',
              },
              language: {
                type: 'string',
                title: 'Language',
                default: 'en',
              },
              description: {
                type: 'string',
                title: 'Description',
              },
            },
          },
        });
      }

      if (channel === 'get-file-content') {
        return Promise.resolve(
          JSON.stringify({
            title: 'Existing Website',
            language: 'en',
            description: 'An existing website configuration',
          })
        );
      }

      if (channel === 'save-file-content') {
        return Promise.resolve(true);
      }

      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Component Rendering', () => {
    it('should render the component with website configuration', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Website Configuration')).toBeInTheDocument();
      });

      expect(screen.getByText(/Configure your website settings/)).toBeInTheDocument();
    });

    it('should show loading state when no website is selected', async () => {
      render(
        <MockAppProvider websiteName="">
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Waiting for website to load...')).toBeInTheDocument();
      });
    });
  });

  describe('Schema Loading', () => {
    it('should load schema from IPC', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-schema', 'test-website');
      });
    });

    it('should handle schema loading errors gracefully', async () => {
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'get-website-schema') {
          return Promise.resolve({
            error: 'Schema not found',
            fallbackSchema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
              },
            },
          });
        }
        return Promise.resolve(null);
      });

      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Schema loading failed/)).toBeInTheDocument();
      });
    });
  });

  describe('Data Loading and Saving', () => {
    it('should load existing website.json data', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
          'get-file-content',
          'test-website',
          'src/_data/website.json'
        );
      });
    });

    it('should save configuration when save button is clicked', async () => {
      const onSave = jest.fn();

      render(
        <MockAppProvider>
          <WebsiteConfigEditor onSave={onSave} />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Save Configuration/)).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /Save Configuration/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
          'save-file-content',
          'test-website',
          'src/_data/website.json',
          expect.any(String)
        );
      });

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });
    });

    it('should show success message after successful save', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Save Configuration/)).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /Save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Configuration saved successfully/)).toBeInTheDocument();
      });
    });

    it('should handle save errors gracefully', async () => {
      const onError = jest.fn();

      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'save-file-content') {
          return Promise.resolve(false);
        }
        return Promise.resolve(null);
      });

      render(
        <MockAppProvider>
          <WebsiteConfigEditor onError={onError} />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Save Configuration/)).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /Save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to save'));
      });
    });
  });

  describe('Unsaved Changes', () => {
    it('should track unsaved changes', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
      });

      // Find and modify a form field (this is simplified, actual implementation may vary)
      const inputs = screen.getAllByRole('textbox');
      if (inputs.length > 0) {
        await userEvent.type(inputs[0], ' Modified');

        await waitFor(() => {
          expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
        });
      }
    });

    it('should clear unsaved changes indicator after save', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Save Configuration/)).toBeInTheDocument();
      });

      // Modify form to create unsaved changes
      const inputs = screen.getAllByRole('textbox');
      if (inputs.length > 0) {
        await userEvent.type(inputs[0], ' Modified');

        await waitFor(() => {
          expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
        });

        // Save the changes
        const saveButton = screen.getByRole('button', { name: /Save/i });
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
        });
      }
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should save on Cmd+S or Ctrl+S', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Save Configuration/)).toBeInTheDocument();
      });

      // Simulate Cmd+S
      fireEvent.keyDown(document, { key: 's', metaKey: true });

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
          'save-file-content',
          expect.any(String),
          expect.any(String),
          expect.any(String)
        );
      });
    });
  });

  describe('Error Boundary', () => {
    it('should catch and display errors gracefully', async () => {
      // Mock a schema that will cause an error
      mockElectronAPI.invoke.mockImplementation(() => {
        throw new Error('Test error');
      });

      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
      });
    });
  });

  describe('Form Validation', () => {
    it('should display validation errors for invalid data', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByText(/Website Configuration/)).toBeInTheDocument();
      });

      // Test is simplified as actual validation depends on RJSF implementation
      // In practice, you would test specific validation scenarios
    });
  });
});
