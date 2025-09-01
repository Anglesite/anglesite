# Multi-Window Architecture

ABOUTME: Technical documentation for Anglesite's sophisticated multi-window system architecture  
ABOUTME: Covers window types, communication patterns, security considerations, and development guidelines

## Overview

Anglesite uses a sophisticated multi-window architecture that allows users to work on multiple website projects simultaneously. Each website opens in its own dedicated window with isolated context and resources.

## Architecture Components

### Window Types

1. **Main Window** - Application hub and website manager
2. **Website Editor Windows** - Dedicated windows for each website project
3. **Help Window** - Documentation and assistance

### Key Classes

#### MultiWindowManager (`anglesite/app/ui/multi-window-manager.ts`)

Manages the lifecycle of multiple Electron windows, tracking window state and preventing duplicate windows for the same website.

Key responsibilities:

- Window creation and lifecycle management
- Window state tracking (position, size, focus)
- Prevention of duplicate windows
- Context-aware menu management

#### WindowManager (`anglesite/app/ui/window-manager.ts`)

Handles WebContentsView integration for secure preview rendering within windows.

Key features:

- CSP-compliant preview integration
- Secure sandboxing of website content
- DevTools integration
- View state management

## Window Communication

### IPC Channels

Windows communicate through Electron's IPC (Inter-Process Communication) system:

- `website:open` - Open a website in a new window
- `website:close` - Close a website window
- `website:save` - Save website changes
- `website:build` - Build static files
- `window:focus` - Window focus management

### State Management

Each window maintains its own state while sharing global application state through:

- Electron's session storage
- IPC message passing
- Shared file system access

## Security Considerations

1. **Process Isolation** - Each window runs in an isolated process
2. **Context Isolation** - Renderer processes are isolated from Node.js
3. **CSP Enforcement** - Strict Content Security Policy without unsafe-inline
4. **Sandboxed Previews** - Website previews run in sandboxed WebContentsView

## Performance Optimizations

1. **Lazy Window Creation** - Windows created on-demand
2. **Window Pooling** - Reuse closed windows when possible
3. **Smart Focus Management** - Efficient window switching
4. **Memory Management** - Automatic cleanup of closed windows

## Development Guidelines

### Creating New Window Types

```typescript
// Example: Adding a new window type
class SettingsWindow extends BaseWindow {
  constructor() {
    super({
      width: 600,
      height: 400,
      title: "Settings",
    });
  }

  // Window-specific logic here
}
```

### Window Event Handling

```typescript
// Listen for window events
window.on("focus", () => {
  // Update menu bar for this window context
  updateMenuForWindow(window);
});
```

## Testing Windows

Multi-window functionality is tested through:

- Unit tests with Electron mocks
- Integration tests for IPC communication
- Manual testing for window management scenarios

See `anglesite/test/ui/multi-window-manager.test.ts` for examples.

## Future Enhancements

- Window synchronization for collaborative editing
- Floating tool windows
- Window grouping and tabbed interfaces
- Cross-window drag and drop support
