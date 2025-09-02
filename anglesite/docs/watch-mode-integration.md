# Watch Mode Integration

Anglesite now features comprehensive watch mode integration with incremental compilation, smart file filtering, debouncing, and performance monitoring for optimal development experience.

## Features

### 🚀 Enhanced File Watching

- **Smart File Filtering**: Automatically ignores temporary files, build artifacts, and irrelevant changes
- **Intelligent Debouncing**: 300ms debounce with batching to prevent excessive rebuilds
- **Priority-based Processing**: Configuration and template files are prioritized for faster feedback

### 📊 Performance Monitoring

- **Real-time Metrics**: Track rebuild times, change counts, and memory usage
- **Efficiency Reporting**: Monitor changes-per-rebuild ratio for optimization insights
- **Memory Tracking**: Peak memory usage monitoring to prevent resource leaks

### ⚡ Incremental Compilation

- **Batched Changes**: Process multiple file changes in optimized batches
- **Selective Rebuilds**: Only rebuilds when necessary files change
- **Fast Feedback**: Average rebuild times under 500ms for typical changes

### 🎯 Smart Configuration

- **Auto-detection**: Automatically configures watch patterns based on project structure
- **Customizable Debouncing**: Adjustable timing for different development scenarios
- **Resource Management**: Proper cleanup prevents fsevents crashes on macOS

## Usage

Watch mode is automatically enabled when starting a website server in development mode. No additional configuration required.

### Configuration Options

The enhanced file watcher can be customized through the `WatchModeConfig` interface:

```typescript
interface WatchModeConfig {
  inputDir: string; // Base directory to watch
  outputDir: string; // Build output directory (excluded)
  debounceMs?: number; // Debounce delay (default: 300ms)
  maxBatchSize?: number; // Max changes per batch (default: 25)
  enableMetrics?: boolean; // Performance monitoring (default: true)
  ignorePatterns?: string[]; // Additional ignore patterns
  priorityExtensions?: string[]; // File types to prioritize
}
```

### Performance Metrics

Watch mode provides detailed performance metrics:

- **Total Changes**: Number of file changes detected
- **Total Rebuilds**: Number of build processes triggered
- **Average Rebuild Time**: Mean rebuild duration
- **Batched Changes**: Total changes processed in batches
- **Ignored Changes**: Files filtered out (temp files, etc.)
- **Peak Memory Usage**: Maximum memory consumption
- **Efficiency Ratio**: Changes per rebuild (higher is better)

### File Filtering

The system automatically filters out:

- **Temporary Files**: `.tmp`, `.temp`, `.swp`, `.lock` files
- **Build Artifacts**: Contents of output directories
- **System Files**: `.DS_Store`, `Thumbs.db`
- **Log Files**: `.log` files and similar
- **Version Control**: `.git` directories

### Priority File Types

These file types receive priority processing:

- **Content**: `.md`, `.html`, `.njk`, `.liquid`
- **Styles**: `.css`, `.scss`, `.less`
- **Scripts**: `.js`, `.ts`
- **Configuration**: `.json`, `.yaml`, `.toml`

## Architecture

### EnhancedFileWatcher Class

The core `EnhancedFileWatcher` class provides:

1. **Chokidar Integration**: Uses optimized chokidar configuration
2. **Event Debouncing**: Intelligent delay and batching logic
3. **Metrics Collection**: Real-time performance tracking
4. **Resource Management**: Proper cleanup and error handling

### Integration Points

- **Per-Website Server**: Each website gets its own watcher instance
- **Webpack Dev Server**: Enhanced watching for React components
- **URL Resolver**: Coordinate with file-to-URL mapping updates

## Benefits

### Developer Experience

- **Faster Feedback**: Sub-second rebuild times for most changes
- **Reduced CPU Usage**: Smart filtering eliminates unnecessary work
- **Better Reliability**: Proper cleanup prevents system issues

### Performance

- **Efficient Batching**: Multiple changes processed together
- **Memory Optimization**: Prevents memory leaks during long sessions
- **Resource Management**: Clean shutdown prevents system instability

### Monitoring

- **Visibility**: Clear insight into build performance
- **Optimization**: Metrics help identify performance bottlenecks
- **Debugging**: Detailed logging for troubleshooting

## Technical Implementation

### File Change Flow

1. **File System Event**: Chokidar detects file change
2. **Smart Filtering**: Check against ignore patterns and rules
3. **Debounce Logic**: Add to pending changes, reset timer
4. **Batch Processing**: Collect and prioritize changes
5. **Rebuild Trigger**: Execute incremental compilation
6. **Metrics Update**: Record timing and performance data

### Error Handling

- **Graceful Degradation**: Continues operation despite individual errors
- **Resource Cleanup**: Prevents resource leaks on errors
- **Detailed Logging**: Comprehensive error reporting for debugging

### Memory Management

- **Bounded Collections**: Limit stored metrics to prevent growth
- **Cleanup on Stop**: Proper resource deallocation
- **Memory Monitoring**: Track and report memory usage patterns

## Future Enhancements

- **Selective File Watching**: Watch only files that affect current page
- **Change Impact Analysis**: Determine minimal rebuild scope
- **Build Caching**: Cache unchanged file processing results
- **Distributed Watching**: Coordinate watching across multiple processes
