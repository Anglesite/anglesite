# Bundle Analysis Documentation

This document provides comprehensive guidance on analyzing and optimizing webpack bundles in the Anglesite project.

## Overview

Bundle analysis helps identify optimization opportunities, track bundle size growth, and ensure optimal loading performance. The project uses webpack-bundle-analyzer for detailed insights into bundle composition.

## Available Scripts

### Basic Analysis Commands

#### `npm run analyze:bundle`
Default bundle analysis with interactive server mode:
```bash
npm run analyze:bundle
```
- Opens interactive bundle analyzer on port 8888
- Shows treemap visualization of bundle contents
- Automatically opens browser to view analysis

#### Server Mode
Interactive server for exploring bundle composition:
```bash
npm run analyze:bundle:server
```
- Best for development and detailed exploration
- Real-time interaction with bundle visualization
- Navigate through modules and dependencies

#### Static Mode
Generates static HTML report:
```bash
npm run analyze:bundle:static
```
- Creates `bundle-report.html` in output directory
- Suitable for CI/CD and documentation
- No server required to view results

#### JSON Mode
Exports analysis data as JSON:
```bash
npm run analyze:bundle:json
```
- Generates machine-readable analysis data
- Useful for automated analysis and monitoring
- Integrates with custom analysis scripts

### Advanced Analysis

#### Gzip Analysis
Analyze bundle sizes with gzip compression:
```bash
npm run analyze:bundle:gzip
```
- Shows compressed sizes (closer to real-world performance)
- Identifies compression effectiveness
- Helps optimize for network transfer

#### Statistics Generation
Generate detailed webpack statistics:
```bash
npm run analyze:bundle:stats
```
- Creates comprehensive stats.json file
- Includes module relationships and chunk information
- Used by other analysis tools

#### CI/CD Analysis
Optimized for continuous integration:
```bash
npm run analyze:bundle:ci
```
- Non-interactive mode suitable for CI pipelines
- Generates JSON and statistics files
- No browser opening or user interaction required

### Viewing and Summary

#### View Existing Analysis
View previously generated static reports:
```bash
npm run analyze:view
```
- Opens existing bundle-report.html
- No rebuild required
- Quick access to latest analysis

#### Bundle Summary
Generate text summary of bundle composition:
```bash
npm run analyze:summary
```
- Command-line summary of bundle statistics
- Asset sizes and types breakdown
- Quick overview without detailed visualization

#### Development with Analysis
Start development server with bundle analysis:
```bash
npm run dev:react:analyze
```
- Combines development workflow with analysis
- Real-time bundle monitoring during development
- Helpful for tracking bundle changes

## Environment Variables

Control analysis behavior with environment variables:

### `ANALYZE_BUNDLE`
Enable/disable bundle analysis:
```bash
export ANALYZE_BUNDLE=true
npm run build
```

### `ANALYZER_MODE`
Set analysis mode:
- `server` - Interactive server (default)
- `static` - Static HTML report
- `json` - JSON data export
- `disabled` - No analysis

```bash
export ANALYZER_MODE=static
```

### `ANALYZER_PORT`
Custom port for server mode:
```bash
export ANALYZER_PORT=9999
```

### `ANALYZER_OPEN`
Control automatic browser opening:
```bash
export ANALYZER_OPEN=false
```

### `ANALYZER_GENERATE_STATS`
Generate webpack statistics file:
```bash
export ANALYZER_GENERATE_STATS=true
```

## Analysis Output Files

### Bundle Report (`bundle-report.html`)
- Interactive treemap visualization
- Module size breakdown
- Dependency relationships
- Gzipped vs uncompressed sizes

### Statistics File (`bundle-stats.json`)
- Complete webpack compilation statistics
- Module dependency graph
- Chunk composition details
- Asset information and sizes

### Summary Report (console output)
- Total bundle size and asset count
- File type breakdown (JS, CSS, images)
- Largest modules and chunks
- Optimization recommendations

## Optimization Strategies

### Bundle Size Reduction

1. **Identify Large Modules**
   - Use treemap to find oversized dependencies
   - Consider alternatives to heavy libraries
   - Implement lazy loading for large components

2. **Tree Shaking**
   - Ensure ES6 module imports for better tree shaking
   - Avoid importing entire libraries when only parts are needed
   - Use webpack's sideEffects configuration

3. **Code Splitting**
   - Split vendor bundles from application code
   - Implement route-based code splitting
   - Use dynamic imports for optional features

4. **Asset Optimization**
   - Compress images and optimize formats
   - Minimize CSS and remove unused styles
   - Use appropriate asset loading strategies

### Performance Monitoring

1. **Bundle Size Limits**
   - Monitor total bundle size trends
   - Set up alerts for significant size increases
   - Track individual chunk sizes

2. **Dependency Analysis**
   - Regular audit of dependencies
   - Remove unused packages
   - Update to smaller alternatives when available

3. **Build Performance**
   - Monitor build time changes
   - Optimize webpack configuration
   - Use caching strategies effectively

## Common Analysis Patterns

### Finding Large Dependencies
```bash
# Generate detailed analysis
npm run analyze:bundle:server

# Look for large modules in the treemap
# Check node_modules section for oversized packages
# Identify opportunities for replacement or removal
```

### Tracking Bundle Growth
```bash
# Generate stats before changes
npm run analyze:bundle:stats

# Make your changes
# Generate stats after changes
npm run analyze:bundle:stats

# Compare sizes and identify what changed
npm run analyze:summary
```

### CI/CD Integration
```bash
# In CI pipeline
npm run analyze:bundle:ci

# Check for size regression
node scripts/bundle-summary.js

# Fail build if bundle size exceeds limits
```

## Troubleshooting

### Analysis Not Working
- Ensure webpack build completed successfully
- Check that webpack-bundle-analyzer is installed
- Verify environment variables are set correctly

### Large Bundle Sizes
- Run detailed analysis to identify largest modules
- Check for duplicate dependencies
- Review import patterns and lazy loading opportunities

### Build Performance Issues
- Use webpack-bundle-analyzer to identify bottlenecks
- Consider excluding analysis from development builds
- Use webpack's built-in performance hints

## Best Practices

1. **Regular Analysis**: Run bundle analysis regularly, especially before releases
2. **Size Budgets**: Establish and monitor bundle size budgets for different parts of the application
3. **Dependency Audits**: Regularly review and update dependencies to maintain optimal bundle sizes
4. **Documentation**: Document bundle optimization decisions and track size changes over time
5. **Team Awareness**: Share analysis results with the team to maintain collective awareness of bundle health

## Integration with Development Workflow

The bundle analysis tools integrate seamlessly with the development workflow:

- Development builds can include real-time analysis
- Production builds generate comprehensive reports
- CI/CD pipelines can enforce size budgets
- Performance monitoring tracks trends over time

For questions or issues with bundle analysis, refer to the webpack-bundle-analyzer documentation or consult the development team.