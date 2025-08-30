// ABOUTME: Performance test setup and utilities for benchmark execution
// ABOUTME: Provides timing utilities, memory profiling, and baseline comparison tools

const fs = require('fs');
const path = require('path');
const { performance, PerformanceObserver } = require('perf_hooks');

// Extended timeout for performance tests with retry consideration
const PERFORMANCE_TEST_TIMEOUT = process.env.CI ? 120000 : 60000;
jest.setTimeout(PERFORMANCE_TEST_TIMEOUT);

// Retry configuration for flaky performance tests
const RETRY_CONFIG = {
  maxRetries: process.env.CI ? 3 : 1,
  retryDelay: 2000,
  stabilizationDelay: 1000
};

// Helper function to stabilize system before measurement
async function stabilizeSystem() {
  // Force garbage collection multiple times
  if (global.gc) {
    for (let i = 0; i < 3; i++) {
      global.gc();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  // Wait for system to stabilize
  await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.stabilizationDelay));
  
  // Check system resource availability
  const memUsage = process.memoryUsage();
  if (memUsage.heapUsed / memUsage.heapTotal > 0.8) {
    console.warn('⚠️ High memory usage detected before performance test');
  }
}

// Performance measurement utilities
global.performanceUtils = {
  // High-resolution timing
  measureTime: async (fn, iterations = 1) => {
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }
    
    return {
      times,
      avg: times.reduce((sum, time) => sum + time, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      median: times.sort((a, b) => a - b)[Math.floor(times.length / 2)],
      p95: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)],
      p99: times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)]
    };
  },
  
  // Memory usage measurement
  measureMemory: async (fn) => {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const initialMemory = process.memoryUsage();
    
    const result = await fn();
    
    const finalMemory = process.memoryUsage();
    
    return {
      result,
      memory: {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
        rss: finalMemory.rss - initialMemory.rss
      },
      initial: initialMemory,
      final: finalMemory
    };
  },
  
  // CPU profiling utilities
  profileCPU: async (fn, options = {}) => {
    const { sampleInterval = 100 } = options;
    
    const start = process.hrtime.bigint();
    const startCpu = process.cpuUsage();
    
    const result = await fn();
    
    const end = process.hrtime.bigint();
    const endCpu = process.cpuUsage(startCpu);
    
    return {
      result,
      timing: {
        wallTime: Number(end - start) / 1e6, // Convert to milliseconds
        cpuTime: {
          user: endCpu.user / 1000, // Convert to milliseconds
          system: endCpu.system / 1000
        }
      }
    };
  },
  
  // Benchmark runner
  benchmark: async (name, fn, options = {}) => {
    const {
      iterations = global.BENCHMARK_ITERATIONS || 10,
      warmupIterations = Math.max(1, Math.floor(iterations * 0.1)),
      timeout = 30000
    } = options;
    
    console.log(`📊 Running benchmark: ${name}`);
    console.log(`   Warmup iterations: ${warmupIterations}`);
    console.log(`   Benchmark iterations: ${iterations}`);
    
    // Warmup runs
    for (let i = 0; i < warmupIterations; i++) {
      await fn();
    }
    
    // Force garbage collection before benchmarks
    if (global.gc) {
      global.gc();
    }
    
    // Actual benchmark runs
    const measurements = await global.performanceUtils.measureTime(fn, iterations);
    const memoryMeasurement = await global.performanceUtils.measureMemory(fn);
    
    const benchmark = {
      name,
      timestamp: new Date().toISOString(),
      iterations,
      timing: measurements,
      memory: memoryMeasurement.memory,
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: require('os').cpus().length,
        totalMemory: require('os').totalmem(),
        freeMemory: require('os').freemem()
      }
    };
    
    // Store benchmark result for reporting
    global.benchmarkResults = global.benchmarkResults || [];
    global.benchmarkResults.push(benchmark);
    
    return benchmark;
  },
  
  // Baseline comparison
  compareWithBaseline: (current, baseline, thresholds = {}) => {
    const {
      regressionThreshold = 0.1, // 10% regression threshold
      improvementThreshold = 0.05 // 5% improvement threshold
    } = thresholds;
    
    const comparison = {
      current: current.avg,
      baseline: baseline.avg,
      change: current.avg - baseline.avg,
      percentChange: ((current.avg - baseline.avg) / baseline.avg) * 100,
      isRegression: false,
      isImprovement: false,
      isSignificant: false
    };
    
    const relativeChange = Math.abs(comparison.change) / baseline.avg;
    
    if (relativeChange > regressionThreshold) {
      comparison.isSignificant = true;
      if (comparison.change > 0) {
        comparison.isRegression = true;
      } else {
        comparison.isImprovement = true;
      }
    }
    
    return comparison;
  },
  
  // Load baseline from file
  loadBaseline: (testName) => {
    const baselinePath = path.join(__dirname, 'baselines', `${testName}.baseline.json`);
    
    try {
      if (fs.existsSync(baselinePath)) {
        return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      }
    } catch (error) {
      console.warn(`Warning: Could not load baseline for ${testName}: ${error.message}`);
    }
    
    return null;
  },
  
  // Save baseline to file
  saveBaseline: (testName, benchmark) => {
    const baselineDir = path.join(__dirname, 'baselines');
    const baselinePath = path.join(baselineDir, `${testName}.baseline.json`);
    
    // Ensure baseline directory exists
    if (!fs.existsSync(baselineDir)) {
      fs.mkdirSync(baselineDir, { recursive: true });
    }
    
    try {
      fs.writeFileSync(baselinePath, JSON.stringify(benchmark, null, 2));
      console.log(`💾 Saved baseline for ${testName}`);
    } catch (error) {
      console.warn(`Warning: Could not save baseline for ${testName}: ${error.message}`);
    }
  },
  
  // Create performance assertions
  expectPerformance: (benchmark, expectations = {}) => {
    const {
      maxTime = global.PERFORMANCE_THRESHOLD_MS || 1000,
      maxMemory = 50 * 1024 * 1024, // 50MB
      baselineName = null
    } = expectations;
    
    // Time assertion
    if (benchmark.timing.avg > maxTime) {
      throw new Error(
        `Performance regression: Average time ${benchmark.timing.avg.toFixed(2)}ms exceeds threshold ${maxTime}ms`
      );
    }
    
    // Memory assertion
    if (benchmark.memory.heapUsed > maxMemory) {
      throw new Error(
        `Memory usage ${(benchmark.memory.heapUsed / 1024 / 1024).toFixed(2)}MB exceeds threshold ${(maxMemory / 1024 / 1024).toFixed(2)}MB`
      );
    }
    
    // Baseline comparison
    if (baselineName) {
      const baseline = global.performanceUtils.loadBaseline(baselineName);
      if (baseline) {
        const comparison = global.performanceUtils.compareWithBaseline(
          benchmark.timing, 
          baseline.timing
        );
        
        if (comparison.isRegression) {
          throw new Error(
            `Performance regression detected: ${comparison.percentChange.toFixed(2)}% slower than baseline`
          );
        }
        
        if (comparison.isImprovement) {
          console.log(
            `🎉 Performance improvement: ${Math.abs(comparison.percentChange).toFixed(2)}% faster than baseline`
          );
        }
      }
    }
    
    return true;
  }
};

// Global test utilities for file operations
global.testUtils = global.testUtils || {};
Object.assign(global.testUtils, {
  // Create large test data
  generateTestData: (size = 1000) => {
    return Array.from({ length: size }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: `This is a test item with id ${i}`,
      timestamp: new Date().toISOString(),
      data: new Array(100).fill(0).map(() => Math.random())
    }));
  },
  
  // Create temporary files for testing
  createTempFiles: (count = 10, size = 1024) => {
    const tmpDir = require('fs').mkdtempSync(require('path').join(__dirname, '../../tmp/perf-'));
    const files = [];
    
    for (let i = 0; i < count; i++) {
      const filePath = require('path').join(tmpDir, `test-file-${i}.txt`);
      const content = 'x'.repeat(size);
      require('fs').writeFileSync(filePath, content);
      files.push(filePath);
    }
    
    return { tmpDir, files };
  }
});

// Set up performance monitoring
const performanceObserver = new PerformanceObserver((list) => {
  const entries = list.getEntries();
  entries.forEach((entry) => {
    if (entry.entryType === 'measure') {
      console.log(`📏 ${entry.name}: ${entry.duration.toFixed(2)}ms`);
    }
  });
});

performanceObserver.observe({ entryTypes: ['measure', 'mark'] });

// Global benchmark results storage with retry tracking
global.benchmarkResults = [];
global.benchmarkRetryCount = 0;

// Enhanced retry utilities
global.performanceRetry = {
  async withRetry(fn, options = {}) {
    const {
      maxRetries = RETRY_CONFIG.maxRetries,
      retryDelay = RETRY_CONFIG.retryDelay,
      description = 'operation'
    } = options;
    
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (error) {
        attempt++;
        global.benchmarkRetryCount++;
        
        if (attempt > maxRetries) {
          console.error(`❌ ${description} failed after ${attempt} attempts:`, error.message);
          throw error;
        }
        
        console.warn(`⚠️ ${description} attempt ${attempt} failed, retrying in ${retryDelay * attempt}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        
        // Stabilize system before retry
        await stabilizeSystem();
      }
    }
  },
  
  getRetryStats() {
    return {
      totalRetries: global.benchmarkRetryCount,
      config: RETRY_CONFIG
    };
  }
};

// Add retry utilities to performance utils
global.performanceUtils.withRetry = global.performanceRetry.withRetry;
global.performanceUtils.getRetryStats = global.performanceRetry.getRetryStats;
global.performanceUtils.stabilizeSystem = stabilizeSystem;

// Enhanced benchmark runner with retry capability
global.performanceUtils.benchmarkWithRetry = async function(name, fn, options = {}) {
  const {
    iterations = global.BENCHMARK_ITERATIONS || 10,
    warmupIterations = Math.max(1, Math.floor(iterations * 0.1)),
    enableRetry = true,
    maxRetries = RETRY_CONFIG.maxRetries,
    skipWarmup = false
  } = options;
  
  return await global.performanceRetry.withRetry(async () => {
    console.log(`📊 Running benchmark with retry: ${name}`);
    
    // System stabilization
    await stabilizeSystem();
    
    // Warmup with retry protection
    if (!skipWarmup) {
      console.log(`🔥 Warming up (${warmupIterations} iterations)...`);
      for (let i = 0; i < warmupIterations; i++) {
        await global.performanceRetry.withRetry(() => fn(), {
          maxRetries: 1,
          description: `warmup iteration ${i + 1}`
        });
      }
    }
    
    // Enhanced stabilization after warmup
    await stabilizeSystem();
    
    // Run the original benchmark function
    const result = await global.performanceUtils.benchmark(name, fn, {
      ...options,
      skipWarmup: true // We already did warmup
    });
    
    // Add retry metadata
    result.retryMetadata = {
      enabled: enableRetry,
      maxRetries,
      totalSystemRetries: global.benchmarkRetryCount
    };
    
    return result;
  }, {
    maxRetries: enableRetry ? maxRetries : 0,
    description: `benchmark '${name}'`
  });
};

// Environment setup
process.env.NODE_ENV = 'test-performance';

console.log('🚀 Performance test environment initialized with retry capability');
console.log(`📊 Benchmark iterations: ${global.BENCHMARK_ITERATIONS || 10}`);
console.log(`⏱️  Performance threshold: ${global.PERFORMANCE_THRESHOLD_MS || 1000}ms`);
console.log(`🔄 Retry enabled: ${RETRY_CONFIG.maxRetries > 0} (max ${RETRY_CONFIG.maxRetries})`);
console.log(`🖥️  Platform: ${process.platform} ${process.arch}`);
console.log(`💾 Memory: ${(require('os').totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB total`);

module.exports = global.performanceUtils;