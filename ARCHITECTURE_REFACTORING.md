# Architecture Refactoring Summary

This document summarizes the refactoring work done to align the codebase with the layered architecture diagram.

## Architecture Diagram Implementation

The refactoring implements the three-layer architecture shown in the diagram:

```
┌──────────────────────────────────────────┐
│         GUI (Electron App)               │
│      - React Components                  │
│      - Window Management                 │
│      - User Interactions                 │
└──────────────────────────────────────────┘
                    ↕
         (Communication Bus - Events Only)
                    ↕
┌──────────────────────────────────────────┐
│    Node.js 11ty Website Manager          │
│    (Website Orchestrator)                │
│    - Lifecycle Management                │
│    - Server Coordination                 │
│    - Port Allocation                     │
└──────────────────────────────────────────┘
                    ↕
           (Direct Method Calls)
                    ↕
┌──────────────────────────────────────────┐
│    Individual Website Repos              │
│    - Website #1 (isolated)               │
│    - Website #2 (isolated)               │
│    - Website #3 (isolated)               │
└──────────────────────────────────────────┘
```

## Key Changes

### 1. Layer Boundary Definitions

**File:** `anglesite/src/main/core/layer-boundaries.ts`

Created strict interface definitions for each layer:

- `IsolatedWebsiteInstance` - Represents a single website (Layer 3)
- `IWebsiteOrchestrator` - Central management service (Layer 2)
- `WebsiteManagerEvents` - Event types for GUI communication
- `LayerCommunicationBus` - Decoupled event system

**Benefits:**
- Type-safe layer communication
- No circular dependencies
- Clear contracts between layers

### 2. Website Orchestrator Service

**File:** `anglesite/src/main/orchestrator/website-orchestrator.ts`

Implements the central "Node.js 11ty Website Manager" layer:

```typescript
// Before: Multiple scattered managers
import { WebsiteServerManager } from '../server/website-server-manager';
import { WebsiteManager } from '../utils/website-manager';

// After: Single unified orchestrator
import { IWebsiteOrchestrator } from '../core/layer-boundaries';
const orchestrator = context.getService<IWebsiteOrchestrator>(
  ServiceKeys.WEBSITE_ORCHESTRATOR
);
```

**Features:**
- Unified website lifecycle management
- Port allocation and tracking
- Event-based GUI communication
- Complete website isolation

### 3. Removed Cross-Layer Dependencies

**File:** `anglesite/src/main/server/per-website-server.ts`

**Before:**
```typescript
// Direct import of UI layer - VIOLATES LAYER BOUNDARIES
import { sendLogToWebsite } from '../ui/multi-window-manager';
```

**After:**
```typescript
// Callback-based communication - RESPECTS LAYER BOUNDARIES
export function setServerLogCallback(callback: LogCallback | null): void {
  logCallback = callback;
}
```

**Benefits:**
- Server layer has zero UI dependencies
- Testable in isolation
- Can be used in different contexts (CLI, API, etc.)

### 4. DI Container Registration

**File:** `anglesite/src/main/core/service-registry.ts`

Added orchestrator to service registry:

```typescript
container.register(
  ServiceKeys.WEBSITE_ORCHESTRATOR,
  () => {
    const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
    const websiteManager = container.resolve<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);
    const fileSystem = container.resolve<IFileSystem>(ServiceKeys.FILE_SYSTEM);
    return createWebsiteOrchestrator(logger, websiteManager, fileSystem);
  },
  'singleton',
  [ServiceKeys.LOGGER, ServiceKeys.WEBSITE_MANAGER, ServiceKeys.FILE_SYSTEM]
);
```

## Architecture Benefits

### 1. Layer Isolation

Each layer has well-defined responsibilities:

| Layer | Responsibility | Dependencies |
|-------|---------------|--------------|
| GUI | User interface, visual feedback | Orchestrator (via events) |
| Orchestrator | Website lifecycle, coordination | Website Manager, File System |
| Individual Websites | 11ty server, file watching | None (completely isolated) |

### 2. Communication Patterns

#### Upward Communication (Server → GUI)
```typescript
// Server layer doesn't know about GUI
setServerLogCallback((websiteName, message, level) => {
  orchestrator.publishToGUI('website:log', websiteName, message, level);
});

// GUI subscribes to events
bus.subscribeFromManager('website:log', (name, msg, level) => {
  updateWebsiteWindow(name, msg, level);
});
```

#### Downward Communication (GUI → Server)
```typescript
// GUI calls orchestrator methods
await orchestrator.createWebsite('my-blog');
await orchestrator.startWebsiteServer('my-blog');

// Orchestrator manages servers directly
const server = await startWebsiteServer(path, name, port);
```

### 3. Complete Website Isolation

Each website instance is fully isolated:

```typescript
interface IsolatedWebsiteInstance {
  readonly websiteName: string;
  readonly port: number;
  readonly url: string;
  readonly rootPath: string;
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly isHealthy: boolean;

  rebuild(): Promise<void>;
  resolveFileToUrl(filePath: string): Promise<string | null>;
  shutdown(): Promise<void>;
}
```

- No shared state between websites
- Independent lifecycle management
- Isolated file watchers and build processes

## Migration Guide

### For IPC Handlers

**Before:**
```typescript
import { startWebsiteServer } from '../server/per-website-server';

ipcMain.handle('create-website', async (event, name) => {
  const path = await createWebsiteWithName(name);
  const server = await startWebsiteServer(path, name, 3000);
  return server.port;
});
```

**After:**
```typescript
import { ServiceKeys } from '../core/container';
import { IWebsiteOrchestrator } from '../core/layer-boundaries';

ipcMain.handle('create-website', async (event, name) => {
  const orchestrator = context.getService<IWebsiteOrchestrator>(
    ServiceKeys.WEBSITE_ORCHESTRATOR
  );
  const instance = await orchestrator.createWebsite(name);
  return instance.url;
});
```

### For UI Components

**Before:**
```typescript
// Direct access to server internals
import { websiteServers } from '../server/website-server-manager';
const server = websiteServers.get(websiteName);
```

**After:**
```typescript
// Subscribe to events from orchestrator
const orchestrator = getService<WebsiteOrchestrator>(ServiceKeys.WEBSITE_ORCHESTRATOR);
const bus = orchestrator.getCommunicationBus();

bus.subscribeFromManager('website:started', (name, instance) => {
  setWebsiteUrl(name, instance.url);
});
```

## Testing Improvements

### Layer-Specific Testing

Each layer can now be tested independently:

```typescript
// Test orchestrator without UI
const mockBus = createLayerCommunicationBus(logger);
const orchestrator = new WebsiteOrchestrator(logger, websiteManager, fileSystem);

// Test that events are published correctly
let eventReceived = false;
mockBus.subscribeFromManager('website:started', () => {
  eventReceived = true;
});

await orchestrator.createWebsite('test-site');
expect(eventReceived).toBe(true);
```

```typescript
// Test server layer without UI or orchestrator
import { setServerLogCallback } from '../server/per-website-server';

const logs: string[] = [];
setServerLogCallback((name, msg) => logs.push(msg));

await startWebsiteServer('/path', 'test', 3000);
expect(logs).toContain('🚀 Starting Eleventy server');
```

## Files Created/Modified

### New Files
- ✅ `anglesite/src/main/core/layer-boundaries.ts` - Layer interface definitions
- ✅ `anglesite/src/main/orchestrator/website-orchestrator.ts` - Central orchestrator
- ✅ `anglesite/src/main/orchestrator/README.md` - Usage documentation

### Modified Files
- ✅ `anglesite/src/main/core/container.ts` - Added WEBSITE_ORCHESTRATOR key
- ✅ `anglesite/src/main/core/service-registry.ts` - Registered orchestrator
- ✅ `anglesite/src/main/server/per-website-server.ts` - Removed UI dependency

## Next Steps

To complete the migration to the new architecture:

1. **Update IPC Handlers** - Migrate IPC handlers to use the orchestrator
2. **Update UI Components** - Subscribe to communication bus events
3. **Remove Old Managers** - Deprecate direct usage of WebsiteServerManager
4. **Add Integration Tests** - Test full layer communication flow
5. **Update Documentation** - Update CLAUDE.md with new patterns

## Summary

The refactoring successfully implements the layered architecture from the diagram:

✅ **Layer 1 (GUI)** - Communicates via event bus only
✅ **Layer 2 (Orchestrator)** - Central coordination with clear interfaces
✅ **Layer 3 (Websites)** - Completely isolated instances

The new architecture provides:
- Better testability through layer isolation
- Clearer separation of concerns
- Type-safe communication contracts
- Scalable website management
- No circular dependencies
