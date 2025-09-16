# Test Utilities Guide

This document provides comprehensive guidance on using the new test utilities for maintainable, consistent testing across the Anglesite project.

## Overview

The test utilities provide a standardized approach to testing with:

- **MockFactory**: Centralized mock creation and management
- **Test Data Builders**: Fluent APIs for creating test data
- **React Test Providers**: Simplified React component testing
- **IPC Test Helpers**: Standardized backend testing patterns
- **Custom Assertions**: Domain-specific validation with better error messages

## Quick Start

### Basic React Component Test

```typescript
import { renderWithTestProviders } from '../utils/react-test-providers';
import { TestData } from '../builders/website-config-builder';

describe('MyComponent', () => {
  it('should render correctly', async () => {
    renderWithTestProviders(<MyComponent />, {
      websiteName: 'test-site',
      currentView: 'file-explorer'
    });

    await waitFor(() => {
      expect(screen.getByText('Expected Content')).toBeInTheDocument();
    });
  });
});
```

### Basic Backend/IPC Test

```typescript
import { setupElectronAPI } from '../utils/mock-factory';
import { IPCTestFactory } from '../utils/ipc-test-helpers';
import { TestData } from '../builders/website-config-builder';

describe('IPC Handler', () => {
  it('should handle requests correctly', async () => {
    const mockAPI = setupElectronAPI();
    const ipcHelper = IPCTestFactory.createHelper(mockAPI);

    ipcHelper.setupResponses({
      'get-website-schema': { schema: TestData.websiteSchema() },
    });

    const result = await mockAPI.invoke('get-website-schema', 'test-website');

    expect(result.schema).toHaveValidSchemaStructure();
    ipcHelper.expectCall('get-website-schema', 'test-website');
  });
});
```

## Utilities Reference

### MockFactory

Provides centralized mock creation for common dependencies.

#### Key Methods

```typescript
// Setup ElectronAPI with custom responses
const mockAPI = setupElectronAPI({
  'get-website-files': TestData.standardFiles(),
  'save-file-content': true,
});

// Create comprehensive Electron mocks
const electronMocks = MockFactory.setupElectronMocks();

// Create file system mocks
const fsMock = MockFactory.createFileSystemMock();

// Create console mocks with auto-restore
const consoleMocks = MockFactory.createMockConsole();
```

#### Best Practices

- Use `setupElectronAPI()` for most React component tests
- Use `MockFactory.setupElectronMocks()` for Node.js/main process tests
- Always call `MockFactory.resetAllMocks()` in `afterEach()`

### Test Data Builders

Fluent APIs for creating consistent test data.

#### WebsiteConfigBuilder

```typescript
// Minimal configuration for quick tests
const config = new WebsiteConfigBuilder().minimal().build();

// Comprehensive configuration for integration tests
const config = new WebsiteConfigBuilder().comprehensive().build();

// Custom configuration
const config = new WebsiteConfigBuilder().withTitle('My Site').withUrl('https://example.com').withRSLEnabled().build();

// Convenience methods
const config = TestData.minimalWebsiteConfig();
const config = TestData.comprehensiveWebsiteConfig();
```

#### CollectionItemBuilder

```typescript
// Create blog posts
const post = new CollectionItemBuilder()
  .asBlogPost('My First Post')
  .withAuthor('John Doe')
  .withTags(['tech', 'tutorial'])
  .build();

// Create pages
const page = new CollectionItemBuilder().asPage('About Us').withData({ featured: true }).build();

// Convenience methods
const post = TestData.blogPost('My Post');
const page = TestData.page('About');
```

#### FileSystemBuilder

```typescript
// Standard website files
const files = new FileSystemBuilder().withStandardFiles().build();

// Blog-specific files
const files = new FileSystemBuilder().withBlogFiles().build();

// Custom file structure
const files = new FileSystemBuilder()
  .addFile('index.md')
  .addDirectory('posts')
  .addFile('first-post.md', 'posts/first-post.md')
  .build();
```

### React Test Providers

Simplified React component testing with pre-configured contexts.

#### renderWithTestProviders

```typescript
// Basic rendering with default context
renderWithTestProviders(<MyComponent />);

// With custom context
renderWithTestProviders(<MyComponent />, {
  websiteName: 'my-site',
  currentView: 'website-config',
  contextOverrides: {
    state: { loading: true }
  }
});

// With custom IPC responses
renderWithTestProviders(<MyComponent />, {
  electronAPIResponses: {
    'get-file-content': JSON.stringify(TestData.minimalWebsiteConfig())
  }
});
```

#### Specialized Providers

```typescript
// For testing WebsiteConfigEditor
render(
  <WebsiteConfigTestProvider
    websiteName="test-site"
    hasUnsavedChanges={true}
    schemaError="Validation failed"
  >
    <WebsiteConfigEditor />
  </WebsiteConfigTestProvider>
);

// For testing FileExplorer
render(
  <FileExplorerTestProvider
    files={TestData.blogFiles()}
  >
    <FileExplorer />
  </FileExplorerTestProvider>
);

// For testing loading states
renderWithLoading(<MyComponent />);

// For testing error states
renderWithError(<MyComponent />, 'network');
```

### IPC Test Helpers

Standardized patterns for testing backend functionality.

#### IPCTestHelper

```typescript
const mockAPI = setupElectronAPI();
const ipcHelper = IPCTestFactory.createHelper(mockAPI);

// Setup responses
ipcHelper.setupResponses({
  'get-website-schema': { schema: TestData.websiteSchema() },
  'save-file-content': true,
});

// Dynamic responses based on arguments
ipcHelper.setupDynamicResponse('get-file-content', (websiteName, filePath) => {
  if (filePath === 'src/_data/website.json') {
    return JSON.stringify(TestData.minimalWebsiteConfig());
  }
  return 'File content';
});

// Assertions
ipcHelper.expectCall('get-website-schema', 'test-website');
ipcHelper.expectCallCount('save-file-content', 2);
ipcHelper.expectCallMatching('get-file-content', (args) => args[1].endsWith('.json'));
```

#### Test Patterns

```typescript
const patterns = IPCTestFactory.createPatterns(mockAPI);

// Standard file operation test
await patterns.fileOperation(
  'get-file-content',
  'test-website',
  'src/_data/website.json',
  JSON.stringify(TestData.minimalWebsiteConfig())
);

// Schema operation test
await patterns.schemaOperation(
  'test-website',
  TestData.websiteSchema(),
  true // should succeed
);

// Error handling test
await patterns.errorHandling('get-file-content', ['test-website', 'missing-file.json'], 'File not found');
```

### Custom Assertions

Domain-specific assertions with improved error messages.

#### Website and Configuration Assertions

```typescript
// Website configuration validation
expect(config).toBeValidWebsiteConfig();

// Collection item validation
expect(item).toBeValidCollectionItem();

// RSL structure validation
expect(rslConfig).toHaveValidRSLStructure();

// Schema validation
expect(schema).toHaveValidSchemaStructure();
```

#### File and Data Assertions

```typescript
// File path validation
expect('/valid/path/file.txt').toBeValidFilePath();

// Website name validation (includes security checks)
expect('my-website').toBeValidWebsiteName();
expect('../malicious-path').not.toBeValidWebsiteName();

// URL validation
expect('https://example.com').toBeValidURL();

// XML and JSON validation
expect(xmlContent).toBeValidXML();
expect(jsonString).toBeValidJSON();

// File structure validation
expect(fileArray).toHaveValidFileStructure();
```

#### IPC and Mock Assertions

```typescript
// IPC call validation
expect(mockAPI).toHaveCalledIPC('get-website-schema', 'test-website');
expect(mockAPI).toHaveCalledIPCTimes('save-file-content', 2);

// Console output validation
expect(consoleMock).toHaveValidConsoleOutput('error');
```

## Migration Guide

### From Old Pattern to New Pattern

#### Before: Manual Mock Setup

```typescript
// OLD - Repetitive and error-prone
const mockElectronAPI = {
  invoke: jest.fn(),
  send: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

mockElectronAPI.invoke.mockImplementation((channel) => {
  if (channel === 'get-website-schema') {
    return Promise.resolve({
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
        },
      },
    });
  }
  // ... more boilerplate
});
```

#### After: Utility-Based Setup

```typescript
// NEW - Clean and reusable
const mockAPI = setupElectronAPI({
  'get-website-schema': { schema: TestData.websiteSchema() },
});
```

#### Before: Magic Test Data

```typescript
// OLD - Hard to maintain and understand
const websiteConfig = {
  title: 'Test Website',
  url: 'https://test.example.com',
  language: 'en',
  author: {
    name: 'Test Author',
    email: 'test@example.com',
  },
  rsl: {
    enabled: true,
    defaultOutputFormats: ['sitewide', 'collection'],
    defaultLicense: {
      permits: [
        { type: 'usage', values: ['view', 'download'] },
        { type: 'user', values: ['individual'] },
      ],
      // ... 20+ more lines of nested config
    },
  },
};
```

#### After: Builder Pattern

```typescript
// NEW - Fluent, maintainable, and self-documenting
const websiteConfig = new WebsiteConfigBuilder()
  .withTitle('Test Website')
  .withUrl('https://test.example.com')
  .withAuthor('Test Author', 'test@example.com')
  .withRSLEnabled()
  .build();
```

#### Before: Complex React Provider Setup

```typescript
// OLD - Verbose and duplicated across tests
const MockAppProvider = ({ children, websiteName = 'test-website' }) => {
  const mockContextValue = {
    state: {
      currentView: 'website-config',
      selectedFile: null,
      websiteName: websiteName,
      websitePath: '/test/path',
      loading: false,
    },
    setCurrentView: jest.fn(),
    setSelectedFile: jest.fn(),
    // ... more mock methods
  };

  React.useEffect(() => {
    // Setup IPC responses...
  }, [websiteName]);

  return (
    <AppContext.Provider value={mockContextValue}>
      {children}
    </AppContext.Provider>
  );
};
```

#### After: Utility Provider

```typescript
// NEW - One line with configuration options
renderWithTestProviders(<MyComponent />, {
  websiteName: 'test-website',
  currentView: 'website-config'
});
```

## Testing Patterns and Best Practices

### Component Testing Pattern

```typescript
describe('MyComponent', () => {
  beforeEach(() => {
    // Utilities handle most setup automatically
  });

  afterEach(() => {
    MockFactory.resetAllMocks();
  });

  describe('Rendering', () => {
    it('should render with valid data', async () => {
      renderWithTestProviders(<MyComponent />, {
        websiteName: 'test-site'
      });

      await waitFor(() => {
        expect(screen.getByText('Expected Content')).toBeInTheDocument();
      });
    });
  });

  describe('User Interactions', () => {
    it('should handle clicks correctly', async () => {
      const mockAPI = setupElectronAPI({
        'save-file-content': true
      });

      renderWithTestProviders(<MyComponent />);

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockAPI).toHaveCalledIPC('save-file-content');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      renderWithError(<MyComponent />, 'network');

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });
  });
});
```

### Backend Testing Pattern

```typescript
describe('BackendFunction', () => {
  let mockAPI: ReturnType<typeof setupElectronAPI>;
  let ipcHelper: ReturnType<typeof IPCTestFactory.createHelper>;

  beforeEach(() => {
    mockAPI = setupElectronAPI();
    ipcHelper = IPCTestFactory.createHelper(mockAPI);
  });

  afterEach(() => {
    MockFactory.resetAllMocks();
  });

  describe('Success Cases', () => {
    it('should handle valid input', async () => {
      const testConfig = TestData.minimalWebsiteConfig();

      ipcHelper.setupResponses({
        'get-file-content': JSON.stringify(testConfig),
      });

      const result = await myBackendFunction('test-website');

      expect(result).toBeValidWebsiteConfig();
      ipcHelper.expectCall('get-file-content', 'test-website', 'src/_data/website.json');
    });
  });

  describe('Error Cases', () => {
    it('should handle file not found', async () => {
      await ipcHelper.patterns.errorHandling(
        'get-file-content',
        ['missing-website', 'src/_data/website.json'],
        'File not found'
      );
    });
  });
});
```

### Integration Testing Pattern

```typescript
describe('Integration Test', () => {
  it('should work end-to-end', async () => {
    // Use builders for consistent test data
    const websiteConfig = new WebsiteConfigBuilder()
      .comprehensive()
      .build();

    const files = new FileSystemBuilder()
      .withBlogFiles()
      .build();

    // Use providers for complete React testing
    renderWithTestProviders(<App />, {
      electronAPIResponses: {
        'get-website-files': files,
        'get-file-content': JSON.stringify(websiteConfig)
      }
    });

    // Interact with the UI
    fireEvent.click(screen.getByText('🌐'));

    // Verify the complete flow
    await waitFor(() => {
      expect(screen.getByText('Website Configuration')).toBeInTheDocument();
    });

    // Use custom assertions for validation
    expect(websiteConfig).toBeValidWebsiteConfig();
    expect(files).toHaveValidFileStructure();
  });
});
```

## Performance Considerations

### Mock Reuse

```typescript
// Good: Reuse setup
const standardMocks = () =>
  setupElectronAPI({
    'get-website-schema': { schema: TestData.websiteSchema() },
    'get-file-content': JSON.stringify(TestData.minimalWebsiteConfig()),
  });

// Use in multiple tests
beforeEach(() => {
  mockAPI = standardMocks();
});
```

### Builder Caching

```typescript
// Good: Cache commonly used builders
const standardConfig = new WebsiteConfigBuilder().minimal().build();

// Reuse across tests (immutable data)
it('test 1', () => {
  expect(standardConfig).toBeValidWebsiteConfig();
});
```

### Cleanup Best Practices

```typescript
afterEach(() => {
  MockFactory.resetAllMocks(); // Clears all utility-created mocks
  cleanupTestProviders(); // Clears React provider state
});
```

## Common Gotchas

### 1. Async Timing

```typescript
// Wrong: Not waiting for async operations
renderWithTestProviders(<MyComponent />);
expect(screen.getByText('Content')).toBeInTheDocument(); // May fail

// Right: Always wait for async content
await waitFor(() => {
  expect(screen.getByText('Content')).toBeInTheDocument();
});
```

### 2. Mock Pollution

```typescript
// Wrong: Mocks affect other tests
describe('Test Suite', () => {
  it('test 1', () => {
    setupElectronAPI({ channel: 'response1' });
  });

  it('test 2', () => {
    // Still sees response1 from previous test!
  });
});

// Right: Clean setup/teardown
beforeEach(() => {
  mockAPI = setupElectronAPI();
});

afterEach(() => {
  MockFactory.resetAllMocks();
});
```

### 3. Builder Mutation

```typescript
// Wrong: Mutating shared builders
const builder = new WebsiteConfigBuilder().minimal();
const config1 = builder.withTitle('Site 1').build();
const config2 = builder.withTitle('Site 2').build(); // config2.title overwrites config1.title!

// Right: Create new builders or use immutable builds
const config1 = new WebsiteConfigBuilder().minimal().withTitle('Site 1').build();
const config2 = new WebsiteConfigBuilder().minimal().withTitle('Site 2').build();
```

## Advanced Usage

### Custom Builders

```typescript
// Extend builders for domain-specific needs
class BlogWebsiteConfigBuilder extends WebsiteConfigBuilder {
  withBlogDefaults() {
    return this.withTitle('My Blog').withDescription('A personal blog').withRSLEnabled();
  }

  withAuthorBio(name: string, bio: string) {
    return this.withAuthor(name).withData({ authorBio: bio });
  }
}
```

### Custom Providers

```typescript
// Create specialized providers for specific components
export const BlogTestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <TestAppProvider
      contextOverrides={{
        state: { currentView: 'blog-editor' }
      }}
    >
      {children}
    </TestAppProvider>
  );
};
```

### Custom Assertions

```typescript
// Add project-specific assertions
expect.extend({
  toBeBlogPost(received) {
    const isBlogPost = received?.data?.tags?.includes('posts');
    return {
      pass: isBlogPost,
      message: () => `Expected ${received} to be a blog post`,
    };
  },
});
```

## Getting Help

### Common Issues

1. **"Custom matcher not found"**: Ensure `registerCustomMatchers()` is called in your test setup
2. **"Mock not working"**: Check that you're calling `MockFactory.resetAllMocks()` in `afterEach()`
3. **"Provider context undefined"**: Verify you're using `renderWithTestProviders()` instead of plain `render()`

### Best Practices Summary

- ✅ Use builders for all test data creation
- ✅ Use providers for all React component testing
- ✅ Use custom assertions for domain validation
- ✅ Clean up mocks in `afterEach()`
- ✅ Wait for async operations with `waitFor()`
- ❌ Don't create inline mock objects
- ❌ Don't hardcode test data
- ❌ Don't skip cleanup between tests

### Migration Checklist

- [ ] Replace manual ElectronAPI mocks with `setupElectronAPI()`
- [ ] Replace hardcoded test data with builders
- [ ] Replace custom React providers with utility providers
- [ ] Replace manual IPC testing with helper utilities
- [ ] Add custom assertions for domain validation
- [ ] Update test documentation and examples
- [ ] Add cleanup calls to existing test suites

This completes your test utilities guide! The utilities provide a solid foundation for maintainable, consistent testing across your entire codebase.
