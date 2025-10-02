# Website Orchestrator Layer

This directory implements **Layer 2** from the Anglesite architecture diagram: the central Node.js 11ty Website Manager.

## Architecture Layers

```
┌─────────────────────────────────────┐
│   Layer 1: GUI (Electron App)      │  ← React UI, Window Management
│   - UI Components                   │
│   - Window Manager                  │
│   - User Interactions               │
└─────────────────────────────────────┘
                 ↕ (Events via Communication Bus)
┌─────────────────────────────────────┐
│   Layer 2: Website Orchestrator     │  ← This directory
│   - Website Lifecycle Management    │
│   - Server Instance Coordination    │
│   - Port Allocation                 │
│   - Event Publishing                │
└─────────────────────────────────────┘
                 ↕ (Direct method calls)
┌─────────────────────────────────────┐
│   Layer 3: Individual Websites      │  ← Isolated 11ty instances
│   - Website #1 (port 3000)          │
│   - Website #2 (port 3001)          │
│   - Website #3 (port 3002)          │
│   - ...                             │
└─────────────────────────────────────┘
```

## Key Design Principles

### 1. Strict Layer Boundaries

- **GUI Layer** can only communicate with **Orchestrator Layer** via the Communication Bus
- **Orchestrator Layer** directly manages **Individual Websites**
- **Individual Websites** are completely isolated and cannot communicate with each other or the GUI

### 2. One-Way Dependencies

```
GUI → Communication Bus ← Orchestrator → Individual Websites
```

- GUI subscribes to events, never called directly
- Orchestrator publishes events upward
- Websites have no dependencies on upper layers

### 3. Complete Website Isolation

Each website is a fully isolated instance:

- Independent 11ty server
- Own port allocation
- Own file watcher
- Cannot access other websites

## Usage Examples

### Basic: Creating and Starting a Website

```typescript
import { ServiceKeys } from '../core/container';
import { getGlobalContext } from '../core/service-registry';
import { IWebsiteOrchestrator } from '../core/layer-boundaries';

// Get the orchestrator from DI container
const context = getGlobalContext();
const orchestrator = context.getService<IWebsiteOrchestrator>(ServiceKeys.WEBSITE_ORCHESTRATOR);

// Create a new website (creates files and starts server)
const instance = await orchestrator.createWebsite('my-blog');

console.log(`Website running at: ${instance.url}`);
console.log(`Source path: ${instance.sourcePath}`);
```

### GUI Integration: Subscribing to Events

```typescript
import { ServiceKeys } from '../core/container';
import { getGlobalContext } from '../core/service-registry';
import { WebsiteOrchestrator } from './website-orchestrator';

const orchestrator = context.getService<WebsiteOrchestrator>(ServiceKeys.WEBSITE_ORCHESTRATOR);
const bus = orchestrator.getCommunicationBus();

// Subscribe to website events from the GUI layer
bus.subscribeFromManager('website:started', (websiteName, instance) => {
  console.log(`${websiteName} started on ${instance.url}`);
  // Update UI to show website is running
});

bus.subscribeFromManager('website:log', (websiteName, message, level) => {
  // Forward logs to the UI window
  sendToWebsiteWindow(websiteName, message, level);
});

bus.subscribeFromManager('website:build-complete', (websiteName, buildTimeMs) => {
  // Show build notification in UI
  showNotification(`${websiteName} rebuilt in ${buildTimeMs}ms`);
});
```

### Managing Website Lifecycle

```typescript
// List all websites
const allWebsites = await orchestrator.listAllWebsites();
const runningWebsites = orchestrator.listRunningWebsites();

// Start an existing website
const instance = await orchestrator.startWebsiteServer('my-blog');

// Stop a website
await orchestrator.stopWebsiteServer('my-blog');

// Rename a website (automatically handles running servers)
await orchestrator.renameWebsite('my-blog', 'my-awesome-blog');

// Delete a website
await orchestrator.deleteWebsite('my-blog');
```

### Working with Website Instances

```typescript
// Get a running website instance
const instance = orchestrator.getWebsiteInstance('my-blog');

if (instance) {
  // Trigger a manual rebuild
  await instance.rebuild();

  // Resolve a file path to its URL
  const url = await instance.resolveFileToUrl('/src/index.md');
  console.log(`File URL: ${url}`); // http://localhost:3000/

  // Check health status
  console.log(`Healthy: ${instance.isHealthy}`);
  console.log(`Last build: ${instance.lastBuildTime}ms`);
}
```

### Shutdown

```typescript
// Gracefully shutdown all websites
await orchestrator.shutdownAll();
```

## Communication Flow Examples

### Event Flow: Website Build Complete

```
1. Website Server Layer: Build completes
2. Orchestrator receives completion
3. Orchestrator publishes 'website:build-complete' event
4. GUI Layer subscribers receive event
5. UI updates to show completion
```

### Event Flow: Log Messages

```
1. Website Server needs to log (e.g., "File changed: index.md")
2. Server calls logCallback (set by orchestrator)
3. Orchestrator receives log via callback
4. Orchestrator publishes 'website:log' event through bus
5. GUI subscribers receive log
6. UI displays log in website window
```

## Benefits of This Architecture

1. **Testability**: Each layer can be tested independently
2. **Maintainability**: Clear separation of concerns
3. **Scalability**: Easy to add new website instances
4. **Reliability**: Failures in one website don't affect others
5. **Flexibility**: UI can be swapped without touching server logic

## Migration Path

If you have existing code that directly uses `WebsiteServerManager` or accesses servers:

**Before:**

```typescript
import { startWebsiteServer } from '../server/per-website-server';
const server = await startWebsiteServer('/path/to/website', 'my-site', 3000);
```

**After:**

```typescript
const orchestrator = context.getService<IWebsiteOrchestrator>(ServiceKeys.WEBSITE_ORCHESTRATOR);
const instance = await orchestrator.startWebsiteServer('my-site');
// instance.url, instance.port, etc. are available
```

## Files in This Directory

- `website-orchestrator.ts` - Main orchestrator implementation
- `README.md` - This documentation file
- `../core/layer-boundaries.ts` - Interface definitions and communication bus
- `../server/per-website-server.ts` - Individual website server (Layer 3)
