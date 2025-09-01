**@dwk Monorepo API Documentation v0.1.0**

---

# @dwk Monorepo API Documentation v0.1.0

ABOUTME: Auto-generated API documentation for all public interfaces in the @dwk monorepo
ABOUTME: Provides comprehensive reference for certificates, file watching, UI management, and website utilities

This documentation is automatically generated from TypeScript source code using TypeDoc. It covers all public APIs, interfaces, and utilities used across the Anglesite ecosystem.

## 📚 Module Overview

### Core Services

- **[certificates](certificates/README.md)** - SSL certificate generation and management for local HTTPS development
- **[server/enhanced-file-watcher](server/enhanced-file-watcher/README.md)** - Advanced file watching with debouncing and rebuild coordination
- **[utils/website-manager](utils/website-manager/README.md)** - Website project creation, validation, and lifecycle management

### User Interface

- **[ui/multi-window-manager](ui/multi-window-manager/README.md)** - Electron multi-window architecture and window state management
- **[ui/react/fluent](ui/react/fluent/README.md)** - React components wrapping Microsoft Fluent UI Web Components

## 🚀 Quick Start

### Common Use Cases

**Creating a new website project:**

```typescript
import { createWebsiteManager } from "./utils/website-manager";

const manager = createWebsiteManager("/path/to/websites");
await manager.createWebsite("my-site");
```

**Setting up SSL certificates:**

```typescript
import { generateCertificate } from "./certificates";

const { cert, key } = await generateCertificate(["localhost", "my-site.local"]);
```

**Managing application windows:**

```typescript
import { createWebsiteWindow } from "./ui/multi-window-manager";

const window = await createWebsiteWindow({
  websitePath: "/path/to/website",
  title: "My Site Editor",
});
```

## 📖 Documentation Standards

All APIs follow these standards:

- **Full TypeScript Support** - Complete type definitions with generics where appropriate
- **JSDoc Comments** - Comprehensive documentation with examples and parameter descriptions
- **Error Handling** - Documented error conditions and exception types
- **Testing Coverage** - All public APIs have corresponding test coverage

## 🔗 Related Documentation

- **[Developer Guide](../developer/README.md)** - Architecture and development practices
- **[Testing Strategy](../developer/testing/strategy.md)** - How APIs are tested and validated
- **[Style Guide](../STYLE_GUIDE.md)** - Documentation formatting and writing standards

---

_API documentation generated automatically from source code. Last updated: v0.1.0_
