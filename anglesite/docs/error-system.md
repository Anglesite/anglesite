# Anglesite Structured Error Handling System

## Overview

This document describes the structured error handling system implemented for Anglesite. The system provides a hierarchical approach to error management with domain-specific error types, comprehensive logging, and recovery strategies.

## Architecture

### Core Components

1. **Base Error Classes** (`app/core/errors/base.ts`)
   - `AngleError`: Base class for all Anglesite errors
   - Category-specific base classes (SystemError, NetworkError, etc.)
   - Error metadata and serialization support

2. **Domain-Specific Errors** (`app/core/errors/domain.ts`)
   - Website management errors
   - Server operation errors
   - DNS and certificate errors
   - File system and atomic operation errors

3. **Error Utilities** (`app/core/errors/utilities.ts`)
   - Error handling registry
   - Context management
   - Retry and recovery mechanisms
   - Breadcrumb tracking

## Error Hierarchy

```
AngleError (base)
├── SystemError
│   ├── ServerError
│   ├── CertificateError
│   └── WindowError
├── NetworkError
│   └── DnsError
├── FileSystemError
│   ├── FileNotFoundError
│   ├── DirectoryNotFoundError
│   ├── PermissionDeniedError
│   └── DiskSpaceError
├── ValidationError
│   ├── RequiredFieldError
│   ├── InvalidFormatError
│   └── ValueOutOfRangeError
├── ConfigurationError
├── BusinessLogicError
│   ├── WebsiteError
│   ├── TemplateError
│   └── AtomicOperationError
└── ExternalServiceError
```

## Error Categories

- `SYSTEM`: Infrastructure, OS, hardware issues
- `NETWORK`: Connectivity, timeouts, DNS problems
- `FILE_SYSTEM`: File operations, permissions, disk space
- `VALIDATION`: Input validation, data format issues
- `AUTHENTICATION`: User authentication problems
- `AUTHORIZATION`: Permission and access control
- `CONFIGURATION`: Invalid or missing configuration
- `BUSINESS_LOGIC`: Domain-specific business rule violations
- `EXTERNAL_SERVICE`: Third-party service integration issues
- `USER_INPUT`: User-provided data issues

## Error Severity Levels

- `LOW`: Minor issues that don't affect core functionality
- `MEDIUM`: Significant issues that may impact user experience
- `HIGH`: Serious issues requiring immediate attention
- `CRITICAL`: System-threatening issues requiring emergency response

## Usage Examples

### Basic Error Creation

```typescript
import { WebsiteNotFoundError, ErrorSeverity } from './core/errors';

// Specific domain error
throw new WebsiteNotFoundError('website-123', {
  operation: 'loadWebsite',
  context: { userId: 'user-456' },
});

// Generic error with custom metadata
throw new AngleError('Custom error message', 'CUSTOM_ERROR_CODE', ErrorCategory.BUSINESS_LOGIC, ErrorSeverity.MEDIUM, {
  customData: 'value',
});
```

### Error Handling with Context

```typescript
import { withContext, handleError } from './core/errors';

async function processWebsite(websiteId: string) {
  return await withContext(
    {
      operation: 'processWebsite',
      website: { id: websiteId },
      user: { id: getCurrentUserId() },
    },
    async () => {
      // Operation that might throw errors
      // Context will be automatically added to any errors thrown
      return await performWebsiteOperation(websiteId);
    }
  );
}
```

### Error Recovery and Retries

```typescript
import { withRetry, withErrorHandling } from './core/errors';

// Automatic retries for network operations
const result = await withRetry(
  () => fetchWebsiteData(url),
  3, // max retries
  1000, // delay between retries
  { operation: 'fetchWebsiteData', url }
);

// Error handling with recovery strategy
const data = await withErrorHandling(
  () => loadCriticalData(),
  (error) => {
    console.warn('Using cached data due to error:', error.message);
    return getCachedData();
  }
);
```

### Method Decorators

```typescript
import { HandleErrors } from './core/errors';

class WebsiteService {
  @HandleErrors(async (error) => {
    // Recovery strategy
    console.warn('Failed to load websites:', error.message);
    return [];
  })
  async getWebsites(): Promise<Website[]> {
    // This method will automatically handle errors
    // and apply the recovery strategy if an error occurs
    return await this.fetchWebsitesFromDatabase();
  }
}
```

### Error Handlers

```typescript
import { registerErrorHandler, ErrorSeverity } from './core/errors';

// Global critical error handler
registerErrorHandler('*', async (error) => {
  if (error.severity === ErrorSeverity.CRITICAL) {
    await sendAlertToOperations(error);
  }
});

// Specific error type handler
registerErrorHandler('WebsiteNotFoundError', async (error) => {
  await logWebsiteAccessAttempt(error.websiteId);
});
```

## Error Reporting and Analytics

### Error Statistics

```typescript
import { ErrorUtils } from './core/errors';

const errors = getRecentErrors();
const stats = ErrorUtils.getStatistics(errors);

console.log(`Total errors: ${stats.total}`);
console.log(`Recoverable: ${stats.recoverable}`);
console.log(`Critical: ${stats.bySeverity.CRITICAL}`);
console.log(`File system errors: ${stats.byCategory.FILE_SYSTEM}`);
```

### Error Analysis

```typescript
import { ErrorAnalyzer } from './core/errors/examples';

const errors = getSystemErrors();
const analysis = ErrorAnalyzer.analyzeErrors(errors);
const report = ErrorAnalyzer.generateErrorReport(errors);

console.log(analysis.summary);
analysis.recommendations.forEach((rec) => console.log(rec));
```

## Best Practices

### 1. Use Specific Error Types

```typescript
// Good
throw new WebsiteNotFoundError(websiteId);

// Better
throw new WebsiteNotFoundError(websiteId, {
  operation: 'loadWebsite',
  context: { userId: currentUser.id },
});

// Avoid
throw new Error('Website not found');
```

### 2. Provide Context

```typescript
// Good
throw new AtomicWriteError(filePath, 'Disk full', {
  operation: 'saveWebsiteConfig',
  diskSpace: await getDiskSpace(),
  fileSize: content.length,
});
```

### 3. Use Error Recovery

```typescript
// Good - handles errors gracefully
const websites = await withErrorHandling(
  () => loadWebsites(),
  () => loadCachedWebsites()
);

// Better - with context
const websites = await withContext({ operation: 'loadWebsites', userId }, () =>
  withErrorHandling(
    () => loadWebsites(),
    () => loadCachedWebsites()
  )
);
```

### 4. Log Errors Appropriately

```typescript
// The error system automatically handles logging
// Just focus on providing good context
throw new ServerStartError(port, 'Port already in use', {
  operation: 'startDevServer',
  website: { id: websiteId },
  previousAttempts: retryCount,
});
```

## Migration Guide

### Updating Existing Code

1. **Replace Generic Errors**

   ```typescript
   // Before
   throw new Error('Website not found');

   // After
   throw new WebsiteNotFoundError(websiteId);
   ```

2. **Add Error Context**

   ```typescript
   // Before
   try {
     await operation();
   } catch (error) {
     console.error('Operation failed:', error);
     throw error;
   }

   // After
   try {
     await operation();
   } catch (error) {
     const wrappedError = ErrorUtils.wrap(error, {
       operation: 'operationName',
       context: { relevant: 'data' },
     });
     await handleError(wrappedError);
     throw wrappedError;
   }
   ```

3. **Use Error Recovery**

   ```typescript
   // Before
   let data;
   try {
     data = await loadData();
   } catch (error) {
     data = getDefaultData();
   }

   // After
   const data = await withErrorHandling(
     () => loadData(),
     () => getDefaultData()
   );
   ```

## Testing Error Scenarios

```typescript
import { ErrorTestingUtils } from './core/errors/examples';

// Run comprehensive error handling tests
await ErrorTestingUtils.testErrorHandling();
```

## Configuration

```typescript
import { configureErrorReporting } from './core/errors';

configureErrorReporting({
  enabled: true,
  endpoint: 'https://errors.anglesite.app',
  environment: process.env.NODE_ENV,
  includeStackTrace: true,
  includeBreadcrumbs: true,
});
```

## Integration Points

The error system integrates with:

- **Service Registry**: Enhanced error handling in DI container
- **Atomic Operations**: Structured errors for file operations
- **Website Manager**: Domain-specific website errors
- **Server Manager**: Server operation errors
- **Certificate Manager**: SSL/TLS certificate errors
- **DNS Manager**: DNS resolution and hosts file errors

This error system provides a robust foundation for error handling throughout Anglesite, making debugging easier and providing better user experiences through graceful error recovery.
