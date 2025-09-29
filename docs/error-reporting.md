# Error Reporting System

The Anglesite error reporting system provides comprehensive error tracking, persistence, and analytics across all application processes.

## Overview

The error reporting system automatically captures and categorizes errors from:
- Main Electron process
- Renderer processes (UI)
- Worker threads
- IPC communication channels

All errors are centralized through the `ErrorReportingService` for consistent handling and analysis.

## Features

### Automatic Error Collection

Errors are automatically captured from:
- Uncaught exceptions
- Unhandled promise rejections
- IPC communication failures
- Service initialization errors
- Runtime validation errors

### Error Categorization

Each error is classified with:

**Severity Levels:**
- `CRITICAL` - System failures requiring immediate attention
- `HIGH` - Significant errors affecting core functionality
- `MEDIUM` - Recoverable errors with workarounds available
- `LOW` - Minor issues with minimal impact

**Categories:**
- `SYSTEM` - Operating system or platform errors
- `NETWORK` - Connection and communication failures
- `VALIDATION` - Data validation and input errors
- `PERMISSION` - Access control and authorization issues
- `CONFIGURATION` - Settings and configuration problems
- `UNKNOWN` - Uncategorized errors

### Persistence and Storage

The error reporting system maintains:
- Persistent error logs in the application data directory
- Session-based error buffering for offline scenarios
- Automatic cleanup of old error reports (configurable retention)
- Size-limited storage with automatic rotation

Default storage location:
- **macOS**: `~/Library/Application Support/anglesite/errors/`
- **Windows**: `%APPDATA%/anglesite/errors/`
- **Linux**: `~/.config/anglesite/errors/`

### Rate Limiting

To prevent error flooding:
- Configurable rate limits per error type
- Default: 100 errors per minute maximum
- Duplicate error detection and grouping
- Automatic throttling during error storms

## Configuration

Error reporting can be configured through the settings:

```json
{
  "errorReporting": {
    "enabled": true,
    "maxStorageSize": 52428800,      // 50MB default
    "maxErrorAge": 604800000,        // 7 days in milliseconds
    "rateLimitPerMinute": 100,
    "persistenceEnabled": true,
    "consoleLoggingEnabled": false   // Set to true for debugging
  }
}
```

## Privacy and Security

The error reporting system implements:
- Automatic sanitization of sensitive data (passwords, tokens, keys)
- PII (Personally Identifiable Information) removal
- Path anonymization for user directories
- No external transmission without explicit consent

### Sanitized Information

The following is automatically removed or masked:
- Authentication tokens and API keys
- Passwords and credentials
- Email addresses and usernames
- File paths containing user directories
- Environment variables with sensitive data

## Accessing Error Reports

### Via Application Menu

1. Navigate to **Help → View Error Logs**
2. Opens the error log directory in your file explorer

### Via Diagnostics Window

1. Open **Developer → Error Diagnostics**
2. View real-time error monitoring and analytics
3. Filter and search through error history

### Programmatic Access

Error reports are stored as JSON files with the format:
```
errors-YYYY-MM-DD.json
```

Each file contains an array of error reports with full stack traces and context.

## Error Recovery

The system provides automatic recovery for common scenarios:

### Service Failures
- Automatic retry with exponential backoff
- Fallback to degraded functionality
- User notification of service status

### Data Corruption
- Validation before persistence
- Automatic backup of critical data
- Recovery from last known good state

### Network Failures
- Offline error buffering
- Automatic synchronization when online
- Retry mechanisms for failed requests

## Integration with Development

### Development Mode

When running in development (`NODE_ENV=development`):
- Errors displayed in console with full stack traces
- Source maps automatically applied
- Additional debug information included
- No rate limiting applied

### Testing

Error reporting can be disabled for tests:
```bash
DISABLE_ERROR_REPORTING=true npm test
```

## Troubleshooting

### Common Issues

**Error reports not being saved:**
- Check disk space availability
- Verify write permissions to app data directory
- Ensure persistence is enabled in settings

**Too many error notifications:**
- Adjust rate limiting in settings
- Check for error loops in custom code
- Review error severity assignments

**Missing error context:**
- Ensure errors are thrown as `AngleError` instances
- Include relevant context when creating errors
- Check sanitization rules aren't too aggressive

### Manual Error Cleanup

To manually clear error logs:

1. Close the Anglesite application
2. Navigate to the error log directory
3. Delete old `errors-*.json` files
4. Restart the application

## Best Practices

### For Users

1. **Regular Review**: Check error logs periodically for patterns
2. **Report Critical Errors**: Share error reports when reporting bugs
3. **Configure Appropriately**: Adjust settings based on your workflow
4. **Monitor Disk Usage**: Error logs can grow over time

### For Developers

1. **Use AngleError**: Throw `AngleError` instances for better categorization
2. **Include Context**: Provide meaningful error messages and context
3. **Set Appropriate Severity**: Use severity levels consistently
4. **Handle Errors Gracefully**: Implement proper error boundaries
5. **Test Error Scenarios**: Include error cases in test suites

## Related Documentation

- [Error Diagnostics Window](./diagnostics-window.md)
- [System Notifications](./system-notifications.md)
- [Logging Configuration](./logging.md)
- [Developer Tools](./developer-tools.md)