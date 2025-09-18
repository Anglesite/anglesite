# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Anglesite is a monorepo containing a local-first WYSIWYG static site generator built with Electron, 11ty, and React. The project uses npm workspaces to manage four interconnected packages.

## Commands

### Development

```bash
# Start full development environment (React dev server + Electron)
cd anglesite && npm run dev:full

# Run tests across all workspaces
npm test

# Run tests with coverage
npm run test:coverage

# Run only unit tests (excluding integration/e2e)
cd anglesite && npm run test:unit

# Run specific test file
cd anglesite && npx jest path/to/test.spec.ts

# Lint and format code
npm run lint
npm run format
```

### Building

```bash
# Build all workspaces
npm run build

# Build main Electron app
cd anglesite && npm run build

# Build for distribution (creates .dmg, .exe, etc.)
cd anglesite && npm run dist

# Platform-specific builds
cd anglesite && npm run dist:mac
cd anglesite && npm run dist:win
cd anglesite && npm run dist:linux
```

### Bundle Analysis

```bash
# Analyze webpack bundle size
cd anglesite && npm run analyze:bundle:server

# View static bundle report
cd anglesite && npm run analyze:bundle:static
cd anglesite && npm run analyze:view
```

## Architecture

### Monorepo Structure

The project uses npm workspaces with four packages:

1. **anglesite/** - Main Electron desktop application
   - Electron main process in `src/main/`
   - React UI in `src/renderer/ui/react/`
   - Service-oriented architecture with dependency injection
   - Multi-window management for editing multiple websites

2. **anglesite-11ty/** - Reusable 11ty configuration package
   - Pre-configured 11ty plugins and optimizations
   - WebC component integration
   - SEO, RSS, and performance features

3. **anglesite-starter/** - Template for standalone 11ty exports
   - Example website structure
   - Uses anglesite-11ty and web-components packages

4. **web-components/** - Reusable WebC components
   - Head metadata, links, and UI components
   - Shared across all 11ty projects

### Core Services Architecture

The Electron app uses a service registry pattern (`anglesite/src/main/core/`):
- **ServiceRegistry** manages all application services
- **Container** provides dependency injection
- **StoreService** handles persistent settings
- Services communicate via well-defined interfaces

Key services include:
- WebsiteServerManager - manages local dev servers for each website
- MultiWindowManager - handles multiple editing windows
- DNSManager - manages local .test domains via hosts file
- ThemeManager - handles UI theming

### IPC Communication

Inter-process communication between main and renderer:
- Handlers in `anglesite/src/main/ipc/handlers/`
- Type-safe IPC channels defined in interfaces
- Async/await pattern for all IPC calls

### Build System

- **Webpack** configurations in `anglesite/webpack.*.js`
- Separate configs for development, production, and common
- React Fast Refresh for development
- Code splitting and lazy loading for performance
- TailwindCSS with PostCSS processing

### Testing Strategy

- Jest configuration per workspace
- Unit tests alongside source files
- Integration tests in `test/integration/`
- Mock implementations in `test/mocks/`
- Coverage targets: 90% for critical paths

## Key Files and Locations

- Main entry point: `anglesite/src/main/main.ts`
- React app entry: `anglesite/src/renderer/ui/react/index.tsx`
- Service definitions: `anglesite/src/main/core/interfaces.ts`
- IPC handlers: `anglesite/src/main/ipc/handlers/*.ts`
- 11ty config: `anglesite-11ty/index.ts`
- Web components: `web-components/src/*.webc`

## Development Tips

1. **Service Development**: When adding new features, create a service in `anglesite/src/main/services/` and register it in the ServiceRegistry.

2. **IPC Patterns**: Always define IPC channels in interfaces first, then implement handlers in main process and use invoke pattern in renderer.

3. **Window Management**: Use MultiWindowManager service for creating new windows. Each website gets its own BrowserWindow instance.

4. **Testing**: Write tests alongside code. Use mocks from `test/mocks/` for service dependencies.

5. **Bundle Size**: Run bundle analysis before major changes. Keep React components lazy-loaded where possible.

6. **Type Safety**: Leverage TypeScript throughout. Avoid `any` types. Use proper interfaces for service contracts.