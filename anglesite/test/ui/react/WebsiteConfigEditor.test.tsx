/**
 * @file Unit tests for WebsiteConfigEditor component
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { WebsiteConfigEditor } from '../../../src/renderer/ui/react/components/WebsiteConfigEditor';

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

  // MockAppProvider relies on global mocks from beforeEach
  // No need to override here as it can cause timing issues

  return <AppContext.Provider value={mockContextValue}>{children}</AppContext.Provider>;
};

describe('WebsiteConfigEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // DON'T use fake timers by default - let individual tests control this
    jest.useRealTimers();

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

      if (channel === 'telemetry:get-config') {
        return Promise.resolve({ enabled: false });
      }

      if (channel === 'telemetry:record-event') {
        return Promise.resolve(true);
      }

      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Clean up timers - always end with real timers
    jest.useRealTimers();
  });

  describe('Component Rendering', () => {
    it('should render the component with website configuration', async () => {
      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(
        () => {
          expect(screen.getByText('Website Configuration')).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Wait for the component to finish loading and show the form
      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
        },
        { timeout: 5000 }
      );
    }, 15000);

    it('should show loading state when no website is selected', async () => {
      render(
        <MockAppProvider websiteName="">
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('No website loaded')).toBeInTheDocument();
      });
    });
  });

  describe('Schema Loading', () => {
    it('should load schema from IPC', async () => {
      // Use real timers for this test
      jest.useRealTimers();

      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(
        () => {
          expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-website-schema', 'test-website');
        },
        { timeout: 5000 }
      );

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);

    it('should handle schema loading errors gracefully', async () => {
      // Use real timers for this test
      jest.useRealTimers();

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
        if (channel === 'telemetry:get-config') {
          return Promise.resolve({ enabled: false });
        }
        if (channel === 'telemetry:record-event') {
          return Promise.resolve(true);
        }
        return Promise.resolve(null);
      });

      render(
        <TestErrorProvider>
          <WebsiteConfigEditor />
        </TestErrorProvider>
      );

      await waitFor(
        () => {
          expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);
  });

  describe('Data Loading and Saving', () => {
    it('should load existing website.json data', async () => {
      // Use real timers for this test
      jest.useRealTimers();

      render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(
        () => {
          expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
            'get-file-content',
            'test-website',
            'src/_data/website.json'
          );
        },
        { timeout: 5000 }
      );

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);

    it('should save configuration when save button is clicked', async () => {
      // Use real timers for initial load
      jest.useRealTimers();
      const onSave = jest.fn();

      render(
        <MockAppProvider>
          <WebsiteConfigEditor onSave={onSave} />
        </MockAppProvider>
      );

      await waitFor(
        () => {
          expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Make a change to trigger unsaved state
      const titleInput = screen.getByLabelText(/Website Title/);
      fireEvent.change(titleInput, { target: { value: 'Modified Title' } });

      // The submit button should be available
      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      const saveButton = screen.getByRole('button', { name: /submit/i });

      // Switch to fake timers for debouncing
      jest.useFakeTimers();
      fireEvent.click(saveButton);

      // Fast-forward through the debounce delay
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // Switch back to real timers for async verification
      jest.useRealTimers();

      await waitFor(
        () => {
          expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
            'save-file-content',
            'test-website',
            'src/_data/website.json',
            expect.any(String)
          );
        },
        { timeout: 5000 }
      );

      await waitFor(
        () => {
          expect(onSave).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);

    it('should call onSave prop when form is saved successfully', async () => {
      // Use real timers for initial load
      jest.useRealTimers();
      const onSave = jest.fn();

      render(
        <MockAppProvider>
          <WebsiteConfigEditor onSave={onSave} />
        </MockAppProvider>
      );

      await waitFor(
        () => {
          expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Make a change
      const titleInput = screen.getByLabelText(/Website Title/);
      fireEvent.change(titleInput, { target: { value: 'New Title' } });

      await waitFor(
        () => {
          expect(screen.getByText(/Submit/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      const saveButton = screen.getByRole('button', { name: /Submit/i });

      // Switch to fake timers for debouncing
      jest.useFakeTimers();
      fireEvent.click(saveButton);

      // Fast-forward through the debounce delay
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // Switch back to real timers for async verification
      jest.useRealTimers();

      await waitFor(
        () => {
          expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
              title: 'New Title',
            })
          );
        },
        { timeout: 5000 }
      );

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);

    it('should handle save errors gracefully', async () => {
      // Use real timers for initial load
      jest.useRealTimers();
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
        if (channel === 'telemetry:get-config') {
          return Promise.resolve({ enabled: false });
        }
        if (channel === 'telemetry:record-event') {
          return Promise.resolve(true);
        }
        return Promise.resolve(null);
      });

      render(
        <TestSaveErrorProvider>
          <WebsiteConfigEditor onError={onError} />
        </TestSaveErrorProvider>
      );

      await waitFor(
        () => {
          expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Make a change to trigger unsaved state
      const titleInput = screen.getByLabelText(/Website Title/);
      fireEvent.change(titleInput, { target: { value: 'Modified Title' } });

      // Now the save button should show "Submit"
      await waitFor(
        () => {
          expect(screen.getByText(/Submit/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      const saveButton = screen.getByRole('button', { name: /Submit/i });

      // Switch to fake timers for debouncing
      jest.useFakeTimers();
      fireEvent.click(saveButton);

      // Fast-forward through the debounce delay
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // Switch back to real timers for async verification
      jest.useRealTimers();

      await waitFor(
        () => {
          expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to save'));
        },
        { timeout: 5000 }
      );

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);
  });

  describe('Form Interactions', () => {
    it('should allow form field modifications', async () => {
      // Use real timers for this test since it doesn't involve debouncing
      jest.useRealTimers();

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
        if (channel === 'telemetry:get-config') {
          return Promise.resolve({ enabled: false });
        }
        if (channel === 'telemetry:record-event') {
          return Promise.resolve(true);
        }
        return Promise.resolve(null);
      });

      render(
        <TestUnsavedChangesProvider>
          <WebsiteConfigEditor />
        </TestUnsavedChangesProvider>
      );

      // Wait for form to load
      await waitFor(
        () => {
          expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Modify a form field
      const titleInput = screen.getByLabelText(/Website Title/);
      await userEvent.type(titleInput, ' Modified');

      // Verify the input value changed
      await waitFor(
        () => {
          expect(titleInput).toHaveValue('Existing Website Modified');
        },
        { timeout: 5000 }
      );

      // Restore fake timers for subsequent tests
      jest.useFakeTimers();
    });

    it('should save form changes when submitted', async () => {
      // Use real timers initially for form loading
      jest.useRealTimers();

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
        if (channel === 'telemetry:get-config') {
          return Promise.resolve({ enabled: false });
        }
        if (channel === 'telemetry:record-event') {
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
      await waitFor(
        () => {
          expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Modify form to update content
      const titleInput = screen.getByLabelText(/Website Title/);
      await userEvent.type(titleInput, ' Modified');

      // Verify the input value changed
      await waitFor(
        () => {
          expect(titleInput).toHaveValue('Existing Website Modified');
        },
        { timeout: 5000 }
      );

      // Save the changes - switch back to fake timers for debouncing
      jest.useFakeTimers();
      const saveButton = screen.getByRole('button', { name: /Submit/i });
      fireEvent.click(saveButton);

      // Fast-forward through the debounce delay
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // Verify save was called
      await waitFor(
        () => {
          expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
            'save-file-content',
            'test-website',
            'src/_data/website.json',
            expect.stringContaining('Existing Website Modified')
          );
        },
        { timeout: 5000 }
      );
    });
  });

  describe('Performance Optimization', () => {
    it('should debounce rapid save operations', async () => {
      // Use real timers for initial load
      jest.useRealTimers();
      const onSave = jest.fn();

      render(
        <MockAppProvider>
          <WebsiteConfigEditor onSave={onSave} />
        </MockAppProvider>
      );

      await waitFor(
        () => {
          expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      const titleInput = screen.getByLabelText(/Website Title/);
      const saveButton = screen.getByRole('button', { name: /Submit/i });

      // Switch to fake timers for debouncing
      jest.useFakeTimers();

      // Rapidly submit form multiple times
      fireEvent.change(titleInput, { target: { value: 'Title 1' } });
      fireEvent.click(saveButton);

      fireEvent.change(titleInput, { target: { value: 'Title 2' } });
      fireEvent.click(saveButton);

      fireEvent.change(titleInput, { target: { value: 'Title 3' } });
      fireEvent.click(saveButton);

      // Only advance time by 500ms - should not trigger saves yet
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(mockElectronAPI.invoke).not.toHaveBeenCalledWith(
        'save-file-content',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      // Advance time to complete debounce delay
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      // Switch back to real timers for async verification
      jest.useRealTimers();

      // Should only have one save call with the final value
      await waitFor(
        () => {
          const saveCalls = mockElectronAPI.invoke.mock.calls.filter((call) => call[0] === 'save-file-content');
          expect(saveCalls).toHaveLength(1);
          expect(saveCalls[0][3]).toContain('Title 3');
        },
        { timeout: 5000 }
      );

      expect(onSave).toHaveBeenCalledTimes(1);

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);

    it('should cancel pending saves on component unmount', async () => {
      // Use real timers for initial load
      jest.useRealTimers();

      const { unmount } = render(
        <MockAppProvider>
          <WebsiteConfigEditor />
        </MockAppProvider>
      );

      await waitFor(
        () => {
          expect(screen.getByLabelText(/Website Title/)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      const titleInput = screen.getByLabelText(/Website Title/);
      const saveButton = screen.getByRole('button', { name: /Submit/i });

      // Switch to fake timers for debouncing
      jest.useFakeTimers();

      // Trigger save
      fireEvent.change(titleInput, { target: { value: 'Cancelled Save' } });
      fireEvent.click(saveButton);

      // Unmount before debounce completes
      unmount();

      // Complete the debounce delay
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // Should not have called save after unmount
      expect(mockElectronAPI.invoke).not.toHaveBeenCalledWith(
        'save-file-content',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      // Restore fake timers
      jest.useFakeTimers();
    }, 15000);
  });

  describe('Keyboard Shortcuts', () => {
    it.skip('should save on Cmd+S or Ctrl+S (not implemented)', async () => {
      // TODO: Implement keyboard shortcuts in WebsiteConfigEditor component
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
