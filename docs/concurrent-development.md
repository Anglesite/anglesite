# Concurrent Development Scripts

This document describes the concurrent development workflows and scripts available in Anglesite.

## Overview

Anglesite uses `concurrently` to run multiple development processes in parallel, improving developer productivity and enabling efficient multi-process workflows.

## Available Scripts

### Development Scripts

#### `dev:full`
Runs the complete development environment with both webpack and electron:
```bash
npm run dev:full
```
- Starts webpack dev server for React components
- Starts Electron in development mode
- Color-coded output with process names: `webpack,electron`
- Uses `-k` flag to kill all processes when one exits

#### `dev:watch`
Development with continuous testing:
```bash
npm run dev:watch
```
- Runs webpack dev server
- Runs unit tests in watch mode
- Process names: `webpack,tests`
- Automatically restarts tests when files change

#### `dev:complete`
Full development suite with analysis:
```bash
npm run dev:complete
```
- Webpack dev server with debug mode
- Unit tests in watch mode
- Bundle analyzer for monitoring bundle size
- Process names: `webpack,tests,analyzer`

### Build Scripts

#### `build:parallel`
Parallel build for improved performance:
```bash
npm run build:parallel
```
- Builds main application
- Builds icons
- Builds React development bundle
- All processes run concurrently for faster builds

### Testing Scripts

#### `test:parallel`
Run tests and linting in parallel:
```bash
npm run test:parallel
```
- Executes unit tests
- Runs parallel linting
- Uses `--kill-others-on-fail` to stop all processes if any fail
- Process names: `tests,lint`

#### `lint:parallel`
Parallel linting for multiple file types:
```bash
npm run lint:parallel
```
- ESLint for JavaScript/TypeScript files
- Markdownlint for documentation
- HTMLHint for HTML files
- Process names: `eslint,markdown,html`

## Configuration

### Process Management
- **Kill others flag (`-k`)**: Used in development scripts to ensure clean process shutdown
- **Color-coded output**: Uses `--prefix-colors` with `--names` for easy process identification
- **Fail-fast**: Test scripts use `--kill-others-on-fail` to stop immediately on failures

### Process Names
Each concurrent script uses descriptive process names for clear identification:
- `webpack`: Webpack dev server
- `electron`: Electron main process
- `tests`: Jest test runner
- `analyzer`: Bundle analyzer
- `eslint`: ESLint linting
- `markdown`: Markdown linting
- `html`: HTML linting

## Best Practices

1. **Use appropriate script**: Choose the development script that matches your current workflow
2. **Monitor output**: Pay attention to color-coded process output to identify issues quickly
3. **Clean shutdowns**: Use Ctrl+C to properly terminate all concurrent processes
4. **Resource usage**: Be aware that running multiple processes increases system resource usage

## Dependencies

- **concurrently**: Core package for running multiple processes
- **Webpack**: Development server and bundling
- **Jest**: Test runner with watch mode
- **ESLint**: JavaScript/TypeScript linting
- **markdownlint**: Markdown file linting
- **htmlhint**: HTML file validation

## Troubleshooting

### Common Issues
1. **Port conflicts**: Ensure required ports are available
2. **Process hanging**: Use `npm run dev:full` to restart all processes
3. **Resource exhaustion**: Close unnecessary applications when running multiple processes
4. **Test failures**: Check individual process logs when using parallel test scripts

### Performance Tips
- Use `dev:watch` for focused development with testing
- Use `dev:complete` only when analyzing bundle size
- Close development servers when not actively developing