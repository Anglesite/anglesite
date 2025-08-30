# Integration Testing Guide

This document explains the comprehensive integration testing system for the @dwk monorepo, covering cross-package interactions, end-to-end workflows, and API integrations.

## Overview

The integration testing system provides multiple levels of testing:

1. **Cross-Package Integration** - Tests interactions between monorepo packages
2. **End-to-End Workflows** - Tests complete user scenarios from start to finish
3. **API Integration** - Tests internal and external API communications
4. **Performance Integration** - Tests system performance under realistic conditions

## Test Structure

### Integration Test Configuration

- **Config File**: `jest.integration.config.js`
- **Setup File**: `tests/integration/setup.js`
- **Test Pattern**: `tests/integration/**/*.test.js` or `*.integration.test.js`
- **Timeout**: 30 seconds per test
- **Environment**: Node.js with custom utilities

### Test Categories

#### 1. Cross-Package Tests (`anglesite-11ty-integration.test.js`)

Tests the complete integration of the anglesite-11ty package:

- Package installation and configuration
- Eleventy build process with anglesite plugins
- Plugin system integration
- Schema validation
- Web standards file generation

#### 2. App Integration Tests (`anglesite-app-integration.test.js`)

Tests the Anglesite Electron application:

- Electron app startup and initialization
- Website server creation and management
- File watching and hot reload
- Cross-package API communication
- Error handling scenarios

#### 3. API Integration Tests (`api-integration.test.js`)

Tests various API integrations:

- Eleventy programmatic API usage
- HTTP/HTTPS server functionality
- File system operations and watching
- External API request handling
- Network resilience and timeout handling

## Running Integration Tests

### Local Development

```bash
# Run all integration tests
npm run test:integration

# Run specific integration test file
npx jest --config jest.integration.config.js tests/integration/anglesite-11ty-integration.test.js

# Run with verbose output
npx jest --config jest.integration.config.js --verbose

# Run with coverage
npx jest --config jest.integration.config.js --coverage
```

### CI/CD Environment

Integration tests run automatically:

- **On Pull Requests**: Basic integration validation
- **On Main Branch**: Comprehensive integration testing
- **Daily Schedule**: Full regression testing
- **Manual Trigger**: On-demand testing

## Test Utilities

The integration test system provides global utilities in `tests/integration/setup.js`:

### File System Utilities

```javascript
// Create temporary directory
const tmpDir = global.testUtils.createTempDir();

// Cleanup directory
global.testUtils.cleanupTempDir(tmpDir);

// Copy directory recursively
global.testUtils.copyDirectory(src, dest);
```

### Process Utilities

```javascript
// Run shell command
const output = global.testUtils.runCommand("npm install", cwd);

// Find available port
const port = await global.testUtils.findFreePort();

// Check if port is open
const isOpen = await global.testUtils.isPortOpen(port);
```

### Waiting Utilities

```javascript
// Wait for condition
await global.testUtils.waitFor(() => serverReady, 5000);

// Wait with custom interval
await global.testUtils.waitFor(() => condition(), 10000, 200);
```

## Test Scenarios

### Scenario 1: New Website Creation

Tests the complete flow of creating a new website:

1. Copy anglesite-starter template
2. Install anglesite-11ty dependency
3. Configure Eleventy with anglesite plugins
4. Build the website
5. Verify generated files and structure
6. Test development server
7. Validate web standards compliance

### Scenario 2: Plugin Integration

Tests all anglesite-11ty plugins working together:

1. Create comprehensive website configuration
2. Enable all plugin features
3. Build site with all plugins active
4. Verify each plugin's output files
5. Test plugin interdependencies
6. Validate generated content

### Scenario 3: Performance Testing

Tests system performance under realistic conditions:

1. Generate large website (50+ pages)
2. Measure build performance
3. Test memory usage patterns
4. Verify output quality at scale
5. Check performance thresholds

### Scenario 4: Error Resilience

Tests system behavior with various error conditions:

1. Malformed configuration files
2. Missing dependencies
3. Network timeouts
4. File system errors
5. Process failures

## Test Environment Setup

### Prerequisites

- Node.js 18.x or 20.x
- Virtual display for Electron testing (Linux CI)
- Test certificates for HTTPS testing
- Network access for external API tests

### Environment Variables

```bash
NODE_ENV=test-integration
CI=true
ELECTRON_DISABLE_SECURITY_WARNINGS=true
DISPLAY=:99  # Virtual display on Linux
```

### CI-Specific Setup

#### Ubuntu (Linux)

```bash
# Install Electron dependencies
sudo apt-get install xvfb libnss3-dev libatk-bridge2.0-dev

# Setup virtual display
Xvfb :99 -screen 0 1024x768x24 &
export DISPLAY=:99
```

#### Windows

- Uses native display for Electron testing
- No additional setup required

#### macOS

- Uses native display for Electron testing
- May require accessibility permissions in CI

## Coverage and Reporting

### Coverage Collection

Integration tests collect coverage from:

- `anglesite/app/**/*.{js,ts}`
- `anglesite-11ty/**/*.{js,ts}`
- Cross-package interaction points

### Coverage Thresholds

Lower thresholds than unit tests due to integration focus:

- Branches: 30%
- Functions: 35%
- Lines: 40%
- Statements: 40%

### Reporting Formats

- **Console**: Real-time test results
- **JUnit XML**: CI integration
- **HTML Report**: Detailed coverage analysis
- **SARIF**: Security finding integration

## Troubleshooting

### Common Issues

#### Electron App Won't Start

```bash
# Check display setup (Linux)
export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x24 &

# Disable GPU acceleration
export ELECTRON_EXTRA_ARGS="--no-sandbox --disable-gpu"
```

#### Port Conflicts

```javascript
// Use dynamic port allocation
const port = await global.testUtils.findFreePort();
```

#### File System Permissions

```bash
# Ensure temp directory is writable
chmod 755 tmp/
```

#### Network Timeouts

```javascript
// Increase timeout for slow networks
await global.testUtils.waitFor(condition, 30000);
```

### Debugging Integration Tests

#### Enable Verbose Logging

```bash
# Run with debug output
DEBUG=* npm run test:integration

# Jest verbose mode
npx jest --config jest.integration.config.js --verbose --no-cache
```

#### Check Test Artifacts

Integration tests generate artifacts in:

- `coverage/integration/` - Coverage reports
- `tmp/` - Temporary test files
- Process logs and outputs

#### Isolate Specific Tests

```bash
# Run single test file
npx jest tests/integration/anglesite-11ty-integration.test.js

# Run specific test case
npx jest --testNamePattern="should build a complete site"
```

## Best Practices

### Test Design

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up temporary resources
3. **Timeouts**: Use appropriate timeouts for operations
4. **Error Handling**: Test both success and failure scenarios
5. **Realistic Data**: Use realistic test data and scenarios

### Performance

1. **Parallel Execution**: Run independent tests in parallel
2. **Resource Management**: Properly cleanup processes and files
3. **Selective Running**: Use change detection to run relevant tests
4. **Caching**: Cache build artifacts when possible

### Maintenance

1. **Regular Updates**: Keep test data and scenarios current
2. **Dependency Management**: Update test dependencies regularly
3. **Documentation**: Document complex test scenarios
4. **Monitoring**: Monitor test performance and reliability

## Contributing

### Adding New Integration Tests

1. Create test file in `tests/integration/`
2. Use existing utilities from `setup.js`
3. Follow naming convention: `*.integration.test.js`
4. Include cleanup logic
5. Add appropriate timeouts
6. Document test scenarios

### Extending Test Utilities

1. Add new utilities to `tests/integration/setup.js`
2. Export utilities for reuse
3. Include error handling
4. Document utility functions
5. Test utility functions separately

### Updating CI Configuration

1. Modify `.github/workflows/integration-tests.yml`
2. Test changes on all platforms
3. Update environment setup as needed
4. Verify artifact collection
5. Check performance impact
