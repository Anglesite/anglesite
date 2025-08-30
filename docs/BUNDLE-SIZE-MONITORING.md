# Bundle Size Monitoring Guide

This document explains the comprehensive bundle size regression monitoring system for the @dwk monorepo, designed to prevent performance degradation through automated size tracking and analysis.

## Overview

The bundle size monitoring system provides:

1. **Automated Size Analysis** - Tracks package and build output sizes
2. **Regression Detection** - Identifies significant size increases
3. **Performance Budgets** - Enforces size limits for optimal performance
4. **Detailed Reporting** - Comprehensive size breakdowns and comparisons
5. **Optimization Recommendations** - Actionable suggestions for size reduction

## System Components

### GitHub Actions Workflow

**File**: `.github/workflows/bundle-size-analysis.yml`

**Triggers**:

- Every push to main branch
- Pull requests to main branch
- Weekly scheduled analysis
- Manual workflow dispatch

**Analysis Steps**:

1. Build all packages and Electron app
2. Analyze package sizes (compressed and uncompressed)
3. Generate webpack bundle reports
4. Compare against baseline (for PRs)
5. Check size limits and budgets
6. Create detailed reports and comments

### Analysis Scripts

#### `scripts/analyze-bundle-sizes.js`

Main analysis script that:

- Scans all workspace packages for build outputs
- Calculates uncompressed and gzipped sizes
- Analyzes Electron app bundles
- Generates comprehensive size reports
- Tracks file counts and largest files

#### `scripts/compare-bundle-sizes.js`

Comparison script that:

- Compares current sizes against baseline
- Calculates percentage and absolute changes
- Identifies significant regressions
- Generates optimization recommendations
- Formats results for GitHub comments

### Configuration

#### `.bundlesize.config.js`

Comprehensive configuration including:

- Package-specific size limits
- Performance budgets for different network conditions
- CI/CD integration settings
- Reporting and notification configuration
- Optimization thresholds and suggestions

## Size Limits and Budgets

### Package Size Limits

| Package           | Gzipped Limit | Uncompressed Limit | Notes                      |
| ----------------- | ------------- | ------------------ | -------------------------- |
| anglesite-11ty    | 150KB         | 500KB              | Core 11ty configuration    |
| anglesite-starter | 30KB          | 100KB              | Minimal starter template   |
| web-components    | 60KB          | 200KB              | Reusable component library |
| anglesite-app     | 15MB          | 50MB               | Electron application       |

### Performance Budgets

#### Network Performance

- **3G Budget**: 170KB (1 second load time)
- **4G Budget**: 500KB (1 second load time)

#### Bundle Categories

- **Critical Path**: 50KB maximum
- **Vendor Dependencies**: 200KB maximum
- **Application Code**: 300KB maximum

## Monitoring Features

### Automated Analysis

**On Every PR**:

- Size comparison against main branch
- Regression detection with configurable thresholds
- GitHub comment with detailed breakdown
- Performance budget validation

**On Main Branch**:

- Full package analysis with historical tracking
- Bundle optimization recommendations
- Size trend monitoring

**Weekly Schedule**:

- Comprehensive size audit
- Dependency analysis for duplicates
- Long-term trend analysis
- Automated issue creation for regressions

### Regression Detection

**Significance Thresholds**:

- **Percentage**: 5% change from baseline
- **Absolute**: 5KB change from baseline
- **Customizable**: Per-package override thresholds

**Detection Levels**:

- **Warning**: Moderate size increases (5-20%)
- **Error**: Significant size increases (>25%)
- **Critical**: Size limit violations

### Reporting and Notifications

#### GitHub Integration

- PR comments with size comparison tables
- Issue creation for significant regressions
- Workflow summaries with key metrics
- Artifact uploads for detailed analysis

#### Report Contents

- Package-by-package size breakdown
- Compressed vs uncompressed comparisons
- File count and largest file analysis
- Change detection with visual indicators
- Optimization recommendations

## Usage Guide

### Running Local Analysis

```bash
# Analyze current bundle sizes
node scripts/analyze-bundle-sizes.js

# Compare against previous version
node scripts/compare-bundle-sizes.js baseline.json current.json

# Run with npm scripts (if configured)
npm run analyze:bundle-size
npm run compare:bundle-size
```

### Interpreting Results

#### Size Change Indicators

- 🔺 **Red Arrow**: Size increase
- 🔽 **Green Arrow**: Size decrease
- ⚪ **White Circle**: No significant change
- ➕ **Plus**: New package
- ➖ **Minus**: Removed package

#### Recommendations

- 📈 **Performance Impact**: Size increases affecting load times
- 🚨 **Critical Issue**: Size limit violations
- 🔍 **Investigation Needed**: Significant changes requiring review
- 💡 **Optimization Opportunity**: Suggestions for size reduction

### Managing Size Budgets

#### Updating Limits

Modify `.bundlesize.config.js` to adjust limits:

```javascript
files: [
  {
    path: "anglesite-11ty/dist/**/*.js",
    maxSize: "150KB", // Adjust as needed
    compression: "gzip",
  },
];
```

#### Package-Specific Overrides

```javascript
packageOverrides: {
  'anglesite-11ty': {
    threshold: '3%',     // Stricter threshold
    warningSize: '400KB',
    errorSize: '500KB'
  }
}
```

## Optimization Strategies

### Bundle Size Reduction

#### Tree Shaking

- Remove unused exports and imports
- Configure bundlers for dead code elimination
- Use ES modules for better tree shaking

```javascript
// Good: Named imports enable tree shaking
import { specificFunction } from "library";

// Avoid: Default imports include entire library
import library from "library";
```

#### Code Splitting

- Split large bundles into smaller chunks
- Implement dynamic imports for lazy loading
- Separate vendor code from application code

```javascript
// Dynamic import for code splitting
const component = await import("./heavy-component");
```

#### Dependency Management

- Regular dependency audits
- Remove unused dependencies
- Choose smaller alternative libraries
- Bundle analyze to identify heavy dependencies

```bash
# Analyze dependency impact
npm ls --depth=0
npx webpack-bundle-analyzer dist/main.js
```

### Performance Optimization

#### Compression

- Enable gzip/brotli compression on servers
- Pre-compress assets during build
- Use appropriate compression levels

#### Asset Optimization

- Optimize images and fonts
- Use modern image formats (WebP, AVIF)
- Implement lazy loading for non-critical assets

#### Caching Strategies

- Implement proper cache headers
- Use content hashing for cache busting
- Separate frequently changing code from stable dependencies

## Troubleshooting

### Common Issues

#### False Positives

- Source map inclusion in size calculations
- Temporary file inclusion during builds
- Development dependencies in production builds

**Solutions**:

- Update ignore patterns in configuration
- Verify build process excludes dev dependencies
- Check for proper production build settings

#### Size Limit Violations

- Identify root cause of size increase
- Evaluate if increase is justified
- Update limits if increase provides significant value

**Investigation Steps**:

1. Review bundle analysis report
2. Compare file-by-file changes
3. Check for new dependencies
4. Analyze webpack bundle report
5. Consider optimization opportunities

#### Workflow Failures

- Check for missing build artifacts
- Verify script permissions and dependencies
- Review GitHub Actions logs

### Debugging Size Issues

#### Bundle Analysis

```bash
# Generate detailed webpack analysis
npx webpack-bundle-analyzer dist/main.js

# Analyze specific package
cd anglesite-11ty
npm run build
npx bundlesize
```

#### Size Investigation

```bash
# Find largest files
find dist -type f -name "*.js" -exec ls -lah {} + | sort -k 5 -hr

# Check gzip compression ratio
gzip -c dist/main.js | wc -c
stat -c%s dist/main.js
```

## Best Practices

### Development Workflow

1. **Monitor Size During Development**: Run local analysis before committing
2. **Review PR Comments**: Check bundle size impact in pull requests
3. **Address Regressions Promptly**: Don't let size creep accumulate
4. **Regular Audits**: Periodically review and optimize bundle sizes

### Configuration Management

1. **Set Realistic Limits**: Base limits on actual performance requirements
2. **Regular Reviews**: Update budgets as project evolves
3. **Team Communication**: Discuss size impacts during code reviews
4. **Documentation**: Keep optimization strategies documented

### Performance Culture

1. **Size-Aware Development**: Consider bundle impact when adding features
2. **Optimization Mindset**: Look for opportunities to reduce bundle sizes
3. **Measurement Focus**: Use data to drive optimization decisions
4. **Continuous Improvement**: Regularly reassess and improve size monitoring

## Integration with CI/CD

### GitHub Actions Integration

The system integrates seamlessly with GitHub Actions:

- Automated analysis on every PR and push
- Size comparison comments on pull requests
- Issue creation for significant regressions
- Artifact storage for historical tracking

### Status Checks

Configure branch protection to require bundle size checks:

- Bundle size within limits
- No significant regressions without approval
- Performance budget compliance

### Notifications

Set up notifications for:

- Size limit violations
- Significant size increases
- Weekly size reports
- Optimization opportunities

This comprehensive monitoring system helps maintain optimal performance by preventing bundle size regressions and providing actionable insights for optimization.
