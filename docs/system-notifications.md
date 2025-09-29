# System Notifications

Anglesite provides native operating system notifications for critical errors and important events, ensuring you're immediately aware of issues that require attention.

## Overview

System notifications integrate with your operating system's native notification system:
- **macOS**: Notification Center
- **Windows**: Action Center / System Tray
- **Linux**: Desktop notifications (via libnotify)

## Notification Types

### Critical Error Notifications

Triggered automatically for:
- Application crashes or fatal errors
- Service initialization failures
- Data corruption detection
- Security violations
- Unrecoverable system errors

**Example:**
```
🚨 Anglesite - Critical Error
Website build process crashed unexpectedly
Click to view details in Error Diagnostics
```

### High Priority Notifications

Shown for significant issues:
- Database connection failures
- Network service disruptions
- Configuration errors
- Resource exhaustion warnings
- Permission denied errors

**Example:**
```
⚠️ Anglesite - High Priority Issue
Unable to start development server on port 3000
Port may be in use by another process
```

### Informational Notifications

Optional notifications for:
- Build completions
- Export success/failure
- Update availability
- Background task completion

## Configuration

### Accessing Notification Settings

1. **Via Preferences**: File → Preferences → Notifications
2. **Via Settings**: Settings → Error Handling → System Notifications
3. **Via Diagnostics Window**: Click the notification bell icon

### Notification Preferences

```json
{
  "systemNotifications": {
    "enableCriticalNotifications": true,
    "enableHighNotifications": true,
    "enableMediumNotifications": false,
    "enableLowNotifications": false,
    "notificationDuration": 5000,        // milliseconds (0 = persistent)
    "enableSound": true,
    "soundVolume": 0.5,                  // 0.0 to 1.0
    "enableBadgeCount": true,            // macOS dock badge
    "maxConcurrentNotifications": 3,      // prevent notification spam
    "quietHours": {
      "enabled": false,
      "start": "22:00",
      "end": "08:00"
    }
  }
}
```

### Per-Category Settings

Configure notifications for specific error categories:

| Category | Default | Description |
|----------|---------|-------------|
| System Errors | Enabled | OS-level and platform errors |
| Network Errors | Enabled | Connection and API failures |
| Build Errors | Enabled | Compilation and build process issues |
| Validation Errors | Disabled | Input and data validation issues |
| Performance Warnings | Disabled | Memory and CPU warnings |

## Notification Features

### Click Actions

Clicking on a notification will:
1. Bring Anglesite to the foreground
2. Open the Error Diagnostics window
3. Navigate to the specific error
4. Highlight the error details

### Notification Grouping

Multiple related errors are grouped:
- Same error type within 30 seconds
- Similar error messages are stacked
- Group count shown in notification
- Expandable on supported platforms

**Example:**
```
⚠️ Anglesite - 3 Build Errors
Multiple TypeScript compilation errors detected
Click to view all in diagnostics
```

### Badge Count (macOS)

The dock icon shows:
- Red badge with count of unread critical errors
- Updates in real-time
- Clears when diagnostics window is opened
- Can be disabled in preferences

### Sound Alerts

Configurable audio notifications:
- Different sounds for severity levels
- Volume control
- Mute during presentations
- Custom sound file support

## Platform-Specific Features

### macOS

- **Notification Center Integration**: Full history in Notification Center
- **Focus/Do Not Disturb**: Respects system DND settings
- **Actions**: Quick actions from notification (View, Dismiss, Mute)
- **Dock Bouncing**: Optional attention request for critical errors

### Windows

- **Action Center**: Persists in Windows Action Center
- **Toast Notifications**: Modern Windows 10/11 toast style
- **Taskbar Flashing**: Optional taskbar highlight
- **System Tray**: Fallback for older Windows versions

### Linux

- **Desktop Environment Support**: GNOME, KDE, XFCE, etc.
- **libnotify Integration**: Standard desktop notifications
- **Urgency Levels**: Maps severity to system urgency
- **Icon Themes**: Respects system icon theme

## Quiet Hours and Focus Mode

### Quiet Hours

Configure periods when notifications are suppressed:
1. Set start and end times in 24-hour format
2. Override for critical errors only
3. Queue non-critical for later delivery
4. Visual indicator when quiet hours active

### Focus Mode

Temporary notification suppression:
- **Toggle**: Click notification icon in status bar
- **Duration**: 1 hour, 2 hours, until restart
- **Override**: Hold Shift while toggling for critical-only mode
- **Auto-Enable**: Based on calendar events or screen sharing

## Notification History

### Viewing Past Notifications

Access notification history through:
1. **Diagnostics Window**: Notifications tab
2. **System Notification Center**: OS-specific
3. **Log Files**: Persistent notification log

### History Features

- Timestamps for all notifications
- Filter by date range
- Search notification text
- Export notification history
- Clear history selectively

## Managing Notification Overload

### Rate Limiting

Prevents notification spam:
- Maximum 3 notifications per 10 seconds
- Automatic grouping of similar errors
- Escalation for critical errors only
- Summary notification for multiple errors

### Smart Filtering

Intelligent notification suppression:
- Duplicate detection within time window
- Pattern matching for similar errors
- Severity-based throttling
- Context-aware filtering

### Notification Rules

Create custom rules:
```json
{
  "notificationRules": [
    {
      "pattern": "EADDRINUSE",
      "action": "suppress",
      "duration": 300000  // Suppress port-in-use errors for 5 minutes
    },
    {
      "pattern": "Memory warning",
      "action": "throttle",
      "maxPerHour": 2
    }
  ]
}
```

## Accessibility

### Screen Reader Support

- Full notification text available to screen readers
- Severity level announced
- Keyboard navigation to notification actions
- Alternative text for notification icons

### Visual Preferences

- High contrast mode support
- Larger notification text option
- Extended display duration
- Flash screen option instead of sound

## Troubleshooting

### Notifications Not Appearing

1. **Check System Permissions**:
   - macOS: System Preferences → Notifications → Anglesite
   - Windows: Settings → System → Notifications → Anglesite
   - Linux: Check notification daemon is running

2. **Verify Application Settings**:
   - Ensure notifications are enabled
   - Check quiet hours settings
   - Verify focus mode is not active

3. **Test Notifications**:
   - Developer → Test System Notification
   - Should show test notification immediately

### Too Many Notifications

1. **Adjust Severity Filters**: Disable lower severity levels
2. **Enable Rate Limiting**: Increase throttle values
3. **Use Quiet Hours**: Set appropriate quiet periods
4. **Create Exclusion Rules**: Filter known non-critical errors

### Notification Click Not Working

1. **Check Window State**: Ensure app isn't minimized
2. **Verify Permissions**: Check app has window focus permission
3. **Restart Application**: Clear any stuck notification handlers
4. **Check Logs**: Review notification action logs

## Best Practices

### For Users

1. **Configure Appropriately**: Set notification levels based on your role
2. **Use Quiet Hours**: Prevent interruptions during focused work
3. **Review Regularly**: Don't ignore persistent notifications
4. **Clear Resolved**: Dismiss notifications for fixed issues

### For Teams

1. **Standardize Settings**: Share notification profiles
2. **Define Severity**: Agree on what constitutes each level
3. **Document Patterns**: Note which errors should notify
4. **Monitor Fatigue**: Watch for notification overload

## Integration with Other Features

### Error Diagnostics Window

- Notifications link directly to diagnostics
- Synchronized error counts
- Shared filtering rules
- Combined notification history

### Error Reporting

- Notifications trigger error reports
- Automatic context capture
- Report generation from notification
- Bulk reporting for grouped errors

### Logging System

- All notifications are logged
- Correlation with error logs
- Audit trail for critical notifications
- Performance metrics for notification system

## Command Line Options

Control notifications via CLI:

```bash
# Disable all notifications
anglesite --no-notifications

# Critical only mode
anglesite --critical-notifications-only

# Test notification system
anglesite --test-notification

# Clear notification cache
anglesite --clear-notifications
```

## Related Documentation

- [Error Reporting System](./error-reporting.md)
- [Error Diagnostics Window](./diagnostics-window.md)
- [Settings and Preferences](./settings.md)
- [Accessibility Features](./accessibility.md)