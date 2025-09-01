[**@dwk Monorepo API Documentation v0.1.0**](../../../README.md)

---

[@dwk Monorepo API Documentation](../../../README.md) / [ui/multi-window-manager](../README.md) / sendLogToWebsite

# Function: sendLogToWebsite()

> **sendLogToWebsite**(`websiteName`, `message`, `level`): `void`

Defined in: [ui/multi-window-manager.ts:58](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/ui/multi-window-manager.ts#L58)

Send log message to a website window's console

Transmits log messages from the main process to a specific website window's
renderer process. Used for debugging and development feedback.

## Parameters

### websiteName

`string`

Name of the website window to send log to

### message

`string`

Log message content

### level

`string` = `'info'`

Log level severity (default: 'info')

## Returns

`void`

## Example

```typescript
sendLogToWebsite("my-blog", "Build completed successfully", "info");
sendLogToWebsite("portfolio", "Warning: missing alt text", "warning");
```
