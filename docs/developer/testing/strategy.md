# Testing Strategy

ABOUTME: Comprehensive testing strategy and guidelines for the Anglesite project with 90% coverage requirement
ABOUTME: Covers unit, integration, e2e, and performance testing with TDD practices and tool configuration

## Overview

Anglesite follows a comprehensive testing strategy with a **90% code coverage requirement**. We use Jest as our testing framework and follow Test-Driven Development (TDD) principles.

## Coverage Requirements

### Minimum Coverage: 90%

All code must maintain at least 90% test coverage across:

- Statements
- Branches
- Functions
- Lines

### Current Coverage Status

Run `npm test -- --coverage` to see current coverage. Coverage reports are generated in `/coverage/`.

## Test Types

### 1. Unit Tests

**Purpose**: Test individual functions and components in isolation

**Location**: Adjacent to source files or in `__tests__` directories

**Naming**: `*.test.ts` or `*.test.tsx`

**Example**:

```typescript
// app/certificates.test.ts
import { generateCertificate, verifyCertificate } from "./certificates";

describe("Certificate Management", () => {
  test("generates valid SSL certificate", async () => {
    const cert = await generateCertificate("test.local");
    expect(cert).toHaveProperty("key");
    expect(cert).toHaveProperty("cert");
  });
});
```

### 2. Integration Tests

**Purpose**: Test interactions between multiple components

**Location**: `/test/integration/`

**Focus Areas**:

- IPC communication between processes
- Server and client interactions
- File system operations
- Multi-window coordination

**Example**:

```typescript
// test/integration/website-creation.test.ts
test("creates website with all components", async () => {
  const websiteName = "test-site";

  // Test website creation
  await createWebsite(websiteName);

  // Verify all components
  expect(await websiteExists(websiteName)).toBe(true);
  expect(await serverIsRunning(websiteName)).toBe(true);
  expect(await certificateIsValid(websiteName)).toBe(true);
});
```

### 3. End-to-End Tests

**Purpose**: Test complete user workflows

**Location**: `/test/e2e/`

**Tools**: Spectron/Playwright for Electron testing

**Focus**:

- User interface interactions
- Complete feature workflows
- Cross-platform compatibility

### 4. Performance Tests

**Purpose**: Ensure performance benchmarks are met

**Location**: `/test/performance/`

**Metrics**:

- Bundle size limits
- Build time thresholds
- Memory usage caps
- Response time requirements

## Test Patterns

### Mocking Electron

```typescript
// Mock Electron modules
jest.mock("electron", () => ({
  app: {
    getPath: jest.fn(() => "/mock/path"),
    quit: jest.fn(),
  },
  BrowserWindow: jest.fn(() => ({
    loadURL: jest.fn(),
    on: jest.fn(),
  })),
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
}));
```

### Testing React Components

```typescript
import { render, fireEvent, screen } from '@testing-library/react';
import { FluentButton } from './FluentButton';

test('button triggers onClick handler', () => {
  const handleClick = jest.fn();

  render(<FluentButton onClick={handleClick}>Click Me</FluentButton>);

  fireEvent.click(screen.getByText('Click Me'));

  expect(handleClick).toHaveBeenCalledTimes(1);
});
```

### Testing Async Operations

```typescript
test("async file operations", async () => {
  const content = await readFile("test.txt");

  expect(content).toBe("expected content");

  // Or using promises
  return expect(readFile("test.txt")).resolves.toBe("expected content");
});
```

### Testing IPC Handlers

```typescript
test("IPC handler responds correctly", async () => {
  const mockEvent = { sender: { send: jest.fn() } };
  const result = await handleIPCMessage(mockEvent, "test-message", {
    data: "test",
  });

  expect(result).toEqual({ success: true });
  expect(mockEvent.sender.send).toHaveBeenCalledWith("response", {
    success: true,
  });
});
```

## Test Organization

### File Structure

```
anglesite/
├── app/
│   ├── certificates.ts
│   ├── certificates.test.ts      # Unit test
│   └── __tests__/
│       └── certificates.integration.test.ts
├── test/
│   ├── unit/                     # Additional unit tests
│   ├── integration/               # Integration tests
│   ├── e2e/                      # End-to-end tests
│   └── performance/              # Performance tests
└── coverage/                      # Coverage reports
```

### Test Naming Conventions

- **Descriptive names**: Test names should clearly describe what is being tested
- **Given-When-Then**: Structure complex tests with clear scenarios
- **Group related tests**: Use `describe` blocks for logical grouping

```typescript
describe("WebsiteManager", () => {
  describe("when creating a new website", () => {
    test("should create directory structure", () => {});
    test("should initialize configuration", () => {});
    test("should setup SSL certificates", () => {});
  });

  describe("when deleting a website", () => {
    test("should remove all files", () => {});
    test("should cleanup hosts entries", () => {});
  });
});
```

## Running Tests

### All Tests

```bash
npm test
```

### With Coverage

```bash
npm test -- --coverage
```

### Watch Mode

```bash
npm test -- --watch
```

### Specific File

```bash
npm test -- certificates.test.ts
```

### Integration Tests Only

```bash
npm test -- test/integration
```

### Debug Mode

```bash
node --inspect-brk ./node_modules/.bin/jest --runInBand
```

## Test Configuration

### Jest Configuration (`jest.config.js`)

```javascript
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "!app/**/*.d.ts",
    "!app/**/index.ts",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/app/$1",
  },
};
```

## Best Practices

### 1. Write Tests First (TDD)

- Write failing tests before implementation
- Only write enough code to pass tests
- Refactor while keeping tests green

### 2. Keep Tests Independent

- Each test should be able to run in isolation
- Use `beforeEach` and `afterEach` for setup/cleanup
- Avoid shared state between tests

### 3. Mock External Dependencies

- Mock file system operations
- Mock network requests
- Mock Electron APIs
- Mock time-dependent operations

### 4. Test Edge Cases

- Null/undefined inputs
- Empty arrays/objects
- Network failures
- File system errors
- Race conditions

### 5. Maintain Test Quality

- Refactor tests along with code
- Remove obsolete tests
- Keep tests simple and readable
- Document complex test scenarios

## Common Testing Scenarios

### Testing File Operations

```typescript
jest.mock("fs/promises");

test("reads configuration file", async () => {
  const mockFs = require("fs/promises");
  mockFs.readFile.mockResolvedValue('{"key": "value"}');

  const config = await loadConfig();

  expect(config).toEqual({ key: "value" });
  expect(mockFs.readFile).toHaveBeenCalledWith("config.json", "utf-8");
});
```

### Testing Error Handling

```typescript
test("handles missing file gracefully", async () => {
  const mockFs = require("fs/promises");
  mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

  const config = await loadConfig();

  expect(config).toEqual({}); // Returns default
  expect(console.warn).toHaveBeenCalledWith("Config file not found");
});
```

### Testing Time-Dependent Code

```typescript
jest.useFakeTimers();

test("debounces function calls", () => {
  const callback = jest.fn();
  const debounced = debounce(callback, 1000);

  debounced();
  debounced();
  debounced();

  expect(callback).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1000);

  expect(callback).toHaveBeenCalledTimes(1);
});
```

## Continuous Integration

Tests run automatically on:

- Pull requests
- Push to main branch
- Pre-commit hooks

### CI Requirements

- All tests must pass
- Coverage must meet 90% threshold
- No linting errors
- No TypeScript errors

## Troubleshooting

### Common Issues

1. **Mock not working**: Ensure mock is before import
2. **Async test timeout**: Increase timeout or check for hanging promises
3. **Coverage gaps**: Use coverage report to identify untested branches
4. **Flaky tests**: Look for timing issues or shared state

### Debug Tips

- Use `console.log` for quick debugging
- Use `debugger` statement with `--inspect-brk`
- Run single test file for faster iteration
- Check test order dependencies with `--runInBand`

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library](https://testing-library.com/)
- [Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/testing)
- [TDD Best Practices](https://testdriven.io/)
