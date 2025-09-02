# Concurrent Development Scripts

This document describes the parallel development scripts available in Anglesite using the `concurrently` package.

## Available Concurrent Scripts

### Build Scripts

- **`npm run build:parallel`** - Parallel build for development
  - Runs: app build, icons build, and React dev build simultaneously
  - Faster than sequential builds for development

### Development Scripts

- **`npm run dev:full`** - Full development environment
  - Runs: webpack dev server + electron app
  - Colors: webpack (blue), electron (green)
  - Perfect for full-stack development

- **`npm run dev:watch`** - Development with testing
  - Runs: webpack dev server + test watcher
  - Colors: webpack (blue), tests (yellow)
  - Great for TDD workflow

- **`npm run dev:complete`** - Complete development environment
  - Runs: webpack dev server (debug mode) + test watcher + bundle analyzer
  - Colors: webpack (blue), tests (yellow), analyzer (magenta)
  - Ultimate development setup with all monitoring

### Testing & Quality Scripts

- **`npm run test:parallel`** - Parallel testing and linting
  - Runs: unit tests + all linting (ESLint, Markdown, HTML)
  - Colors: tests (green), lint (red)
  - Kills all processes if any fail (`--kill-others-on-fail`)

- **`npm run lint:parallel`** - Parallel linting
  - Runs: ESLint + Markdown lint + HTML lint simultaneously
  - Colors: eslint (red), markdown (magenta), html (cyan)
  - Faster than sequential linting

## Concurrent Features Used

- **`-k`** or **`--kill-others`** - Kills other processes when one exits
- **`--names`** - Custom names for each process in output
- **`--prefix-colors`** - Color-coded output for easy identification
- **`--kill-others-on-fail`** - Stops all processes if any fail

## Usage Examples

```bash
# Start full development environment
npm run dev:full

# Development with live testing
npm run dev:watch

# Run tests and linting in parallel
npm run test:parallel

# Quick parallel build for development
npm run build:parallel
```

## Performance Benefits

- **Faster Development Cycles**: Multiple processes run simultaneously
- **Better Resource Utilization**: Parallel execution uses multiple CPU cores
- **Immediate Feedback**: See webpack, tests, and linting results together
- **Color-Coded Output**: Easy to identify which process is outputting what

## Process Management

All concurrent scripts use `-k` (kill-others) flag to ensure clean shutdown when you press Ctrl+C. This prevents orphaned processes and resource leaks.
