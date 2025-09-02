# Bundle Analysis Guide

This document explains how to use webpack-bundle-analyzer with Anglesite to analyze and optimize bundle sizes.

## Available Analysis Commands

### Production Bundle Analysis

```bash
# Basic bundle analysis (opens interactive server)
npm run analyze:bundle

# Server mode (default) - opens interactive web interface
npm run analyze:bundle:server

# Static mode - generates HTML report file
npm run analyze:bundle:static

# JSON mode - generates machine-readable stats
npm run analyze:bundle:json

# Analyze gzipped sizes (shows compressed bundle sizes)
npm run analyze:bundle:gzip

# Generate detailed stats file for further analysis
npm run analyze:bundle:stats

# CI/automation friendly (no browser, JSON + stats)
npm run analyze:bundle:ci
```

### Development Bundle Analysis

```bash
# Analyze development bundle while developing
npm run dev:react:analyze
```

## Analysis Modes

### Server Mode (Default)

- Opens interactive web interface at http://localhost:8888
- Real-time exploration of bundle contents
- Best for manual analysis and optimization

### Static Mode

- Generates `bundle-report.html` file in project root
- Can be shared with team or included in CI artifacts
- Good for reports and documentation

### JSON Mode

- Generates machine-readable statistics
- Useful for automated analysis and CI/CD integration
- Can be processed by other tools

## Environment Variables

You can customize the analyzer behavior using environment variables:

```bash
# Change analyzer mode
ANALYZER_MODE=static npm run analyze:bundle

# Use different port
ANALYZER_PORT=9999 npm run analyze:bundle

# Don't auto-open browser
ANALYZER_OPEN=false npm run analyze:bundle

# Generate stats file
ANALYZER_GENERATE_STATS=true npm run analyze:bundle

# Show different size metrics
ANALYZER_SIZES=gzip npm run analyze:bundle  # Options: stat, parsed, gzip

# Change log level
ANALYZER_LOG_LEVEL=warn npm run analyze:bundle  # Options: info, warn, error, silent
```

## Understanding the Analysis

### Size Metrics

- **Stat Size**: Raw file size before any processing
- **Parsed Size**: File size after webpack processing (minification, etc.)
- **Gzipped Size**: Compressed size as served to browsers (most relevant)

### What to Look For

#### Large Dependencies

- Identify unexpectedly large npm packages
- Look for duplicate dependencies
- Find unused portions of large libraries

#### Code Splitting Opportunities

- Identify chunks that could be split further
- Look for vendor code mixed with application code
- Find rarely-used code that could be lazy-loaded

#### Optimization Opportunities

- Tree-shaking failures
- Large images or assets that could be optimized
- Source maps included in production (should be excluded)

## Common Optimization Strategies

### 1. Code Splitting

```javascript
// Dynamic imports for route-based splitting
const LazyComponent = React.lazy(() => import('./LazyComponent'));

// Split vendor libraries
optimization: {
  splitChunks: {
    chunks: 'all',
    cacheGroups: {
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendors',
        chunks: 'all',
      }
    }
  }
}
```

### 2. Tree Shaking

```javascript
// Import only what you need
import { debounce } from 'lodash-es'; // Good
import _ from 'lodash'; // Imports entire library
```

### 3. Bundle Splitting

```javascript
// Split by feature
entry: {
  main: './src/main.js',
  admin: './src/admin.js',
  vendor: ['react', 'react-dom']
}
```

## Performance Budgets

The current performance budgets are configured in `assets.config.js`:

- **Max Entrypoint Size**: 500KB (512000 bytes)
- **Max Asset Size**: 250KB (250000 bytes)

These limits will show warnings when exceeded during builds.

## CI/CD Integration

For continuous monitoring of bundle sizes:

```bash
# Generate stats for CI
npm run analyze:bundle:ci

# This creates:
# - bundle-stats.json (machine-readable statistics)
# - No browser opening (CI-friendly)
# - JSON mode output for processing
```

You can then process these files in your CI pipeline to:

- Track bundle size over time
- Fail builds that exceed size budgets
- Generate size change reports in pull requests

## Troubleshooting

### Analyzer Won't Start

- Check if port 8888 is already in use
- Use `ANALYZER_PORT=9999` to use a different port
- Check for firewall blocking localhost connections

### Missing Dependencies

- Ensure `webpack-bundle-analyzer` is installed
- Run `npm install` to ensure all dependencies are present

### Empty or Incorrect Analysis

- Make sure you're analyzing a production build
- Verify the build completed successfully before analysis
- Check that the output directory contains the expected files
