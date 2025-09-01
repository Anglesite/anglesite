# Performance Testing Guide

This document explains the comprehensive performance testing automation system for the @dwk monorepo, designed to detect performance regressions and track optimization improvements across packages and applications.

## Overview

The performance testing system provides:

1. **Automated Benchmarking** - Systematic measurement of performance metrics
2. **Regression Detection** - Identifies performance degradations against baselines
3. **Trend Analysis** - Tracks performance changes over time
4. **Cross-Platform Testing** - Validates performance on multiple operating systems
5. **Detailed Reporting** - Comprehensive performance insights and recommendations

## System Architecture

### Test Framework Components

#### Jest Performance Configuration (`jest.performance.config.js`)

- Extended timeouts for benchmark execution (60 seconds)
- Single-worker execution for consistent results
- Custom performance reporters and baseline comparison
- Specialized test environment for performance isolation

#### Performance Utilities (`tests/performance/setup.js`)

- High-resolution timing utilities
- Memory usage measurement
- CPU profiling capabilities
- Benchmark runner with warmup iterations
- Baseline comparison and storage

#### Custom Jest Matchers (`tests/performance/matchers.js`)

- `toCompleteWithin(maxTime)` - Assert execution time limits
- `toUseMemoryWithin(maxMemory)` - Assert memory usage limits
- `toNotRegressFrom(baseline, threshold)` - Compare against baselines
- `toScaleLinearly(inputSizes, tolerance)` - Test algorithmic complexity
- `toHaveThroughputOf(minOpsPerSec)` - Assert throughput requirements
- `toBeConsistent(maxVariation)` - Test result consistency

### Performance Reporter (`tests/performance/performance-reporter.js`)

- Automated regression detection with configurable thresholds
- Trend analysis and historical comparison
- Human-readable and JSON report generation
- Performance warning identification
- Baseline management and updates

## Test Suites

### Anglesite-11ty Performance Tests

**File**: `tests/performance/anglesite-11ty.perf.js`

**Test Categories**:

- **Build Performance**: Site building speed with various page counts
- **Linear Scaling**: Performance scaling with content size
- **Plugin Performance**: Individual and collective plugin execution speed
- **Memory Management**: Memory usage patterns and leak detection
- **Incremental Builds**: File change detection and rebuild optimization

**Key Benchmarks**:

- Small site build (10 pages): < 5 seconds
- Linear scaling test: 30% tolerance for algorithmic overhead
- Plugin overhead: < 100% increase over base build
- Memory leak detection: < 5MB increase per repeated build

### Anglesite App Performance Tests

**File**: `tests/performance/anglesite-app.perf.js`

**Test Categories**:

- **Application Startup**: Electron app initialization time
- **File System Operations**: Directory scanning and file processing
- **Website Building**: Site generation performance within app
- **Memory Management**: Memory usage during intensive operations
- **UI Responsiveness**: Simulated UI operation performance

**Key Benchmarks**:

- App startup: < 15 seconds
- Directory scan (100 files): < 500ms
- Markdown processing (50 files): < 2 seconds
- Memory trend: < 10MB increase per operation cycle

## GitHub Actions Integration

### Performance Monitoring Workflow

**File**: `.github/workflows/performance-monitoring.yml`

**Triggers**:

- Push to main branch
- Pull requests (with comparison)
- Scheduled runs (twice weekly)
- Manual workflow dispatch with custom parameters

**Features**:

- Multi-platform testing (Ubuntu, Windows, macOS)
- Baseline comparison for pull requests
- Automated regression alerts
- Performance artifact collection
- Detailed GitHub step summaries

### Workflow Outputs

#### Pull Request Comments

- Performance comparison tables
- Regression and improvement highlights
- Throughput and memory usage analysis
- Recommendations for optimization

#### Issue Creation

- Automated alerts for significant regressions
- Investigation steps and debugging guidance
- Historical context and trend analysis

## Usage Guide

### Running Performance Tests

#### Local Development

```bash
# Run all performance tests
npm run test:performance

# Run with custom parameters
BENCHMARK_ITERATIONS=20 PERFORMANCE_THRESHOLD_MS=3000 npm run test:performance

# Run specific performance test
npx jest --config jest.performance.config.js tests/performance/anglesite-11ty.perf.js
```

#### Environment Variables

- `BENCHMARK_ITERATIONS`: Number of benchmark iterations (default: 10)
- `PERFORMANCE_THRESHOLD_MS`: Performance threshold in milliseconds (default: 5000)
- `FULL_PERFORMANCE_SUITE`: Run comprehensive test suite (default: false)

### Interpreting Results

#### Performance Report Structure

```json
{
  "metadata": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "nodeVersion": "v20.x.x",
    "platform": "linux",
    "cpuCount": 4
  },
  "summary": {
    "totalTests": 15,
    "passedTests": 14,
    "failedTests": 1,
    "regressions": [],
    "improvements": [],
    "warnings": []
  },
  "benchmarks": [
    {
      "name": "anglesite-11ty-small-site-build",
      "timing": {
        "avg": 2451.23,
        "min": 2398.45,
        "max": 2503.67,
        "p95": 2489.12,
        "p99": 2501.34
      },
      "memory": {
        "heapUsed": 45678901,
        "heapUsedMB": "43.56"
      },
      "performanceMetrics": {
        "throughput": 4.08,
        "consistency": 0.021
      }
    }
  ]
}
```

#### Key Metrics Explained

- **Average Time**: Mean execution time across iterations
- **P95/P99**: 95th and 99th percentile latencies
- **Throughput**: Operations per second
- **Consistency**: Coefficient of variation (lower is better)
- **Memory Usage**: Peak heap memory consumption

### Baseline Management

#### Updating Baselines

```bash
# Generate new baselines (requires manual workflow dispatch)
# Set update_baselines=true in workflow inputs

# Or manually copy from performance results
cp performance-results/benchmark-results.json tests/performance/baselines/
```

#### Baseline Structure

```json
{
  "name": "benchmark-name",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "timing": {
    "avg": 1234.56,
    "min": 1200.0,
    "max": 1300.0
  },
  "memory": {
    "heapUsed": 12345678
  },
  "systemInfo": {
    "nodeVersion": "v20.x.x",
    "platform": "linux"
  }
}
```

## Performance Optimization

### Best Practices

#### Code Optimization

```javascript
// Good: Efficient iteration
const results = items.map(processItem);

// Avoid: Inefficient nested loops
for (const item of items) {
  for (const other of items) {
    // O(n²) complexity
  }
}
```

#### Memory Management

```javascript
// Good: Clean up resources
const largeObject = createLargeObject();
try {
  processObject(largeObject);
} finally {
  largeObject = null; // Allow GC
}

// Avoid: Memory leaks
global.cache = global.cache || [];
global.cache.push(data); // Never cleaned up
```

#### Async Operations

```javascript
// Good: Parallel execution
const results = await Promise.all(items.map((item) => processItemAsync(item)));

// Avoid: Sequential execution
const results = [];
for (const item of items) {
  results.push(await processItemAsync(item));
}
```

### Common Performance Issues

#### Build Performance

- **Large Content**: Split large content into smaller chunks
- **Plugin Overhead**: Disable unused plugins in development
- **File System**: Optimize file reading patterns
- **Memory Usage**: Monitor memory growth in long-running processes

#### Electron App Performance

- **Startup Time**: Lazy load non-critical modules
- **File Operations**: Use async file operations
- **Memory Leaks**: Properly clean up event listeners
- **UI Responsiveness**: Avoid blocking the main thread

### Performance Thresholds

#### Anglesite-11ty Benchmarks

| Benchmark                    | Threshold  | Description             |
| ---------------------------- | ---------- | ----------------------- |
| Small site build (10 pages)  | 5 seconds  | Basic build performance |
| Medium site build (50 pages) | 15 seconds | Scalability test        |
| Plugin execution             | 8 seconds  | All plugins enabled     |
| Memory usage                 | 200 MB     | Peak memory consumption |

#### Anglesite App Benchmarks

| Benchmark                      | Threshold         | Description             |
| ------------------------------ | ----------------- | ----------------------- |
| App startup                    | 15 seconds        | Time to ready state     |
| Directory scan (100 files)     | 500 ms            | File system performance |
| Markdown processing (50 files) | 2 seconds         | Content processing      |
| Memory trend                   | < 10 MB/operation | Memory leak detection   |

## Troubleshooting

### Common Issues

#### Test Failures

```bash
# Check for resource constraints
free -m  # Memory usage
top      # CPU usage
df -h    # Disk usage

# Run with increased timeout
PERFORMANCE_THRESHOLD_MS=10000 npm run test:performance
```

#### Inconsistent Results

```bash
# Run with more iterations for stability
BENCHMARK_ITERATIONS=50 npm run test:performance

# Check for background processes
ps aux | grep node
```

#### Memory Issues

```bash
# Enable garbage collection
node --expose-gc $(npm bin)/jest --config jest.performance.config.js

# Monitor memory usage
node --max-old-space-size=4096 $(npm bin)/jest --config jest.performance.config.js
```

### Debugging Performance Issues

#### Profiling Tools

```bash
# CPU profiling
node --prof $(npm bin)/jest --config jest.performance.config.js

# Memory profiling
node --inspect $(npm bin)/jest --config jest.performance.config.js
```

#### Analysis Scripts

```javascript
// Analyze timing patterns
const timings = benchmark.timing.times;
const sorted = timings.sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const iqr =
  sorted[Math.floor(sorted.length * 0.75)] -
  sorted[Math.floor(sorted.length * 0.25)];
console.log(`Median: ${median}ms, IQR: ${iqr}ms`);
```

### CI/CD Integration

#### GitHub Actions Setup

- Virtual display configuration for Electron testing
- Multi-platform test execution
- Artifact collection and retention
- Automated reporting and alerting

#### Performance Budgets

```yaml
# Example performance budget
performance_budgets:
  anglesite_startup: 15000 # 15 seconds
  build_small_site: 5000 # 5 seconds
  memory_usage: 209715200 # 200MB
```

## Continuous Improvement

### Performance Monitoring Strategy

1. **Regular Benchmarking**: Automated twice-weekly performance tests
2. **Regression Detection**: Immediate alerts on performance degradation
3. **Trend Analysis**: Long-term performance tracking and optimization opportunities
4. **Cross-Platform Validation**: Ensure consistent performance across environments

### Optimization Workflow

1. **Identify Bottlenecks**: Use profiling tools and benchmark results
2. **Implement Optimizations**: Focus on high-impact improvements
3. **Measure Impact**: Validate optimizations with performance tests
4. **Update Baselines**: Establish new performance expectations
5. **Document Changes**: Record optimization techniques and results

This comprehensive performance testing system ensures that the @dwk monorepo maintains optimal performance while catching regressions early in the development process.
