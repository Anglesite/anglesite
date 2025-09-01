# Developer Documentation

ABOUTME: Comprehensive technical documentation for Anglesite contributors and integrators
ABOUTME: Covers architecture, testing strategy, development setup, and release management

Welcome to the Anglesite developer documentation. This section contains technical documentation for developers working on or with Anglesite.

## Documentation Structure

- **[Architecture](architecture/)** - System design and technical architecture
- **[Features](features/)** - Technical documentation for specific features
- **[Testing](testing/)** - Testing strategy and guidelines
- **[Release](release/)** - Release process and package management
- **[Setup](setup/)** - Environment configuration and development tools
- **[Security](SECURITY_CONFIGURATION.md)** - Security automation and policies
- **[API Reference](../api/)** - Auto-generated API documentation

## Quick Links

### Architecture & Design

- [Multi-Window Architecture](architecture/multi-window.md)
- [Fluent UI Migration Guide](architecture/fluent-ui.md)
- [Plugin System (NPM-based)](architecture/plugin-system.md)

### Features & Tools

- [Bundle Analysis Tools](features/bundle-analysis.md)
- [WebC Plugin System](features/webc-plugins.md)
- [Bundle Size Monitoring](features/bundle-monitoring.md)

### Development Setup

- [Environment Configuration](setup/environment.md)
- [Security Configuration](SECURITY_CONFIGURATION.md)

### Testing & Quality

- [Testing Strategy](testing/strategy.md)
- [Integration Testing](testing/integration.md)
- [Performance Testing](testing/performance.md)

### Release Management

- [Release Process](release/process.md)
- [Changelog Guide](release/changelog-guide.md)
- [Legacy Process Reference](release/legacy-process.md)

## Development Guidelines

### Code Coverage Requirements

- Minimum 90% test coverage for all new code
- JSDoc documentation for all exported functions
- TypeScript strict mode compliance

### Documentation Standards

- All features must be documented before release
- JSDoc comments must include @example sections for public APIs
- Architecture decisions must be documented in ADR format

## Getting Started

1. Clone the monorepo
2. Run `npm install` at the root level
3. Run `npm test` to verify setup
4. See individual package READMEs for specific development instructions
