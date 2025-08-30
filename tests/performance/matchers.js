// ABOUTME: Custom Jest matchers for performance assertions and benchmark comparisons
// ABOUTME: Enables readable performance tests with automated regression detection

/**
 * Custom Jest matchers for performance testing
 */

expect.extend({
  /**
   * Assert that execution time is within acceptable limits
   */
  toCompleteWithin(received, maxTimeMs) {
    const pass = received.timing.avg <= maxTimeMs;
    
    if (pass) {
      return {
        message: () => 
          `Expected ${received.name} to NOT complete within ${maxTimeMs}ms, but it took ${received.timing.avg.toFixed(2)}ms`,
        pass: true
      };
    } else {
      return {
        message: () =>
          `Expected ${received.name} to complete within ${maxTimeMs}ms, but it took ${received.timing.avg.toFixed(2)}ms (max: ${received.timing.max.toFixed(2)}ms)`,
        pass: false
      };
    }
  },

  /**
   * Assert that memory usage is within limits
   */
  toUseMemoryWithin(received, maxMemoryBytes) {
    const memoryUsed = received.memory.heapUsed;
    const pass = memoryUsed <= maxMemoryBytes;
    
    if (pass) {
      return {
        message: () => 
          `Expected ${received.name} to NOT use memory within ${(maxMemoryBytes / 1024 / 1024).toFixed(2)}MB, but it used ${(memoryUsed / 1024 / 1024).toFixed(2)}MB`,
        pass: true
      };
    } else {
      return {
        message: () =>
          `Expected ${received.name} to use memory within ${(maxMemoryBytes / 1024 / 1024).toFixed(2)}MB, but it used ${(memoryUsed / 1024 / 1024).toFixed(2)}MB`,
        pass: false
      };
    }
  },

  /**
   * Assert performance has not regressed compared to baseline
   */
  toNotRegressFrom(received, baseline, thresholdPercent = 10) {
    if (!baseline || !baseline.timing) {
      return {
        message: () => `No baseline provided for comparison`,
        pass: true // Pass if no baseline to compare against
      };
    }
    
    const currentTime = received.timing.avg;
    const baselineTime = baseline.timing.avg;
    const percentChange = ((currentTime - baselineTime) / baselineTime) * 100;
    const pass = percentChange <= thresholdPercent;
    
    if (pass) {
      return {
        message: () => 
          `Expected ${received.name} to regress from baseline, but it performed ${percentChange >= 0 ? percentChange.toFixed(2) + '% slower' : Math.abs(percentChange).toFixed(2) + '% faster'}`,
        pass: true
      };
    } else {
      return {
        message: () =>
          `Expected ${received.name} to not regress more than ${thresholdPercent}% from baseline (${baselineTime.toFixed(2)}ms), but it was ${percentChange.toFixed(2)}% slower (${currentTime.toFixed(2)}ms)`,
        pass: false
      };
    }
  },

  /**
   * Assert that performance has improved compared to baseline
   */
  toImproveFrom(received, baseline, minImprovementPercent = 5) {
    if (!baseline || !baseline.timing) {
      return {
        message: () => `No baseline provided for comparison`,
        pass: false
      };
    }
    
    const currentTime = received.timing.avg;
    const baselineTime = baseline.timing.avg;
    const percentImprovement = ((baselineTime - currentTime) / baselineTime) * 100;
    const pass = percentImprovement >= minImprovementPercent;
    
    if (pass) {
      return {
        message: () => 
          `Expected ${received.name} to NOT improve by at least ${minImprovementPercent}%, but it improved by ${percentImprovement.toFixed(2)}%`,
        pass: true
      };
    } else {
      return {
        message: () =>
          `Expected ${received.name} to improve by at least ${minImprovementPercent}% from baseline (${baselineTime.toFixed(2)}ms), but it only improved by ${percentImprovement.toFixed(2)}% (${currentTime.toFixed(2)}ms)`,
        pass: false
      };
    }
  },

  /**
   * Assert that benchmark results are consistent (low variance)
   */
  toBeConsistent(received, maxCoefficientOfVariation = 0.1) {
    const { times, avg } = received.timing;
    
    // Calculate standard deviation
    const variance = times.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) / times.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Calculate coefficient of variation
    const coefficientOfVariation = standardDeviation / avg;
    
    const pass = coefficientOfVariation <= maxCoefficientOfVariation;
    
    if (pass) {
      return {
        message: () => 
          `Expected ${received.name} to NOT be consistent (CV: ${(coefficientOfVariation * 100).toFixed(2)}%), but it was within ${(maxCoefficientOfVariation * 100).toFixed(2)}%`,
        pass: true
      };
    } else {
      return {
        message: () =>
          `Expected ${received.name} to be consistent with coefficient of variation ≤ ${(maxCoefficientOfVariation * 100).toFixed(2)}%, but it was ${(coefficientOfVariation * 100).toFixed(2)}% (σ: ${standardDeviation.toFixed(2)}ms, μ: ${avg.toFixed(2)}ms)`,
        pass: false
      };
    }
  },

  /**
   * Assert that performance scales linearly with input size
   */
  toScaleLinearly(received, inputSizes, tolerance = 0.2) {
    if (!Array.isArray(received) || received.length < 2) {
      return {
        message: () => `Expected array of benchmark results for different input sizes`,
        pass: false
      };
    }
    
    if (inputSizes.length !== received.length) {
      return {
        message: () => `Input sizes array length (${inputSizes.length}) must match benchmark results length (${received.length})`,
        pass: false
      };
    }
    
    // Calculate expected linear scaling
    const baseTime = received[0].timing.avg;
    const baseSize = inputSizes[0];
    
    let scalingErrors = [];
    
    for (let i = 1; i < received.length; i++) {
      const currentTime = received[i].timing.avg;
      const currentSize = inputSizes[i];
      
      const expectedTime = baseTime * (currentSize / baseSize);
      const actualRatio = currentTime / expectedTime;
      
      if (Math.abs(actualRatio - 1) > tolerance) {
        scalingErrors.push({
          size: currentSize,
          expected: expectedTime.toFixed(2),
          actual: currentTime.toFixed(2),
          ratio: actualRatio.toFixed(2)
        });
      }
    }
    
    const pass = scalingErrors.length === 0;
    
    if (pass) {
      return {
        message: () => 
          `Expected benchmarks to NOT scale linearly, but they did within ${(tolerance * 100).toFixed(2)}% tolerance`,
        pass: true
      };
    } else {
      return {
        message: () =>
          `Expected benchmarks to scale linearly within ${(tolerance * 100).toFixed(2)}% tolerance, but found deviations: ${scalingErrors.map(e => `size ${e.size}: expected ${e.expected}ms, got ${e.actual}ms (ratio: ${e.ratio})`).join(', ')}`,
        pass: false
      };
    }
  },

  /**
   * Assert that throughput meets minimum requirements
   */
  toHaveThroughputOf(received, minOperationsPerSecond) {
    const { iterations, timing } = received;
    const totalTimeSeconds = timing.avg * iterations / 1000;
    const actualThroughput = iterations / totalTimeSeconds;
    
    const pass = actualThroughput >= minOperationsPerSecond;
    
    if (pass) {
      return {
        message: () => 
          `Expected ${received.name} to NOT have throughput of at least ${minOperationsPerSecond} ops/sec, but it achieved ${actualThroughput.toFixed(2)} ops/sec`,
        pass: true
      };
    } else {
      return {
        message: () =>
          `Expected ${received.name} to have throughput of at least ${minOperationsPerSecond} ops/sec, but it only achieved ${actualThroughput.toFixed(2)} ops/sec (${iterations} iterations in ${totalTimeSeconds.toFixed(2)}s)`,
        pass: false
      };
    }
  },

  /**
   * Assert that P95/P99 latencies are within acceptable limits
   */
  toHaveAcceptableLatencyDistribution(received, maxP95Ms, maxP99Ms) {
    const { p95, p99 } = received.timing;
    const p95Pass = p95 <= maxP95Ms;
    const p99Pass = p99 <= maxP99Ms;
    const pass = p95Pass && p99Pass;
    
    if (pass) {
      return {
        message: () => 
          `Expected ${received.name} to NOT have acceptable latency distribution, but P95: ${p95.toFixed(2)}ms ≤ ${maxP95Ms}ms and P99: ${p99.toFixed(2)}ms ≤ ${maxP99Ms}ms`,
        pass: true
      };
    } else {
      const violations = [];
      if (!p95Pass) violations.push(`P95: ${p95.toFixed(2)}ms > ${maxP95Ms}ms`);
      if (!p99Pass) violations.push(`P99: ${p99.toFixed(2)}ms > ${maxP99Ms}ms`);
      
      return {
        message: () =>
          `Expected ${received.name} to have acceptable latency distribution, but found violations: ${violations.join(', ')}`,
        pass: false
      };
    }
  }
});

// Export for use in other test files
module.exports = expect;