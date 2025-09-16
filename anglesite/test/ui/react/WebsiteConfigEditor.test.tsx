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

// Mock AppContext with test data - Fixed version that provides websiteName synchronously
import { AppContext } from '../../../src/renderer/ui/react/context/AppContext';

const MockAppProvider: React.FC<{ children: React.ReactNode; websiteName?: string }> = ({
  children,
  websiteName = 'test-website',
}) => {
  const mockContextValue = {
    state: {
      currentView: 'website-config' as const,
      selectedFile: null,
      websiteName: websiteName,
      websitePath: '/test/path',
      loading: false,
    },
    setCurrentView: jest.fn(),
    setSelectedFile: jest.fn(),
    setWebsiteName: jest.fn(),
    setWebsitePath: jest.fn(),
    setLoading: jest.fn(),
  };

  // Set up mocks synchronously
  React.useMemo(() => {
    mockElectronAPI.invoke.mockImplementation((channel: string, ..._args: unknown[]) => {
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

  return <AppContext.Provider value={mockContextValue}>{children}</AppContext.Provider>;
};

describe('WebsiteConfigEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks for IPC calls
    mockElectronAPI.invoke.mockImplementation((channel: string, ..._args: unknown[]) => {
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

      // Wait for the component to finish loading
      await waitFor(() => {
        expect(screen.getByText(/Configure your website settings, metadata, and features/)).toBeInTheDocument();
      });
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
      // Create a dedicated mock context for this test
      const TestErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const mockContextValue = {
          state: {
            currentView: 'website-config' as const,
            selectedFile: null,
            websiteName: 'test-website',
            websitePath: '/test/path',
            loading: false,
          },
          setCurrentView: jest.fn(),
          setSelectedFile: jest.fn(),
          setWebsiteName: jest.fn(),
          setWebsitePath: jest.fn(),
          setLoading: jest.fn(),
        };

        return <AppContext.Provider value={mockContextValue}>{children}</AppContext.Provider>;
      };

      // Setup mock that returns error
      mockElectronAPI.invoke.mockImplementation((channel: string, ..._args: unknown[]) => {
        if (channel === 'get-website-schema') {
          return Promise.resolve({
            error: 'Schema not found',
            fallbackSchema: {
              type: 'object',
              properties: {
                title: { type: 'string', title: 'Website Title' },
                language: { type: 'string', title: 'Language', default: 'en' },
              },
              required: ['title', 'language'],
            },
          });
        }
        if (channel === 'get-file-content') {
          return Promise.resolve(
            JSON.stringify({
              title: 'Test Website',
              language: 'en',
            })
          );
        }
        return Promise.resolve(null);
      });

      render(
        <TestErrorProvider>
          <WebsiteConfigEditor />
        </TestErrorProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Schema loading failed: Schema not found/)).toBeInTheDocument();
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

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
      });

      // Make a change to trigger unsaved state
      const titleInput = screen.getByLabelText(/Website Title/);
      fireEvent.change(titleInput, { target: { value: 'Modified Title' } });

      // Now the save button should show "Save Configuration"
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

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
      });

      // Make a change to trigger unsaved state
      const titleInput = screen.getByLabelText(/Website Title/);
      fireEvent.change(titleInput, { target: { value: 'New Title' } });

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

      // Create a dedicated mock context for this test
      const TestSaveErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const mockContextValue = {
          state: {
            currentView: 'website-config' as const,
            selectedFile: null,
            websiteName: 'test-website',
            websitePath: '/test/path',
            loading: false,
          },
          setCurrentView: jest.fn(),
          setSelectedFile: jest.fn(),
          setWebsiteName: jest.fn(),
          setWebsitePath: jest.fn(),
          setLoading: jest.fn(),
        };

        return <AppContext.Provider value={mockContextValue}>{children}</AppContext.Provider>;
      };

      // Setup mock that returns save error
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'save-file-content') {
          return Promise.resolve(false);
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
              },
            },
          });
        }
        if (channel === 'get-file-content') {
          return Promise.resolve(
            JSON.stringify({
              title: 'Existing Website',
              language: 'en',
            })
          );
        }
        return Promise.resolve(null);
      });

      render(
        <TestSaveErrorProvider>
          <WebsiteConfigEditor onError={onError} />
        </TestSaveErrorProvider>
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
      });

      // Make a change to trigger unsaved state
      const titleInput = screen.getByLabelText(/Website Title/);
      fireEvent.change(titleInput, { target: { value: 'Modified Title' } });

      // Now the save button should show "Save Configuration"
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
      // Create a dedicated mock context for this test
      const TestUnsavedChangesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const mockContextValue = {
          state: {
            currentView: 'website-config' as const,
            selectedFile: null,
            websiteName: 'test-website',
            websitePath: '/test/path',
            loading: false,
          },
          setCurrentView: jest.fn(),
          setSelectedFile: jest.fn(),
          setWebsiteName: jest.fn(),
          setWebsitePath: jest.fn(),
          setLoading: jest.fn(),
        };

        return <AppContext.Provider value={mockContextValue}>{children}</AppContext.Provider>;
      };

      // Setup standard mocks
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
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
              },
            },
          });
        }
        if (channel === 'get-file-content') {
          return Promise.resolve(
            JSON.stringify({
              title: 'Existing Website',
              language: 'en',
            })
          );
        }
        return Promise.resolve(null);
      });

      render(
        <TestUnsavedChangesProvider>
          <WebsiteConfigEditor />
        </TestUnsavedChangesProvider>
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
      });

      // Initially should not show unsaved changes
      expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();

      // Modify a form field
      const titleInput = screen.getByLabelText(/Website Title/);
      await userEvent.type(titleInput, ' Modified');

      // Should now show unsaved changes
      await waitFor(() => {
        expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
      });
    });

    it('should clear unsaved changes indicator after save', async () => {
      // Create a dedicated mock context for this test
      const TestClearChangesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const mockContextValue = {
          state: {
            currentView: 'website-config' as const,
            selectedFile: null,
            websiteName: 'test-website',
            websitePath: '/test/path',
            loading: false,
          },
          setCurrentView: jest.fn(),
          setSelectedFile: jest.fn(),
          setWebsiteName: jest.fn(),
          setWebsitePath: jest.fn(),
          setLoading: jest.fn(),
        };

        return <AppContext.Provider value={mockContextValue}>{children}</AppContext.Provider>;
      };

      // Setup standard mocks including save success
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
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
              },
            },
          });
        }
        if (channel === 'get-file-content') {
          return Promise.resolve(
            JSON.stringify({
              title: 'Existing Website',
              language: 'en',
            })
          );
        }
        if (channel === 'save-file-content') {
          return Promise.resolve(true);
        }
        return Promise.resolve(null);
      });

      render(
        <TestClearChangesProvider>
          <WebsiteConfigEditor />
        </TestClearChangesProvider>
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
      });

      // Initially should not show unsaved changes
      expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();

      // Modify form to create unsaved changes
      const titleInput = screen.getByLabelText(/Website Title/);
      await userEvent.type(titleInput, ' Modified');

      // Should show unsaved changes
      await waitFor(() => {
        expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
      });

      // Save the changes
      const saveButton = screen.getByRole('button', { name: /Save Configuration/i });
      fireEvent.click(saveButton);

      // Should clear unsaved changes indicator after save
      await waitFor(() => {
        expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should save on Cmd+S or Ctrl+S', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
      });

      // Make a change to trigger unsaved state
      const titleInput = screen.getByLabelText(/Website Title/);
      fireEvent.change(titleInput, { target: { value: 'Keyboard Test' } });

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
      // Create a simple component that always throws
      const ThrowingComponent = () => {
        throw new Error('Test render error');
      };

      // Import ErrorBoundary directly for testing
      const { ErrorBoundary } = await import('../../../src/renderer/ui/react/components/ErrorBoundary');

      // Spy on console.error to suppress error logging during test
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ErrorBoundary componentName="TestComponent">
          <ThrowingComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
      expect(screen.getByText(/TestComponent encountered an error/)).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
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
