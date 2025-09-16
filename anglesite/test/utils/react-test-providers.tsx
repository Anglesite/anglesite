/**
 * @file Standardized React test providers and utilities
 * @description Provides reusable context providers and rendering utilities for React component tests
 */

import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { AppContext, type AppContextType } from '../../src/renderer/ui/react/context/AppContext';
import { MockFactory, setupElectronAPI } from './mock-factory';
import { TestData } from '../builders/website-config-builder';

/**
 * Default test context values that work for most test scenarios
 */
const defaultTestContext: AppContextType = {
  state: {
    currentView: 'file-explorer',
    selectedFile: null,
    websiteName: 'test-website',
    websitePath: '/test/path/test-website',
    loading: false,
  },
  setCurrentView: jest.fn(),
  setSelectedFile: jest.fn(),
  setWebsiteName: jest.fn(),
  setWebsitePath: jest.fn(),
  setLoading: jest.fn(),
};

/**
 * Creates a test context with optional overrides
 */
export function createTestContext(overrides?: Partial<AppContextType>): AppContextType {
  return {
    ...defaultTestContext,
    ...overrides,
    state: {
      ...defaultTestContext.state,
      ...overrides?.state,
    },
  };
}

/**
 * Test provider component that wraps components with AppContext
 */
export interface TestAppProviderProps {
  children: React.ReactNode;
  contextOverrides?: Partial<AppContextType>;
  websiteName?: string;
  currentView?: AppContextType['state']['currentView'];
}

export const TestAppProvider: React.FC<TestAppProviderProps> = ({
  children,
  contextOverrides,
  websiteName = 'test-website',
  currentView = 'file-explorer',
}) => {
  const contextValue = createTestContext({
    ...contextOverrides,
    state: {
      websiteName,
      currentView,
      selectedFile: null,
      websitePath: `/test/path/${websiteName}`,
      loading: false,
      ...contextOverrides?.state,
    },
  });

  // Setup default IPC responses for this context
  React.useEffect(() => {
    const electronAPI = setupElectronAPI({
      'get-current-website-name': websiteName || null,
      'get-website-schema': { schema: TestData.websiteSchema() },
      'get-file-content': JSON.stringify(TestData.minimalWebsiteConfig()),
      'save-file-content': true,
      'get-website-files': TestData.standardFiles(),
    });

    return () => {
      MockFactory.resetAllMocks();
    };
  }, [websiteName]);

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

/**
 * Custom render function that automatically wraps components with test providers
 */
export interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * App context overrides
   */
  contextOverrides?: Partial<AppContextType>;
  /**
   * Website name for the test
   */
  websiteName?: string;
  /**
   * Current view state
   */
  currentView?: AppContextType['state']['currentView'];
  /**
   * Custom ElectronAPI responses
   */
  electronAPIResponses?: Record<string, unknown>;
  /**
   * Whether to setup standard mocks automatically
   */
  setupMocks?: boolean;
}

export function renderWithTestProviders(ui: React.ReactElement, options: CustomRenderOptions = {}) {
  const {
    contextOverrides,
    websiteName = 'test-website',
    currentView = 'file-explorer',
    electronAPIResponses,
    setupMocks = true,
    ...renderOptions
  } = options;

  // Setup mocks if requested
  if (setupMocks) {
    setupElectronAPI(electronAPIResponses);
  }

  // Create wrapper component
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <TestAppProvider contextOverrides={contextOverrides} websiteName={websiteName} currentView={currentView}>
      {children}
    </TestAppProvider>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/**
 * Provider specifically for testing WebsiteConfigEditor
 */
export const WebsiteConfigTestProvider: React.FC<{
  children: React.ReactNode;
  websiteName?: string;
  hasUnsavedChanges?: boolean;
  schemaError?: string;
}> = ({ children, websiteName = 'test-website', hasUnsavedChanges = false, schemaError }) => {
  const contextValue = createTestContext({
    state: {
      currentView: 'website-config',
      websiteName,
      websitePath: `/test/path/${websiteName}`,
      selectedFile: null,
      loading: false,
    },
  });

  React.useEffect(() => {
    const schemaResponse = schemaError
      ? {
          error: schemaError,
          fallbackSchema: TestData.websiteSchema(),
        }
      : {
          schema: TestData.websiteSchema(),
        };

    setupElectronAPI({
      'get-current-website-name': websiteName,
      'get-website-schema': schemaResponse,
      'get-file-content': JSON.stringify({
        title: hasUnsavedChanges ? 'Modified Website' : 'Test Website',
        language: 'en',
        description: 'Test description',
      }),
      'save-file-content': true,
    });
  }, [websiteName, hasUnsavedChanges, schemaError]);

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

/**
 * Provider for testing FileExplorer component
 */
export const FileExplorerTestProvider: React.FC<{
  children: React.ReactNode;
  websiteName?: string;
  files?: Array<{ name: string; filePath: string; isDirectory: boolean; relativePath: string }>;
}> = ({ children, websiteName = 'test-website', files = TestData.standardFiles() }) => {
  const contextValue = createTestContext({
    state: {
      currentView: 'file-explorer',
      websiteName,
      websitePath: `/test/path/${websiteName}`,
      selectedFile: null,
      loading: false,
    },
  });

  React.useEffect(() => {
    setupElectronAPI({
      'get-current-website-name': websiteName,
      'get-website-files': files,
    });
  }, [websiteName, files]);

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

/**
 * Provider for testing components in loading state
 */
export const LoadingTestProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const contextValue = createTestContext({
    state: {
      currentView: 'file-explorer',
      websiteName: '',
      websitePath: '',
      selectedFile: null,
      loading: true,
    },
  });

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

/**
 * Provider for testing error states
 */
export const ErrorTestProvider: React.FC<{
  children: React.ReactNode;
  errorType?: 'network' | 'schema' | 'file' | 'generic';
}> = ({ children, errorType = 'generic' }) => {
  const contextValue = createTestContext({
    state: {
      currentView: 'file-explorer',
      websiteName: 'error-website',
      websitePath: '/test/path/error-website',
      selectedFile: null,
      loading: false,
    },
  });

  React.useEffect(() => {
    const errorResponses: Record<string, unknown> = {};

    switch (errorType) {
      case 'network':
        setupElectronAPI({
          'get-current-website-name': Promise.reject(new Error('Network error')),
        });
        break;
      case 'schema':
        errorResponses['get-website-schema'] = {
          error: 'Schema validation failed',
          fallbackSchema: TestData.websiteSchema(),
        };
        break;
      case 'file':
        errorResponses['get-file-content'] = Promise.reject(new Error('File not found'));
        break;
      default:
        errorResponses['get-current-website-name'] = Promise.reject(new Error('Generic error'));
    }

    if (Object.keys(errorResponses).length > 0) {
      setupElectronAPI(errorResponses);
    }
  }, [errorType]);

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

/**
 * Utility to render component with specific view state
 */
export function renderWithView(
  ui: React.ReactElement,
  view: AppContextType['state']['currentView'],
  options: Omit<CustomRenderOptions, 'currentView'> = {}
) {
  return renderWithTestProviders(ui, { ...options, currentView: view });
}

/**
 * Utility to render component with loading state
 */
export function renderWithLoading(ui: React.ReactElement) {
  return render(ui, { wrapper: LoadingTestProvider });
}

/**
 * Utility to render component with error state
 */
export function renderWithError(ui: React.ReactElement, errorType?: 'network' | 'schema' | 'file' | 'generic') {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ErrorTestProvider errorType={errorType}>{children}</ErrorTestProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

/**
 * Cleanup function to reset all test state
 */
export function cleanupTestProviders() {
  MockFactory.resetAllMocks();
  jest.clearAllMocks();
}
